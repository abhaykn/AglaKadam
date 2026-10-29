import type { TFunction } from 'i18next';
import type { OutboxError } from './device-store';

/** Why a change was not accepted, in words a teacher can act on. */
export function reasonFor(error: OutboxError, t: TFunction): string {
  // The database refuses late or future attendance with the same code as missing permission; its
  // message tells the two apart.
  if (/up to 31 days after/i.test(error.message)) {
    return t('sync.reasons.pulseWindow');
  }
  if (/older than|future date/i.test(error.message)) {
    return t('sync.reasons.window');
  }
  if (/recording time is outside/i.test(error.message)) {
    return t('sync.reasons.clock');
  }
  if (/not due for a check/i.test(error.message)) {
    return t('sync.reasons.notDue');
  }
  if (/withdrawn consent/i.test(error.message)) {
    return t('sync.reasons.consentWithdrawn');
  }
  if (/replaced by another child/i.test(error.message)) {
    return t('sync.reasons.replaced');
  }
  if (/already sent for another check|pulse_checks_audio_etag_key/i.test(error.message)) {
    return t('sync.reasons.reused');
  }
  if (/notes a day/i.test(error.message)) {
    return t('sync.reasons.noteLimit');
  }
  if (/Homework is due/i.test(error.message)) {
    return t('sync.reasons.homeworkDate');
  }
  if (error.code === 'note_file_missing') {
    return t('sync.reasons.noteFileMissing');
  }
  if (error.code === 'storage_403') {
    return t('sync.reasons.uploadRefused');
  }
  if (error.code.startsWith('storage_')) {
    return error.code === 'storage_413'
      ? t('sync.reasons.tooLarge')
      : t('sync.reasons.upload', { code: error.code.slice('storage_'.length) });
  }
  switch (error.code) {
    case 'network':
      return t('sync.reasons.network');
    case 'session':
      return t('sync.reasons.session');
    case 'stale_record':
      return t('sync.reasons.staleRecord');
    case 'stale_visit':
      return t('sync.reasons.staleVisit');
    case 'closed_visit':
      return t('sync.reasons.closedVisit');
    case 'file_missing':
      return t('sync.reasons.fileMissing');
    case '42501':
      return t('sync.reasons.permission');
    case '23505':
      return t('sync.reasons.duplicate');
    case '23514':
    case '22023':
      return t('sync.reasons.notAllowed');
    case 'unreadable':
    case 'unsupported':
      return t('sync.reasons.unreadable');
    default:
      return error.code.startsWith('PGRST')
        ? t('sync.reasons.server')
        : t('sync.reasons.other', { code: error.code || '?' });
  }
}

/** "in 2 minutes" or "2 मिनट में", for the next automatic attempt. */
export function relativeTime(timestamp: number, language: string, now = Date.now()): string {
  const formatter = new Intl.RelativeTimeFormat(language === 'hi' ? 'hi-IN' : 'en-IN', {
    numeric: 'auto',
  });
  const seconds = Math.round((timestamp - now) / 1000);
  if (Math.abs(seconds) < 60) {
    return formatter.format(seconds, 'second');
  }
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) {
    return formatter.format(minutes, 'minute');
  }
  return formatter.format(Math.round(minutes / 60), 'hour');
}

export function formatTimestamp(timestamp: number, language: string): string {
  return new Intl.DateTimeFormat(language === 'hi' ? 'hi-IN' : 'en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(timestamp);
}

/** Bytes as "1.2 MB" for the storage summary. */
export function formatBytes(bytes: number, language: string): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const number = new Intl.NumberFormat(language === 'hi' ? 'hi-IN' : 'en-IN', {
    maximumFractionDigits: unit === 0 ? 0 : 1,
  }).format(value);
  return `${number} ${units[unit] ?? 'B'}`;
}
