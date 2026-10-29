import { CameraOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/ui/alert';

/** The browser's own QR reader (Chromium on Android); not yet part of the standard type library. */
type BarcodeDetectorConstructor = new (options: { formats: string[] }) => {
  detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]>;
};

const SCAN_INTERVAL_MS = 250;

/**
 * Reads QR codes with the back camera. The browser's built-in reader is used where there is one;
 * elsewhere a small decoder is loaded the first time it is needed. Frames are read on the device
 * and never kept.
 */
export function QrScanner({ onCode }: { onCode: (text: string) => void }) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const onCodeRef = useRef(onCode);
  const [problem, setProblem] = useState<'denied' | 'unsupported' | null>(null);

  useEffect(() => {
    onCodeRef.current = onCode;
  });

  useEffect(() => {
    let stopped = false;
    // Read through a function: the page can be left while a frame is being decoded.
    const isStopped = () => stopped;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const start = async () => {
      if (!('mediaDevices' in navigator)) {
        setProblem('unsupported');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
      } catch {
        setProblem('denied');
        return;
      }
      const video = videoRef.current;
      if (stopped || !video) {
        for (const track of stream.getTracks()) {
          track.stop();
        }
        return;
      }
      video.srcObject = stream;
      await video.play().catch(() => undefined);

      const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor })
        .BarcodeDetector;
      const detector = Detector ? new Detector({ formats: ['qr_code'] }) : null;
      const decode = detector ? null : (await import('jsqr')).default;
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d', { willReadFrequently: true });

      const scan = async () => {
        if (stopped) {
          return;
        }
        let text: string | null = null;
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          if (detector) {
            text = (await detector.detect(video).catch(() => []))[0]?.rawValue ?? null;
          } else if (decode && context && video.videoWidth > 0) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            context.drawImage(video, 0, 0);
            const image = context.getImageData(0, 0, canvas.width, canvas.height);
            text = decode(image.data, image.width, image.height)?.data ?? null;
          }
        }
        if (text && !isStopped()) {
          onCodeRef.current(text);
        }
        timer = setTimeout(() => void scan(), SCAN_INTERVAL_MS);
      };
      void scan();
    };

    void start();
    return () => {
      stopped = true;
      if (timer !== null) {
        clearTimeout(timer);
      }
      if (stream) {
        for (const track of stream.getTracks()) {
          track.stop();
        }
      }
    };
  }, []);

  if (problem) {
    return (
      <Alert tone="danger" title={t('pulse.unlock.cameraTitle')}>
        <span className="inline-flex items-center gap-2">
          <CameraOff className="size-4 shrink-0" aria-hidden="true" />
          {problem === 'denied' ? t('pulse.unlock.cameraDenied') : t('pulse.unlock.cameraMissing')}
        </span>
      </Alert>
    );
  }
  return (
    <video
      ref={videoRef}
      className="aspect-square w-full rounded-2xl bg-neutral-900 object-cover"
      muted
      playsInline
      aria-label={t('pulse.unlock.camera')}
    />
  );
}
