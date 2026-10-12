'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, FileCheck2, Share2, ExternalLink } from 'lucide-react';
import LunaMark from '@/components/foundation/LunaMark';
import type { HouseholdReport, ReportProgress } from '@/lib/frontend/household-pdf';
import './summary-report.css';

export default function SummaryReport({ report, onReady }: { report: HouseholdReport; onReady?: (pages: number) => void }) {
  const snapshot = JSON.stringify(report);
  const [attempt, setAttempt] = useState(0);
  // Each report or retry owns its resources and initial state. This also prevents
  // an old PDF link from appearing while a new selection starts generating.
  return <ReportAttempt key={`${attempt}:${snapshot}`} snapshot={snapshot} onReady={onReady} onRetry={() => setAttempt(value => value + 1)} />;
}

function ReportAttempt({ snapshot, onRetry, onReady }: { snapshot: string; onRetry: () => void; onReady?: (pages: number) => void }) {
  const [progress, setProgress] = useState<ReportProgress>({ value: 4, label: 'Loading the local report tools' });
  const [ready, setReady] = useState<{ url: string; blob: Blob; pages: number }>();
  const [failure, setFailure] = useState(''); const [cancelled, setCancelled] = useState(false); const [status, setStatus] = useState('');
  const controller = useRef<AbortController | null>(null);
  const readyCallback = useRef(onReady);
  useEffect(() => { readyCallback.current = onReady; }, [onReady]);
  useEffect(() => {
    const abort = new AbortController(); controller.current = abort; let objectUrl = '';
    void (async () => {
      try {
        const [builder, response, fallback] = await Promise.all([import('@/lib/frontend/household-pdf'), fetch('/fonts/instrument-sans-report.ttf', { signal: abort.signal }), fetch('/fonts/onest-variable.ttf', { signal: abort.signal })]);
        if (!response.ok || !fallback.ok) throw new Error('The report font could not load. Try again, or download the accessible text copy.');
        const built = await builder.createHouseholdPdf(JSON.parse(snapshot) as HouseholdReport, new Uint8Array(await response.arrayBuffer()), setProgress, abort.signal, new Uint8Array(await fallback.arrayBuffer()));
        abort.signal.throwIfAborted();
        const blob = new Blob([new Uint8Array(built.bytes)], { type: 'application/pdf' });
        objectUrl = URL.createObjectURL(blob); setReady({ url: objectUrl, blob, pages: built.pages });
        setProgress({ value: 100, label: 'Your PDF is ready' });
        readyCallback.current?.(built.pages);
      } catch (error) { if (!abort.signal.aborted) setFailure(error instanceof Error ? error.message : 'The PDF could not be created. Your selections are still here.'); }
    })();
    return () => { abort.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [snapshot]);
  async function share() {
    if (!ready) return; setStatus('');
    const file = new File([ready.blob], 'halo-household-summary.pdf', { type: 'application/pdf' });
    if (!navigator.share || !navigator.canShare?.({ files: [file] })) { setStatus('PDF sharing is unavailable in this browser. Download the PDF and share it from your files.'); return; }
    try { await navigator.share({ title: 'HALO household summary', files: [file] }); setStatus('The PDF was handed to your device share sheet. Delivery depends on the app you chose.'); }
    catch (error) { setStatus(error instanceof DOMException && error.name === 'AbortError' ? 'Sharing cancelled. Your PDF and selections are still here.' : 'Sharing could not finish. Your PDF is still available to download.'); }
  }
  return <section className="hg-report-builder" aria-label="Household PDF" aria-busy={!ready && !failure && !cancelled}>
    <div className="hg-report-art" aria-hidden="true"><div className="hg-report-paper"><FileCheck2 size={34} /><i /><i /><i /></div><span className="hg-report-luna"><LunaMark size={34} /></span></div>
    <p className="hg-eyebrow">Prepared with Luna</p>
    <h2>{ready ? 'Your household report is ready' : cancelled ? 'Your selections are saved' : failure ? 'Let’s try that again' : 'Luna is creating your report'}</h2>
    <p className="hg-meta">Created on this device from the sections you chose. Nothing is sent to AI or uploaded.</p>
    {!ready && !failure && !cancelled && <><progress aria-label="PDF creation progress" max={100} value={progress.value} /><p className="hg-meta" role="status">{progress.label}</p><button className="hg-text-button" onClick={() => { controller.current?.abort(); setCancelled(true); }}>Cancel PDF creation</button></>}
    {failure && <p role="alert">{failure}</p>}
    {(failure || cancelled) && <button className="hg-button" onClick={onRetry}>Try creating PDF again</button>}
    {ready && <><p className="hg-report-ready" role="status">PDF ready · {ready.pages} {ready.pages === 1 ? 'page' : 'pages'} · {Math.max(1, Math.round(ready.blob.size / 1024))} KB</p><a className="hg-report-download" href={ready.url} download="halo-household-summary.pdf"><Download size={19} />Download PDF</a><div className="hg-actions"><a href={ready.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={17} />Open PDF</a><button onClick={share}><Share2 size={17} />Share PDF</button></div></>}
    {status && <p role="status" className="hg-meta">{status}</p>}
    <p className="hg-meta">Review selected information before sharing. No public link is created.</p>
  </section>;
}
