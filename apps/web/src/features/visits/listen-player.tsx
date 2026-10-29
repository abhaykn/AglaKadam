import { Headphones, LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useOnlineStatus } from '@/features/connectivity/use-online-status';
import { getSupabase } from '@/lib/supabase';

type State =
  { kind: 'idle' } | { kind: 'loading' } | { kind: 'ready'; url: string } | { kind: 'error' };

/**
 * Plays a recording from private storage. It is fetched only when asked for, kept in memory while
 * the page is open, and never stored on the device.
 */
export function ListenPlayer({
  bucket,
  path,
  label,
}: {
  bucket: string;
  path: string;
  label: string;
}) {
  const { t } = useTranslation();
  const isOnline = useOnlineStatus();
  const [state, setState] = useState<State>({ kind: 'idle' });

  useEffect(
    () => () => {
      if (state.kind === 'ready') {
        URL.revokeObjectURL(state.url);
      }
    },
    [state],
  );

  const load = async () => {
    setState({ kind: 'loading' });
    const { data, error } = await getSupabase().storage.from(bucket).download(path);
    if (error) {
      setState({ kind: 'error' });
      return;
    }
    setState({ kind: 'ready', url: URL.createObjectURL(data) });
  };

  if (state.kind === 'ready') {
    return (
      // A child's reading has no captions to offer; the review form records what was heard.
      <audio controls autoPlay src={state.url} aria-label={label} className="w-full" />
    );
  }
  return (
    <div className="space-y-1">
      <Button
        variant="secondary"
        disabled={!isOnline || state.kind === 'loading'}
        onClick={() => void load()}
      >
        {state.kind === 'loading' ? (
          <LoaderCircle className="animate-spin" aria-hidden="true" />
        ) : (
          <Headphones aria-hidden="true" />
        )}
        {t('visits.listen.play')}
      </Button>
      {!isOnline ? <p className="text-sm text-fg-muted">{t('visits.listen.offline')}</p> : null}
      {state.kind === 'error' ? (
        <p role="alert" className="text-sm text-danger">
          {t('visits.listen.failed')}
        </p>
      ) : null}
    </div>
  );
}
