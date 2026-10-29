import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  extensionOf,
  levelOf,
  MAX_RECORDING_MS,
  MicrophoneError,
  MicrophoneSession,
  pickAudioFormat,
} from './recorder';

describe('audio formats and levels', () => {
  it('prefers Opus in WebM, then Ogg, then MP4 for Safari', () => {
    expect(pickAudioFormat(() => true)?.contentType).toBe('audio/webm');
    expect(pickAudioFormat((type) => type.startsWith('audio/ogg'))?.extension).toBe('ogg');
    expect(pickAudioFormat((type) => type === 'audio/mp4')?.extension).toBe('m4a');
    expect(pickAudioFormat(() => false)).toBeNull();
    expect(extensionOf('audio/mp4')).toBe('m4a');
    expect(extensionOf('audio/wav')).toBeNull();
  });

  it('measures loudness in dBFS', () => {
    expect(levelOf(new Float32Array([1, -1, 1, -1]))).toBeCloseTo(0);
    expect(levelOf(new Float32Array([0.1, -0.1]))).toBeCloseTo(-20);
    expect(levelOf(new Float32Array(8))).toBe(-100);
    expect(levelOf(new Float32Array())).toBe(-100);
  });
});

/** A stand-in for the browser's recorder that delivers one chunk when stopped. */
class FakeMediaRecorder extends EventTarget {
  static isTypeSupported = (type: string) => type.startsWith('audio/webm');
  static last: FakeMediaRecorder | null = null;
  /** What the next stop delivers; some phones deliver nothing for a recording stopped at once. */
  static sound = 'voice';
  state: 'inactive' | 'recording' = 'inactive';
  options: unknown;

  constructor(_stream: unknown, options: unknown) {
    super();
    this.options = options;
    FakeMediaRecorder.last = this;
  }

  start() {
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
    const data = Object.assign(new Event('dataavailable'), {
      data: new Blob(FakeMediaRecorder.sound ? [FakeMediaRecorder.sound] : [], {
        type: 'audio/webm',
      }),
    });
    queueMicrotask(() => {
      this.dispatchEvent(data);
      this.dispatchEvent(new Event('stop'));
    });
  }
}

class FakeAudioContext {
  resume = () => Promise.resolve();
  close = () => Promise.resolve();
  createAnalyser = () => ({
    fftSize: 2048,
    getFloatTimeDomainData: (buffer: Float32Array) => buffer.fill(0.01),
  });
  createMediaStreamSource = () => ({ connect: () => undefined });
}

const stopTrack = vi.fn();

/** A microphone track that can be ended, as when it is unplugged or taken by a call. */
class FakeTrack extends EventTarget {
  readyState: 'live' | 'ended' = 'live';
  stop = stopTrack;

  end() {
    this.readyState = 'ended';
    this.dispatchEvent(new Event('ended'));
  }
}

let track: FakeTrack;

function grantMicrophone(): void {
  track = new FakeTrack();
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  vi.stubGlobal('AudioContext', FakeAudioContext);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: () =>
        Promise.resolve({
          getTracks: () => [track],
          getAudioTracks: () => [track],
        }),
    },
  });
}

describe('the microphone session', () => {
  beforeEach(() => {
    stopTrack.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'mediaDevices');
  });

  it('records with the browser processing off and releases the microphone afterwards', async () => {
    grantMicrophone();
    const session = await MicrophoneSession.open();
    expect(session.level()).toBeCloseTo(-40);
    // A steady -40 dBFS draws every bar a third of the way up.
    const bars = session.waveform(24);
    expect(bars).toHaveLength(24);
    for (const bar of bars) {
      expect(bar).toBeCloseTo(1 / 3);
    }
    session.start(() => undefined);
    // Speech at 16 kbit/s: a minute of audio stays near 120 KB on a slow connection.
    expect(FakeMediaRecorder.last?.options).toMatchObject({
      mimeType: expect.stringContaining('audio/webm') as unknown,
      audioBitsPerSecond: 16_000,
    });
    const recording = await session.stop();
    expect(recording.blob.size).toBeGreaterThan(0);
    expect(recording.format.contentType).toBe('audio/webm');
    // Asking again gives the same recording.
    await expect(session.stop()).resolves.toBe(recording);
    session.close();
    expect(stopTrack).toHaveBeenCalled();
  });

  it('stops by itself at the limit', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    grantMicrophone();
    const session = await MicrophoneSession.open();
    const onEnd = vi.fn();
    session.start(onEnd);
    await vi.advanceTimersByTimeAsync(MAX_RECORDING_MS);
    await vi.waitFor(() => expect(onEnd).toHaveBeenCalledTimes(1));
    expect(onEnd.mock.calls[0]?.[0]).toMatchObject({
      kind: 'limit',
      recording: { durationMs: MAX_RECORDING_MS },
    });
    session.close();
  });

  it('reports a microphone that stops during the recording, once', async () => {
    grantMicrophone();
    const session = await MicrophoneSession.open();
    const onEnd = vi.fn();
    session.start(onEnd);
    track.end();
    expect(onEnd).toHaveBeenCalledWith({ kind: 'interrupted' });
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(session.elapsed()).toBe(0);
    await expect(session.stop()).rejects.toMatchObject({ problem: 'busy' });
    session.close();
  });

  it('says so when a recording comes back without any sound', async () => {
    grantMicrophone();
    const session = await MicrophoneSession.open();
    FakeMediaRecorder.sound = '';
    try {
      session.start(vi.fn());
      await expect(session.stop()).rejects.toMatchObject({ problem: 'empty' });
    } finally {
      FakeMediaRecorder.sound = 'voice';
      session.close();
    }
  });

  it('does not report a stop it was asked for as an interruption', async () => {
    grantMicrophone();
    const session = await MicrophoneSession.open();
    const onEnd = vi.fn();
    session.start(onEnd);
    await session.stop();
    session.close();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('explains why the microphone cannot be used', async () => {
    grantMicrophone();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: () =>
          Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })),
      },
    });
    await expect(MicrophoneSession.open()).rejects.toMatchObject({ problem: 'denied' });

    Reflect.deleteProperty(navigator, 'mediaDevices');
    const error = await MicrophoneSession.open().catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(MicrophoneError);
    expect(error).toMatchObject({ problem: 'unsupported' });
  });
});
