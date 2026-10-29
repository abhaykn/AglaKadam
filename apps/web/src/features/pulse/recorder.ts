/**
 * Recording a Pulse check on the phone: the microphone, a short check of the room's noise, and an
 * audio recording that stops by itself after 60 seconds.
 *
 * The browser's own processing (echo cancellation, noise suppression, automatic gain) is turned
 * off, so the recording is what the microphone heard, at a level that can be compared from one
 * recording to the next. Speech is recorded in mono at a low bit rate (about 120 KB a minute), which
 * is plenty for scoring and cheap to upload on a mobile connection.
 */

/** The recorder stops by itself at this length. */
export const MAX_RECORDING_MS = 60_000;
/** Recordings shorter than this cannot be scored and are not kept. */
export const MIN_RECORDING_MS = 1_000;
/** Length of the noise check before recording. */
export const NOISE_CHECK_MS = 2_000;
/**
 * Background level above which the room is too loud for a clear recording. Measured without
 * automatic gain, a quiet classroom is usually well below it and loud chatter above it.
 */
export const NOISY_ROOM_DBFS = -38;
/** 16 kbit/s: a 60-second check is about 120 KB, about 19 seconds to upload at 50 kbit/s. */
const BITS_PER_SECOND = 16_000;
/** Levels are reported from this floor upwards. */
const SILENCE_DBFS = -100;

export interface AudioFormat {
  /** Type requested from the recorder, with the codec where it matters. */
  recorderType: string;
  /** Type the file is stored and uploaded with. */
  contentType: 'audio/webm' | 'audio/ogg' | 'audio/mp4';
  extension: 'webm' | 'ogg' | 'm4a';
}

const FORMATS: AudioFormat[] = [
  { recorderType: 'audio/webm;codecs=opus', contentType: 'audio/webm', extension: 'webm' },
  { recorderType: 'audio/ogg;codecs=opus', contentType: 'audio/ogg', extension: 'ogg' },
  // Safari on iPhone and iPad records AAC in MP4.
  { recorderType: 'audio/mp4', contentType: 'audio/mp4', extension: 'm4a' },
];

/** The first format this browser can record, or null when it cannot record audio at all. */
export function pickAudioFormat(
  isTypeSupported: (type: string) => boolean = (type) =>
    typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type),
): AudioFormat | null {
  return FORMATS.find((format) => isTypeSupported(format.recorderType)) ?? null;
}

/** The extension a stored recording of `contentType` is uploaded with. */
export function extensionOf(contentType: string): AudioFormat['extension'] | null {
  return FORMATS.find((format) => format.contentType === contentType)?.extension ?? null;
}

/** Root-mean-square level of audio samples in dBFS (0 is the loudest possible). */
export function levelOf(samples: Float32Array): number {
  if (samples.length === 0) {
    return SILENCE_DBFS;
  }
  let sum = 0;
  for (const sample of samples) {
    sum += sample * sample;
  }
  const rms = Math.sqrt(sum / samples.length);
  return rms > 0 ? Math.max(SILENCE_DBFS, 20 * Math.log10(rms)) : SILENCE_DBFS;
}

export type MicrophoneProblem =
  /** The person or the browser settings refused the microphone. */
  | 'denied'
  /** The device has no microphone. */
  | 'missing'
  /** Another app is using the microphone. */
  | 'busy'
  /** The recording came back without any sound, usually because it was stopped at once. */
  | 'empty'
  /** The browser cannot record audio (too old, or the page is not served securely). */
  | 'unsupported';

export class MicrophoneError extends Error {
  readonly problem: MicrophoneProblem;

  constructor(problem: MicrophoneProblem, cause?: unknown) {
    super(`The microphone cannot be used (${problem}).`, { cause });
    this.name = 'MicrophoneError';
    this.problem = problem;
  }
}

function problemOf(error: unknown): MicrophoneProblem {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'denied';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'missing';
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return 'busy';
  }
  return 'unsupported';
}

export interface Recording {
  blob: Blob;
  durationMs: number;
  format: AudioFormat;
}

/** How a recording ended without the teacher pressing stop. */
export type RecordingEnd =
  /** The recording reached the limit and stopped by itself. */
  | { kind: 'limit'; recording: Recording }
  /** The microphone stopped under the recorder (unplugged, taken by a call or another app). */
  | { kind: 'interrupted' };

/**
 * An open microphone. Open it from a tap (browsers allow audio to start only then), use it for one
 * child, and close it afterwards so the phone's microphone indicator goes off.
 */
export class MicrophoneSession {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  /** The longest the running recording may last. */
  private limitMs = MAX_RECORDING_MS;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private stopping: Promise<Recording> | null = null;
  /** Set once the recording ended in any way, so the end is reported exactly once. */
  private ended = false;
  /** Settles when the running recorder has delivered its last data. */
  private finished: Promise<void> = Promise.resolve();
  private readonly buffer: Float32Array<ArrayBuffer>;

  private constructor(
    private readonly stream: MediaStream,
    private readonly context: AudioContext,
    private readonly analyser: AnalyserNode,
    readonly format: AudioFormat,
  ) {
    this.buffer = new Float32Array(analyser.fftSize);
  }

  static async open(): Promise<MicrophoneSession> {
    const format = pickAudioFormat();
    // Browsers leave the microphone out entirely on pages not served securely.
    if (!format || !('mediaDevices' in navigator)) {
      throw new MicrophoneError('unsupported');
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    } catch (error) {
      throw new MicrophoneError(problemOf(error), error);
    }
    try {
      const context = new AudioContext();
      await context.resume();
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      context.createMediaStreamSource(stream).connect(analyser);
      return new MicrophoneSession(stream, context, analyser, format);
    } catch (error) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      throw new MicrophoneError('unsupported', error);
    }
  }

  /** The current input level in dBFS, for a level meter. */
  level(): number {
    this.analyser.getFloatTimeDomainData(this.buffer);
    return levelOf(this.buffer);
  }

  /**
   * The loudness of the last moment of sound in `bars` slices, each from 0 (silent) to 1 (very
   * loud), for drawing a live waveform.
   */
  waveform(bars: number): number[] {
    this.analyser.getFloatTimeDomainData(this.buffer);
    const size = Math.max(1, Math.floor(this.buffer.length / bars));
    return Array.from({ length: bars }, (_, bar) => {
      const level = levelOf(this.buffer.subarray(bar * size, (bar + 1) * size));
      return Math.max(0, Math.min(1, (level + 60) / 60));
    });
  }

  /** Average background level over `milliseconds`, measured before the child speaks. */
  async measureNoise(milliseconds = NOISE_CHECK_MS): Promise<number> {
    const levels: number[] = [];
    const end = performance.now() + milliseconds;
    while (performance.now() < end) {
      levels.push(this.level());
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    // Averaged as power, not as decibels, so that short bursts count for what they are.
    const power = levels.reduce((total, level) => total + 10 ** (level / 10), 0) / levels.length;
    return Math.max(SILENCE_DBFS, 10 * Math.log10(power));
  }

  /** Whether the microphone stopped under the recorder, for example during a phone call. */
  get isInterrupted(): boolean {
    return this.stream.getAudioTracks().some((track) => track.readyState === 'ended');
  }

  /**
   * Starts recording. `onEnd` is called if the recording ends without {@link stop}: at the limit
   * (a Pulse check's minute unless another is given), or because the microphone stopped.
   */
  start(onEnd: (end: RecordingEnd) => void, limitMs = MAX_RECORDING_MS): void {
    if (this.recorder) {
      throw new Error('The recorder is already running.');
    }
    this.chunks = [];
    this.stopping = null;
    this.ended = false;
    const recorder = new MediaRecorder(this.stream, {
      mimeType: this.format.recorderType,
      audioBitsPerSecond: BITS_PER_SECOND,
    });
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);
      }
    });
    this.finished = new Promise((resolve) => {
      recorder.addEventListener('stop', () => resolve(), { once: true });
    });
    const interrupted = () => {
      if (!this.ended && this.stopping === null) {
        this.ended = true;
        this.clearTimer();
        onEnd({ kind: 'interrupted' });
      }
    };
    // The browser stops the recorder by itself when the microphone goes away.
    recorder.addEventListener('stop', interrupted, { once: true });
    recorder.addEventListener('error', interrupted, { once: true });
    for (const track of this.stream.getAudioTracks()) {
      track.addEventListener('ended', interrupted, { once: true });
    }
    this.recorder = recorder;
    this.limitMs = limitMs;
    this.startedAt = performance.now();
    recorder.start(1000);
    this.stopTimer = setTimeout(() => {
      this.stopTimer = null;
      this.stop().then(
        (recording) => {
          if (!this.ended) {
            this.ended = true;
            onEnd({ kind: 'limit', recording });
          }
        },
        () => interrupted(),
      );
    }, limitMs);
  }

  private clearTimer(): void {
    if (this.stopTimer !== null) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
  }

  /** Milliseconds recorded so far. */
  elapsed(): number {
    return this.recorder && !this.ended
      ? Math.min(performance.now() - this.startedAt, this.limitMs)
      : 0;
  }

  /** Stops recording and returns the audio. Calling it again returns the same recording. */
  stop(): Promise<Recording> {
    if (this.stopping) {
      return this.stopping;
    }
    const recorder = this.recorder;
    if (!recorder || this.ended) {
      return Promise.reject(new MicrophoneError('busy'));
    }
    this.clearTimer();
    const endedAt = performance.now();
    if (recorder.state !== 'inactive') {
      recorder.stop();
    }
    this.stopping = this.finished.then(() => {
      this.recorder = null;
      const blob = new Blob(this.chunks, { type: this.format.contentType });
      if (blob.size === 0) {
        throw new MicrophoneError('empty');
      }
      const durationMs = Math.round(Math.min(endedAt - this.startedAt, this.limitMs));
      return { blob, durationMs, format: this.format };
    });
    return this.stopping;
  }

  /** Stops everything and releases the microphone. */
  close(): void {
    this.clearTimer();
    // Whatever happens to the recorder now was asked for; it is not an interruption.
    this.ended = true;
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.stop();
    }
    this.recorder = null;
    for (const track of this.stream.getTracks()) {
      track.stop();
    }
    void this.context.close().catch(() => undefined);
  }
}
