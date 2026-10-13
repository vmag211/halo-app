'use client';

import { useEffect, useRef } from 'react';
import { Check, X } from 'lucide-react';
import { useHomeWorkspace } from '@/components/homeguard/HomeWorkspaceState';
import './workspace-feedback.css';

/** Quiet success feedback, with retained actionable errors and acknowledged save reconciliation. */
export default function WorkspaceFeedback() {
  const { message, pending, clearMessage, unknownOperations, reconcile } = useHomeWorkspace();
  const dismiss = useRef(clearMessage);
  useEffect(() => { dismiss.current = clearMessage; }, [clearMessage]);
  const succeeded = /^Saved\.|Workspace reset\./.test(message);
  useEffect(() => {
    if (!succeeded || pending) return;
    const timer = setTimeout(() => dismiss.current(), 4500);
    return () => clearTimeout(timer);
  }, [message, succeeded, pending]);
  if (!message) return null;
  if (pending || succeeded) return <div className="halo-workspace-toast" role="status">
    {pending ? <span className="halo-spinner" aria-hidden="true" /> : <Check size={17} aria-hidden="true" />}
    <span>{pending ? 'Saving' : message.startsWith('Workspace reset') ? 'Workspace reset' : 'Saved'}</span>
    {!pending && <button type="button" aria-label="Dismiss workspace message" onClick={clearMessage}><X size={17} aria-hidden="true" /></button>}
  </div>;
  return <div className="halo-workspace-error" role="alert"><p>{message}</p>{unknownOperations.map(operation => <button type="button" key={operation.operationId} disabled={pending} onClick={() => void reconcile(operation.operationId)}>Check save status</button>)}{!unknownOperations.length && <button type="button" aria-label="Dismiss workspace message" onClick={clearMessage}><X size={18} aria-hidden="true" /></button>}</div>;
}
