import { createStore } from '@/lib/store';

/** The non-standard event Chromium fires when a site meets the install criteria. */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt: () => Promise<void>;
}

export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable';

export interface InstallState {
  /** The browser can show its native install dialog. */
  canPrompt: boolean;
  /** The app is already running as an installed application. */
  isInstalled: boolean;
  /** iOS Safari, which supports installation only through the Share sheet. */
  needsManualIosInstall: boolean;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;

function isStandalone(): boolean {
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  const displayModeStandalone =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches;
  return displayModeStandalone || navigatorWithStandalone.standalone === true;
}

function isIosSafari(): boolean {
  const userAgent = navigator.userAgent;
  const isAppleTouchDevice =
    /iPad|iPhone|iPod/.test(userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isOtherIosBrowser = ['CriOS', 'FxiOS', 'EdgiOS'].some((token) => userAgent.includes(token));
  const isSafari = userAgent.includes('Safari') && !isOtherIosBrowser;
  return isAppleTouchDevice && isSafari;
}

export const installStore = createStore<InstallState>({
  canPrompt: false,
  isInstalled: false,
  needsManualIosInstall: false,
});

/**
 * Starts listening for install events. Must run before the first render because Chromium may
 * dispatch `beforeinstallprompt` very early in the page lifecycle.
 */
export function initialiseInstallPrompt(): void {
  const installed = isStandalone();
  installStore.set({
    canPrompt: false,
    isInstalled: installed,
    needsManualIosInstall: !installed && isIosSafari(),
  });

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    installStore.set((state) => ({ ...state, canPrompt: true }));
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installStore.set({ canPrompt: false, isInstalled: true, needsManualIosInstall: false });
  });
}

/** Shows the native install dialog when the browser has offered one. */
export async function promptInstall(): Promise<InstallOutcome> {
  if (!deferredPrompt) {
    return 'unavailable';
  }
  const promptEvent = deferredPrompt;
  deferredPrompt = null;
  installStore.set((state) => ({ ...state, canPrompt: false }));
  await promptEvent.prompt();
  const choice = await promptEvent.userChoice;
  return choice.outcome;
}
