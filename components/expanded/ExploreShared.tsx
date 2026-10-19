'use client';

import { useState } from 'react';
import { useExpandedPreview } from './ExpandedPreviewState';
import { useHomeWorkspace } from '@/components/homeguard/HomeWorkspaceState';
import type { HandoffExportKind } from '@/lib/frontend/note-handoff-preview';

export function SaveExplore({ origin, title, reason, date,disabled=false }: { origin: string; title: string; reason: string; date?: string;disabled?:boolean }) {
  const state = useExpandedPreview(); const workspace = useHomeWorkspace(); const key = `explore:${origin}`;
  const saved = state?.actions.find(action => action.key === key);
  return <button className="ex-button" disabled={disabled||!state ||state.readiness!=='ready'||state.pending||Boolean(state.unknownOperation)|| workspace.scenario === 'offline'} onClick={() => state?.open(saved ?? { key, title, reason, origin: 'Explore', date })}>{saved ? 'Open saved action' : 'Save to My Week'}</button>;
}

export function ShareTools({ text, filename = 'halo-explore-draft.txt', onResult }: { text: string; filename?: string; onResult?: (kind: HandoffExportKind) => void }) {
  const [message, setMessage] = useState('');
  async function copy() { try { await navigator.clipboard.writeText(text); setMessage('Copied. Review before you share.'); onResult?.('copied'); } catch { setMessage('Copy is unavailable. Select the preview text or download it.'); } }
  async function share() { if (!navigator.share) { setMessage('Sharing is unavailable. Copy or download the preview.'); return; } try { await navigator.share({ title: 'HALO draft', text }); setMessage('Handed to your device share sheet.'); onResult?.('share-completed'); } catch (error) { setMessage(error instanceof DOMException && error.name === 'AbortError' ? 'Sharing cancelled. Your draft is still here.' : 'Sharing could not finish. Your draft is still here.'); } }
  function download() { const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setMessage('Prepared the selected text for download.'); onResult?.('download-requested'); }
  function print() { const page = window.open('', '_blank'); if (!page) { setMessage('The print window was blocked. Download the text instead.'); return; } page.document.title = 'HALO selected draft'; const style = page.document.createElement('style'); style.textContent = 'body{background:white;color:#111;margin:32px;font:16px/1.6 Arial,sans-serif}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}'; page.document.head.append(style); const body = page.document.createElement('pre'); body.textContent = text; page.document.body.append(body); page.focus(); page.print(); setMessage('Opened a clean print preview of the selected text.'); onResult?.('print-opened'); }
  return <><div className="ex-tools"><button onClick={copy}>Copy</button><button onClick={share}>Share</button><button onClick={download}>Download text</button><button onClick={print}>Print</button></div>{message && <p role="status">{message}</p>}</>;
}

export type ExploreArea = { place: string; state: string };
export const blankArea: ExploreArea = { place: '', state: '' };
export const areaLabel = (area: ExploreArea) => [area.place.trim(), area.state.trim()].filter(Boolean).join(', ');
