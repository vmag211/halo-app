'use client';

import { useEffect, useState } from 'react';
import HaloLoading from '@/components/ui/HaloLoading';
import { useHomeWorkspace } from './HomeWorkspaceState';

export function useHomeResource<T>(resource: string, query: Record<string, string>, preview: T, validate: (value: unknown) => value is T) {
  const { mode, service } = useHomeWorkspace();
  const signature = JSON.stringify(query);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ signature: string; data: T | null; status: 'loading' | 'ready' | 'error'; error: string }>({ signature: '', data: null, status: 'loading', error: '' });
  useEffect(() => {
    if (mode === 'preview') return;
    const controller = new AbortController();
    Promise.resolve().then(() => {
      if (controller.signal.aborted) return;
      setState({ signature, data: null, status: 'loading', error: '' });
      if (!service?.readResource) throw new Error('This information is not available yet. Try again later.');
      return service.readResource(resource, JSON.parse(signature) as Record<string, string>, controller.signal);
    }).then(value => {
      if (controller.signal.aborted) return;
      if (!validate(value)) throw new Error('This information could not be verified. Try again.');
      setState({ signature, data: value, status: 'ready', error: '' });
    }).catch(error => { if (!controller.signal.aborted) setState({ signature, data: null, status: 'error', error: error instanceof Error ? error.message.replaceAll('\u2014', ',') : 'This information could not load. Try again.' }); });
    return () => controller.abort();
  }, [mode, service, resource, signature, attempt, validate]);
  if (mode === 'preview') return { data: preview, status: 'ready' as const, error: '', retry: () => setAttempt(value => value + 1) };
  return { ...state, data: state.signature === signature ? state.data : null, retry: () => setAttempt(value => value + 1) };
}

export function HomeResourceFeedback({ status, error, retry }: { status: string; error: string; retry: () => void }) {
  if (status === 'ready') return null;
  return <div className={status === 'error' ? 'hg-error' : 'hg-meta'} role={status === 'error' ? 'alert' : undefined}>{status === 'loading' ? <HaloLoading label="Loading source information" /> : <><p>{error}</p><button type="button" className="hg-button-secondary" onClick={retry}>Try again</button></>}</div>;
}
