'use client';
import { useEffect, useRef, useState } from 'react';
import { useHomeWorkspace } from './HomeWorkspaceState';
import type { HomeAttachment, HomeAttachmentService } from '@/lib/frontend/production/home-service';
import { FrontendServiceError, serviceMessage } from '@/lib/frontend/production/runtime';
type UploadInput = Omit<Parameters<HomeAttachmentService['upload']>[0], 'operationId'>;

/** Unknown results are reconciled by ID, never retried as a fresh upload. */
export function usePrivateUpload() {
  const workspace = useHomeWorkspace();
  const [attachment, setAttachment] = useState<HomeAttachment | null>(null);
  const [busy, setBusy] = useState(false), [unknown, setUnknown] = useState(false), [message, setMessage] = useState('');
  const request = useRef<AbortController | null>(null), operation = useRef(''), locked = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current?.abort(); }; }, []);
  async function upload(input?: UploadInput): Promise<HomeAttachment | null> {
    const service = workspace.service?.attachments;
    if (locked.current || !service) { if (!service) setMessage('Private file storage is unavailable. Your draft is kept.'); return null; }
    if (workspace.unknownOperations.some(item => item.operationId !== operation.current)) { setMessage('Check earlier changes before uploading another file.'); return null; }
    const controller = new AbortController(); request.current = controller; locked.current = true; setBusy(true); setMessage('');
    try {
      let next: HomeAttachment;
      if (unknown) {
        if (!service.reconcileUpload) { setMessage('Check this upload status before uploading again.'); return null; }
        const receipt = await service.reconcileUpload(operation.current, controller.signal);
        if (receipt.operationId !== operation.current) throw new Error('Upload reference did not match.');
        if (receipt.status === 'failed') { workspace.resolvePendingOperation(operation.current); setUnknown(false); operation.current = ''; setMessage(receipt.message || 'The upload did not complete. You can try again.'); return null; }
        if (receipt.status !== 'succeeded' || !receipt.attachment) { setMessage('The upload is still being checked.'); return null; }
        next = receipt.attachment;
      } else if (attachment) next = await service.inspect(attachment.id, controller.signal);
      else { if (!input) return null; operation.current ||= crypto.randomUUID(); workspace.trackPendingOperation(operation.current, 'attachments'); next = await service.upload({ ...input, operationId: operation.current }, controller.signal); }
      if (!alive.current) return null;
      workspace.resolvePendingOperation(operation.current); setUnknown(false); setAttachment(next);
      setMessage(next.status === 'ready' ? 'Private file stored.' : next.status === 'rejected' ? 'This file did not pass the file checks.' : 'File checks are still in progress.');
      return next;
    } catch (error) {
      if (!alive.current) return null;
      const uncertain = !(error instanceof FrontendServiceError) || ['unknown_outcome', 'invalid_response', 'aborted'].includes(error.code);
      if (uncertain) setUnknown(true); else if (!unknown) { workspace.resolvePendingOperation(operation.current); operation.current = ''; }
      setMessage(uncertain ? 'The upload result is not confirmed. Check its status before uploading again.' : serviceMessage(error)); return null;
    } finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  return { attachment, busy, unknown, message, upload, setMessage, stop: () => request.current?.abort(), reset: () => { if (locked.current || unknown) return false; setAttachment(null); operation.current = ''; setMessage(''); return true; } };
}
