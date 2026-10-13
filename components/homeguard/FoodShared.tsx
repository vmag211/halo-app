'use client';

import { useState } from 'react';
import { Bookmark, Check, Download, ExternalLink, Radio, Share2 } from 'lucide-react';
import { type FoodFollow } from '../../lib/frontend/home-food-preview';
import { useHomeCollection, useHomeWorkspace } from './HomeWorkspaceState';
import { downloadPreview } from './HomeWorkspaceUI';
import { safePublicUrl } from '@/lib/frontend/production/home-resources';

export function FoodPreviewNote() {
  return null;
}
export function FoodDetails({ title, children }: { title: string; children: React.ReactNode }) {
  return <details className="hg-disclosure"><summary>{title}</summary><div className="hg-stack">{children}</div></details>;
}
export function FoodSourceLink({ href, children }: { href: string; children: React.ReactNode }) {
  if (!safePublicUrl(href)) return <span className="hg-meta">Source link unavailable</span>;
  return <a className="hg-source-link" href={href} target="_blank" rel="noopener noreferrer">{children}<ExternalLink size={14} aria-hidden="true" /></a>;
}
export function FoodSaveFollow({ id, title, revision, kind, record }: { id: string; title: string; revision: number; kind: FoodFollow['kind']; record: unknown }) {
  const follows = useHomeCollection<FoodFollow>('foodFollows', []);
  const { pending, scenario, mode } = useHomeWorkspace();
  const existing = follows.records.find(item => item.targetId === id && item.kind === kind);
  const [share, setShare] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function update(field: 'saved' | 'following') {
    setBusy(true);
    await follows.save({ id: existing?.id ?? `follow-${kind}-${id}`, title, revision: existing?.revision ?? 0, kind, targetId: id, sourceRevision: revision, saved: existing?.saved ?? false, following: existing?.following ?? false, [field]: !existing?.[field] });
    setBusy(false);
  }
  const publicFields = ['title', 'kind', 'region', 'category', 'status', 'issued', 'sampleDate', 'scope', 'finding', 'applicability', 'instruction', 'previous', 'url', 'sourceUrl', 'date', 'extent', 'species', 'wording', 'condition', 'pollutant', 'concern', 'matrix', 'qualifications', 'cost', 'deadline'];
  const publicRecord = record && typeof record === 'object' ? Object.fromEntries(Object.entries(record).filter(([key, value]) => publicFields.includes(key) && (typeof value === 'string' || typeof value === 'number'))) : {};
  const shareText = JSON.stringify({ sourceStatus: mode === 'production' ? 'source-linked' : 'unverified', title, version: revision, record: mode === 'production' ? publicRecord : kind === 'resource' ? record : { sourceAvailable: false } }, null, 2);
  return <>
    <div className="hg-food-reference-actions" role="group" aria-label="Reference options">
      <button className="hg-button-secondary" type="button" disabled={busy || pending || scenario === 'offline'} aria-pressed={Boolean(existing?.saved)} onClick={() => void update('saved')}>{existing?.saved ? <Check size={16} aria-hidden="true" /> : <Bookmark size={16} aria-hidden="true" />}{existing?.saved ? 'Saved' : 'Save reference'}</button>
      <button className="hg-button-secondary" type="button" disabled={busy || pending || scenario === 'offline'} aria-pressed={Boolean(existing?.following)} onClick={() => void update('following')}><Radio size={16} aria-hidden="true" />{existing?.following ? 'Following' : 'Follow updates'}</button>
      <button className="hg-button-secondary" type="button" aria-expanded={share} onClick={() => setShare(!share)}><Share2 size={16} aria-hidden="true" />Share reference</button>
    </div>
    {existing?.following && <p className="hg-meta">Saved source version {existing.sourceRevision}.{mode === 'preview' ? ' Updates are not connected.' : ' Following this source. Delivery follows your notification settings.'}</p>}
    {share && <section className="hg-card"><h3>Share this reference</h3><p>Private notes, sites and test reports are not included.</p><FoodDetails title="Preview exported data"><pre className="hg-export-preview">{shareText}</pre></FoodDetails><div className="hg-actions"><button className="hg-button-secondary" onClick={async () => { try { await navigator.clipboard.writeText(shareText); setMessage('Reference copied.'); } catch { setMessage('Clipboard unavailable. Use Download reference.'); } }}>Copy reference</button><button className="hg-button-secondary" onClick={() => downloadPreview(`${id}.json`, shareText)}><Download size={16} />Download reference</button></div>{message && <p role="status">{message}</p>}</section>}
  </>;
}
