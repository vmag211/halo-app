'use client';
/* eslint-disable @next/next/no-img-element -- Private local blobs never go through an image optimization service. */
import { useEffect, useRef, useState } from 'react';
import { useHomeWorkspace } from './HomeWorkspaceState';
import { Confirm, Field, SourceNote } from './HomeWorkspaceUI';
import { usePrivateUpload } from './usePrivateUpload';
import type { HomeAttachment } from '@/lib/frontend/production/home-service';
import { FrontendServiceError, serviceMessage } from '@/lib/frontend/production/runtime';
import { reportFileCopy, reportFileError } from '@/lib/frontend/note-photo-preview';

export function PrivateAttachmentDownload({ attachmentId, revision, name, image = false }: { attachmentId: string; revision: number; name: string; image?: boolean }) {
  const { service } = useHomeWorkspace();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [url, setUrl] = useState('');
  const request = useRef<AbortController | null>(null), address = useRef('');
  useEffect(() => () => { request.current?.abort(); if (address.current) URL.revokeObjectURL(address.current); }, []);
  async function open() {
    if (!service?.attachments || busy) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setMessage('');
    try {
      const blob = await service.attachments.download(attachmentId, revision, controller.signal);
      if (controller.signal.aborted) return;
      if (address.current) URL.revokeObjectURL(address.current);
      address.current = URL.createObjectURL(blob);
      if (image && blob.type.startsWith('image/')) setUrl(address.current);
      else { const link = document.createElement('a'); link.href = address.current; link.download = name; link.click(); }
    } catch (error) { if (!controller.signal.aborted) setMessage(serviceMessage(error)); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <div className="hg-stack"><button type="button" className="hg-button-secondary" disabled={busy || !service?.attachments} onClick={() => void open()}>{busy ? 'Opening private file...' : image ? 'View private photo' : 'Download private original'}</button>{url && <img src={url} alt="Private observation selected by you" style={{ maxWidth: '100%', maxHeight: 280, objectFit: 'contain' }} />}{message && <p role="status">{message}</p>}</div>;
}

export function PrivateObservationPhoto({id,revision,name}:{id:string;revision:number;name:string}) {
  const [review,setReview]=useState(false),[consent,setConsent]=useState(false);
  return <section className="ex-photo-detail"><h4>Private photo</h4><PrivateAttachmentDownload attachmentId={id} revision={revision} name={name} image /><p className="ex-meta">Embedded metadata was removed. Visible faces, signs and places may remain. No automated interpretation.</p><button type="button" className="ex-text-button" onClick={()=>{setReview(!review);setConsent(false);}}>{review?'Close photo export':'Review photo export'}</button>{review&&<div className="ex-photo-review"><p>Only the processed image is downloaded. Your note and original camera metadata are excluded. Downloaded copies cannot be removed by HALO.</p><label className="ex-check"><input type="checkbox" checked={consent} onChange={event=>setConsent(event.target.checked)}/>I reviewed the visible details and choose to download this photo.</label>{consent&&<PrivateAttachmentDownload attachmentId={id} revision={revision} name={name}/>}</div>}</section>;
}

/** Report originals may retain document metadata; private storage is explicitly reviewed. */
/** `onStep(from)`: a stored or removed report raised the test's revision from `from` by exactly one (B14 Ruling A7), so an open results draft based on `from` can follow it instead of reporting its own upload as a change made elsewhere. */
export function PrivateReportAttachments({ recordId, onStep }: { recordId: string; onStep?: (from: number) => void }) {
  const workspace = useHomeWorkspace(), upload = usePrivateUpload();
  const [file, setFile] = useState<File | null>(null), [reviewed, setReviewed] = useState(false), [url, setUrl] = useState('');
  const [removing, setRemoving] = useState<HomeAttachment | null>(null), [removeOperation, setRemoveOperation] = useState(''), [removeUnknown, setRemoveUnknown] = useState(false), [removeBusy, setRemoveBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  const record = workspace.collections.tests?.find(item => item.id === recordId) as { attachments?: HomeAttachment[]; revision?: number } | undefined;
  const stored = Array.isArray(record?.attachments) ? record.attachments.filter(item => item && typeof item.id === 'string' && Number.isSafeInteger(item.revision) && ['ready', 'quarantined', 'rejected'].includes(item.status)) : [];
  const visible = [...stored, ...(upload.attachment && !stored.some(item => item.id === upload.attachment?.id) ? [upload.attachment] : [])];
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => { if (!file?.type.startsWith('image/')) return; const value = URL.createObjectURL(file); let active = true; queueMicrotask(() => { if (active) setUrl(value); }); return () => { active = false; URL.revokeObjectURL(value); }; }, [file]);
  const busy = upload.busy || removeBusy, blocked = busy || upload.unknown || removeUnknown;
  async function save() {
    if (!file || !reviewed) return;
    const before = record?.revision;
    const next = await upload.upload({ collection: 'tests', recordId, file, name: file.name, metadataRemoved: false, reviewed });
    if (next?.status === 'ready' && typeof before === 'number') onStep?.(before);
    if (next?.status === 'ready') await workspace.retry('tests');
  }
  async function remove() {
    if (!removing || !workspace.service?.attachments || removeBusy) return;
    const controller = new AbortController(); request.current = controller; setRemoveBusy(true);
    const id = removeOperation || crypto.randomUUID(); setRemoveOperation(id); const before = removeUnknown ? undefined : record?.revision;
    workspace.trackPendingOperation(id, 'attachments');
    try {
      const receipt = removeUnknown ? await workspace.service.reconcile(id, controller.signal, 'attachments') : await workspace.service.attachments.remove(removing.id, removing.revision, id, controller.signal);
      if (controller.signal.aborted) return;
      if (receipt.operationId !== id || ['unknown', 'pending'].includes(receipt.status)) { setRemoveUnknown(true); upload.setMessage('Removal is not confirmed. Check its status before changing this file.'); return; }
      if (receipt.status === 'succeeded') workspace.applyCanonical({ collections: receipt.changes });
      else if (receipt.status !== 'failed') throw new Error('Unconfirmed removal result');
      workspace.resolvePendingOperation(id); setRemoveUnknown(false); setRemoveOperation('');
      if (receipt.status !== 'succeeded') { upload.setMessage(receipt.message || 'The private file was not removed.'); return; }
      if (typeof before === 'number') onStep?.(before);
      upload.reset(); setRemoving(null); setFile(null); setReviewed(false); upload.setMessage('Private file removed. Entered results remain.'); await workspace.retry('tests');
    } catch (error) { const uncertain = error instanceof FrontendServiceError ? ['unknown_outcome', 'invalid_response', 'aborted'].includes(error.code) : true; setRemoveUnknown(uncertain); if (!uncertain) workspace.resolvePendingOperation(id); upload.setMessage(serviceMessage(error)); }
    finally { if (!controller.signal.aborted) setRemoveBusy(false); }
  }
  return <section className="hg-card hg-stack" aria-label="Private attachment review"><h3>Private originals</h3><p>{reportFileCopy.intro}</p>
    {visible.map(item => <div className="hg-stack" key={item.id}><strong>{item.name}</strong><span className="hg-meta">{item.status === 'ready' ? 'Private report' : item.status === 'quarantined' ? 'File checks pending' : 'File rejected'}</span>{item.status === 'ready' && <PrivateAttachmentDownload attachmentId={item.id} revision={item.revision} name={item.name} />}<button type="button" className="hg-text-button" disabled={blocked} onClick={() => { setRemoving(item); setRemoveOperation(''); }}>Remove stored report</button></div>)}
    <Field label="Choose a report"><input type="file" accept={reportFileCopy.accept} disabled={blocked || !!upload.attachment} onChange={event => { const next = event.target.files?.[0]; if (!upload.reset()) return; setReviewed(false); setUrl(''); if (!next) { setFile(null); return; } const invalid = reportFileError(next.type, next.size); if (invalid) { setFile(null); upload.setMessage(invalid); return; } setFile(next); }} /></Field>
    {file && <><p><strong>{file.name}</strong> · {Math.ceil(file.size / 1024)} KiB</p>{url && file.type.startsWith('image/') ? <img className="hg-attachment-image" src={url} alt="Selected private report original" /> : <p>Review the PDF in your original viewer before confirming.</p>}<label className="hg-check"><input type="checkbox" checked={reviewed} disabled={blocked || !!upload.attachment} onChange={event => setReviewed(event.target.checked)} />I inspected the original and agree to store this private report.</label><div className="hg-actions"><button type="button" className="hg-button" disabled={!reviewed || busy || upload.unknown || upload.attachment?.status === 'ready'} onClick={() => void save()}>{upload.busy ? 'Checking file...' : upload.attachment?.status === 'quarantined' ? 'Check file status' : 'Save private report'}</button><button type="button" className="hg-button-secondary" disabled={blocked || upload.attachment?.status === 'quarantined'} onClick={() => { if (upload.reset()) { setFile(null); setReviewed(false); } }}>{upload.attachment ? 'Add another report' : 'Remove local selection'}</button></div></>}
    {upload.unknown && <button type="button" className="hg-button" disabled={busy} onClick={() => void upload.upload().then(next => { if (next?.status === 'ready') void workspace.retry('tests'); })}>Check upload status</button>}
    {upload.busy && <div role="status">Saving private file...<button type="button" onClick={upload.stop}>Stop waiting</button></div>}{upload.message && <p role="status">{upload.message}</p>}
    <SourceNote>File acceptance is not laboratory verification, transcription confirmation or a safety assessment.</SourceNote>
    {removing && <Confirm unknownRecovery={{ label: "Check removal status", check: remove }} title={removeUnknown ? 'Check file removal' : 'Remove this private report?'} danger confirmLabel={removeUnknown ? 'Check removal status' : 'Remove report'} onCancel={() => setRemoving(null)} onConfirm={remove}>Only this private file is removed. Entered results and separate records remain.{removeUnknown && <p>The earlier request may have completed. No second removal is sent.</p>}</Confirm>}
  </section>;
}
