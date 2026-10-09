'use client';

import { useState } from 'react';
import { Bookmark, Check, Download, ExternalLink, Radio, Share2 } from 'lucide-react';
import { type FoodFollow } from '../../lib/frontend/home-food-preview';
import { useHomeCollection, useHomeWorkspace } from './HomeWorkspaceState';
import { downloadPreview } from './HomeWorkspaceUI';

export function FoodPreviewNote() {
  return <p className="hg-preview-label">Sample records, not current food or water advice.</p>;
}
export function FoodDetails({ title, children }: { title: string; children: React.ReactNode }) {
  return <details className="hg-disclosure"><summary>{title}</summary><div className="hg-stack">{children}</div></details>;
}
export function FoodSourceLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <a className="hg-source-link" href={href} target="_blank" rel="noopener noreferrer">{children}<ExternalLink size={14} aria-hidden="true" /></a>;
}
export function FoodSaveFollow({ id, title, revision, kind, record }: { id: string; title: string; revision: number; kind: FoodFollow['kind']; record: unknown }) {
  const follows = useHomeCollection<FoodFollow>('foodFollows', []);
  const { pending, scenario } = useHomeWorkspace();
  const existing = follows.records.find(item => item.targetId === id && item.kind === kind);
  const [share, setShare] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function update(field: 'saved' | 'following') {
    setBusy(true);
    await follows.save({ id: existing?.id ?? `follow-${kind}-${id}`, title, revision: existing?.revision ?? 0, kind, targetId: id, sourceRevision: revision, saved: existing?.saved ?? false, following: existing?.following ?? false, [field]: !existing?.[field] });
    setBusy(false);
  }
  const shareText = JSON.stringify({ notice: 'SYNTHETIC HALO REVIEW. Not current guidance or a real notice.', title, version: revision, record }, null, 2);
  return <>
    <div className="hg-food-reference-actions" role="group" aria-label="Reference options">
      <button className="hg-button-secondary" type="button" disabled={busy || pending || scenario === 'offline'} aria-pressed={Boolean(existing?.saved)} onClick={() => void update('saved')}>{existing?.saved ? <Check size={16} aria-hidden="true" /> : <Bookmark size={16} aria-hidden="true" />}{existing?.saved ? 'Saved' : 'Save reference'}</button>
      <button className="hg-button-secondary" type="button" disabled={busy || pending || scenario === 'offline'} aria-pressed={Boolean(existing?.following)} onClick={() => void update('following')}><Radio size={16} aria-hidden="true" />{existing?.following ? 'Following in preview' : 'Follow updates'}</button>
      <button className="hg-button-secondary" type="button" aria-expanded={share} onClick={() => setShare(!share)}><Share2 size={16} aria-hidden="true" />Share reference</button>
    </div>
    {existing?.following && <p className="hg-meta">Following version {existing.sourceRevision} in this preview. No notifications are sent.</p>}
    {share && <section className="hg-card"><h3>Share this reference</h3><p>Private notes, sites and test reports are not included.</p><FoodDetails title="Preview exported data"><pre className="hg-export-preview">{shareText}</pre></FoodDetails><div className="hg-actions"><button className="hg-button-secondary" onClick={async () => { try { await navigator.clipboard.writeText(shareText); setMessage('Reference copied.'); } catch { setMessage('Clipboard unavailable. Use Download reference.'); } }}>Copy reference</button><button className="hg-button-secondary" onClick={() => downloadPreview(`${id}.json`, shareText)}><Download size={16} />Download reference</button></div>{message && <p role="status">{message}</p>}</section>}
  </>;
}
