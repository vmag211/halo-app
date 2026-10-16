'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, NotebookPen, Plus, Search, Star } from 'lucide-react';
import { DeletableRecord } from '@/components/homeguard/HomeWorkspaceUI';
import { useHomeCollection, useHomeDraft, useHomeWorkspace } from '@/components/homeguard/HomeWorkspaceState';
import LunaMark from '@/components/foundation/LunaMark';
import { blankFieldNote, fieldNoteError, initialFieldNotes, type ExploreSection, type FieldNote } from '@/lib/frontend/explore-preview';
import { blankEvidence } from './MapRecordToExplore';
import ExploreOutcome from './ExploreOutcome';
import { SaveExplore } from './ExploreShared';
import NoteHandoff from './NoteHandoff';
import { handoffStatus, noteHandoffCopy } from '@/lib/frontend/note-handoff-preview';
import './explore-notebook.css';
import { NotePhotoEditor, NotePhotoDetail } from './NotePhoto';
import {useProductionRuntime} from '@/components/production/ProductionContext';
import ProductionNoteLuna from './ProductionNoteLuna';
import {usePrivateUpload} from '@/components/homeguard/usePrivateUpload';
import {PrivateAttachmentDownload,PrivateObservationPhoto} from '@/components/homeguard/PrivateAttachments';

type Go = (section?: ExploreSection, view?: string, id?: string) => void;
type CaptureNavigation = () => () => boolean;
const types = ['Observation', 'Question', 'Idea', 'Conversation'] as const;
const dateLabel = (note: FieldNote) => note.observedAt ? `${note.observedAt.replace('T', ' ')} (${note.timezone})` : 'No date supplied';

export default function ExploreNotes({ go, view, id, mapHref, captureNavigation }: { go: Go; view: string; id: string; mapHref: (layer: string) => string; captureNavigation: CaptureNavigation }) {
  const workspace = useHomeWorkspace();
  const collection = useHomeCollection<FieldNote>('exploreNotes', initialFieldNotes);
  const [filters, setFilters] = useHomeDraft<{ search: string; type: string; pinned: boolean; archive?: string }>('explore:note-filters', { search: '', type: 'All notes', pinned: false, archive: 'Active' });
  const record = collection.records.find(item => item.id === id);
  if (view === 'new' || view === 'edit') return <NoteForm key={id || 'new'} record={record} edit={view === 'edit'} save={collection.save} go={go} captureNavigation={captureNavigation} />;
  if (view === 'detail') {
    if (!record) return <div className="ex-empty"><h3>This note is unavailable</h3><button className="ex-button" onClick={() => go('observations')}>All notes</button></div>;
    return <NoteDetail key={record.id} record={record} save={collection.save} go={go} mapHref={mapHref} />;
  }
  const matches = collection.records.filter(note => ((filters.archive ?? 'Active') === 'All' || (filters.archive === 'Archived' ? note.archived : !note.archived)) && `${note.title} ${note.description}`.toLowerCase().includes(filters.search.toLowerCase()) && (filters.type === 'All notes' || (note.noteType ?? 'Observation') === filters.type) && (!filters.pinned || note.pinned)).sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
  return <section className="ex-detail ex-notebook-workspace">
    <div className="ex-notebook-toolbar"><p className="ex-meta">{collection.records.length} private note{collection.records.length === 1 ? '' : 's'}</p><button className="ex-button" onClick={() => go('observations', 'new')}><Plus size={18} aria-hidden="true" />Add a note</button></div>
    <div className="ex-notebook-filters"><label><span className="halo-sr">Search my notes</span><span className="ex-search"><Search size={18} aria-hidden="true" /><input type="search" placeholder="Search your notebook" value={filters.search} onChange={event => setFilters({ ...filters, search: event.target.value })} /></span></label><label><span className="halo-sr">Note type</span><select value={filters.type} onChange={event => setFilters({ ...filters, type: event.target.value })}>{['All notes', ...types].map(value => <option key={value}>{value}</option>)}</select></label><label className="ex-check"><input type="checkbox" checked={filters.pinned} onChange={event => setFilters({ ...filters, pinned: event.target.checked })} />Only pinned notes</label><label><span className="halo-sr">Note archive</span><select value={filters.archive ?? 'Active'} onChange={event => setFilters({ ...filters, archive: event.target.value })}>{['Active', 'Archived', 'All'].map(value=><option key={value}>{value}</option>)}</select></label></div>
    <div className="ex-notebook">{matches.map(note => <DeletableRecord key={note.id} title={note.title} deletion={{ remove: () => collection.remove(note.id), description: 'Deletes this note only. Saved tasks and previously copied text stay.' }}><button className="ex-note-row" onClick={() => go('observations', 'detail', note.id)}><span className="ex-kicker">{note.pinned && <Star size={13} aria-label="Pinned" />} {note.noteType ?? 'Observation'}{note.archived ? ' · Archived' : ''}</span><strong>{note.title}</strong><small>{note.description.slice(0, 110)}{note.description.length > 110 ? '…' : ''}</small></button></DeletableRecord>)}</div>
    {!matches.length && <div className="ex-empty"><NotebookPen size={25} aria-hidden="true" /><h3>{collection.records.length ? 'No notes match these filters' : 'Your notebook is ready'}</h3><p>{collection.records.length ? 'Try another phrase or show all note types.' : 'Keep a question, record an observation, or start with an idea.'}</p>{collection.records.length > 0 && <button className="ex-text-button" onClick={() => setFilters({ search: '', type: 'All notes', pinned: false, archive: 'All' })}>Reset note filters</button>}</div>}
    {workspace.scenario === 'stale' && <p className="ex-meta">Review note dates before using them as context.</p>}
  </section>;
}

function NoteDetail({ record, save, go, mapHref }: { record: FieldNote; save: (note: FieldNote) => Promise<boolean>; go: Go; mapHref: (layer: string) => string }) {
  const workspace = useHomeWorkspace();
  return <section className="ex-detail"><button className="ex-text-button" onClick={() => go('observations')}>All notes</button><span className="ex-kicker">Private · {record.noteType ?? 'Observation'}</span><h3>{record.title}</h3><p className="ex-meta">{record.archived ? 'Archived · ' : ''}{handoffStatus(record)}</p><div className="ex-note-page"><p>{record.description}</p><small>{dateLabel(record)}</small>{record.place && <small>Private place label: {record.place}</small>}{(!record.noteType || record.noteType === 'Observation') && <small>Observed appearance is not proof of a cause.</small>}</div>{record.photoAttachment && <PrivateObservationPhoto {...record.photoAttachment} />}{record.photo && <NotePhotoDetail photo={record.photo}/>}<div className="ex-tools"><button onClick={() => go('observations', 'edit', record.id)}>Edit note</button><button disabled={workspace.pending || workspace.scenario === 'offline'} onClick={() => save({ ...record, pinned: !record.pinned })}>{record.pinned ? 'Unpin note' : 'Pin note'}</button></div>{Boolean(record.evidence?.length) && <section className="ex-public-context"><h4>Public context I kept</h4>{record.evidence?.map(item => <article key={item.layer+item.recordId}><strong>{item.title}</strong><small>{item.observedAt ?? 'No observation date supplied'}</small><p>{item.scope}</p><a className="ex-text-button" href={mapHref(item.layer)+'&system='+encodeURIComponent(item.recordId)}>Return to this public map record</a></article>)}<p className="ex-meta">Public references do not establish the cause of your observation.</p></section>}<NoteLuna record={record} /><ExploreOutcome origin={`note-case:${record.id}`} title="Turn this note into a useful case" goal={record.noteType === 'Idea' ? 'Review this idea with a qualified resource and choose a practical next step.' : record.noteType === 'Question' ? record.description.slice(0, 500) : 'Understand this observation without guessing its cause, and decide whether a qualified resource or official report is appropriate.'} mechanism="Keep the original note, a factual question, any reply or reference, and the next action connected without publishing it." /><NoteHandoff record={record}/><details className="ex-disclosure ex-note-archive"><summary>Organize this note</summary><p>{noteHandoffCopy.archive}</p><button className="ex-text-button" disabled={workspace.pending || workspace.scenario === 'offline'} onClick={()=>save({...record,archived:!record.archived})}>{record.archived ? 'Restore note' : 'Archive note'}</button></details><button className="ex-text-button" onClick={() => go('outreach')}>Choose this note in an outreach draft <ArrowRight size={16} aria-hidden="true" /></button><SaveExplore origin={`note:${record.id}`} title="Follow up on my note" reason="Review the note and any question or external response. No message or report is sent by saving." /></section>;
}

function NoteLuna({ record }: { record: FieldNote }) {
 const runtime=useProductionRuntime();return runtime?<ProductionNoteLuna record={record}/>:<ReviewNoteLuna record={record}/>;
}
function ReviewNoteLuna({ record }: { record: FieldNote }) {
  const [selection, setSelection] = useState({ title: true, description: true, time: false, place: false, evidence: false });
  const [purpose, setPurpose] = useState('Clarify my question');
  const [consent, setConsent] = useState(false); const [preview, setPreview] = useState('');
  const [preparedRevision, setPreparedRevision] = useState<number | null>(null);
  const fields = { title: record.title, description: record.description, time: dateLabel(record), place: record.place || 'Not supplied', evidence: record.evidence?.map(item => `${item.title}, ${item.observedAt ?? 'Date unknown'}. ${item.scope}`).join('\n') || 'No public context selected' };
  const stale = preparedRevision !== null && preparedRevision !== record.revision;
  return <details className="ex-disclosure ex-luna-context"><summary><LunaMark size={23} />Prepare with Luna</summary><p className="ex-meta">For immediate danger, contact local emergency services. HALO and Luna are not emergency reporting channels.</p><p>Choose the note details you want Luna to use.</p><label>What would you like help with?<select value={purpose} onChange={event => { setPurpose(event.target.value); setPreview(''); setConsent(false); }}>{['Clarify my question', 'Find a follow-up', 'Organize my observation'].map(value => <option key={value}>{value}</option>)}</select></label><div className="ex-checklist">{Object.entries({ title: 'Note title', description: 'Description', time: 'Date and timezone', place: 'Place label', evidence: 'Selected public map context' }).map(([key, label]) => <label className="ex-check" key={key}><input type="checkbox" checked={selection[key as keyof typeof selection]} onChange={event => { setSelection({ ...selection, [key]: event.target.checked }); setConsent(false); setPreview(''); }} />{label}</label>)}</div><label className="ex-check"><input type="checkbox" checked={consent} onChange={event => { setConsent(event.target.checked); setPreview(''); }} />I choose only these fields for this request</label><button className="ex-button" disabled={!consent || !Object.values(selection).some(Boolean)} onClick={() => { setPreview(`${purpose}. Do not infer a cause or treat this note as a verified measurement.\n\n${Object.entries(fields).filter(([key]) => selection[key as keyof typeof selection]).map(([key, value]) => `${key}: ${value}`).join('\n')}`); setPreparedRevision(record.revision); }}>Review Luna request</button>{preview && <div className="ex-luna-request" role="status"><h4>Selected context</h4>{stale ? <p>This note changed. Review the current details again.</p> : <pre>{preview}</pre>}<p className="ex-meta">Selected context is not sent automatically.</p></div>}</details>;
}

function NoteForm({ record, edit, save, go, captureNavigation }: { record?: FieldNote; edit: boolean; save: (note: FieldNote) => Promise<boolean>; go: Go; captureNavigation: CaptureNavigation }) {
  const upload = usePrivateUpload();
  const [stableId] = useState(() => record?.id || crypto.randomUUID());
  const workspace = useHomeWorkspace(); const [starter, , clearStarter] = useHomeDraft('explore:note-starter', '');
  const [evidenceStarter, , clearEvidence] = useHomeDraft('explore:note-evidence-starter', blankEvidence);
  const initial = record ?? { ...blankFieldNote(), ...(starter ? { title: 'A question about my community', description: starter, noteType: 'Question' as const, evidence: evidenceStarter.recordId ? [evidenceStarter] : [] } : {}) };
  const draftKey = `explore:note:${record?.id ?? 'new'}`;
  const [draft, setDraft] = useHomeDraft(draftKey, initial);
  const alive = useRef(true);
  const navigationIntent = useRef(0);
  useEffect(() => {
    alive.current = true;
    // Observe navigation before an asynchronous route transition can unmount this form.
    // The write still completes; only its optional detail-screen redirect is suppressed.
    const leaving = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
      const next = new URL(link.href, window.location.href);
      if (next.origin === window.location.origin && next.pathname + next.search !== window.location.pathname + window.location.search) navigationIntent.current++;
    };
    const historyChanged = () => { navigationIntent.current++; };
    document.addEventListener('click', leaving, true);
    window.addEventListener('popstate', historyChanged);
    return () => {
      alive.current = false;
      document.removeEventListener('click', leaving, true);
      window.removeEventListener('popstate', historyChanged);
    };
  }, []);
  const [photoPending,setPhotoPending]=useState(false);
  const [error, setError] = useState(''); const pendingId = useRef<string | null>(null);
  const observed = !draft.noteType || draft.noteType === 'Observation';
  async function submit() {
    if (photoPending || upload.busy || upload.unknown) { setError('Review the selected photo or check its upload before saving.'); return; }
    const invalid = fieldNoteError(draft); setError(invalid ?? ''); if (invalid) return;
    const navigationUnchanged = captureNavigation();
    const intentAtSave = navigationIntent.current;
    const locationAtSave = window.location.pathname + window.location.search;
    pendingId.current ??= stableId;
    const next = { ...draft, id: pendingId.current };
    if (workspace.mode === 'production' && draft.photo) {
      if (draft.photo.metadataRemoved !== true || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(draft.photo.data)) { setError('Prepare and review the private photo again.'); return; }
      const bytes = Uint8Array.from(atob(draft.photo.data.split(',')[1]), character => character.charCodeAt(0));
      const file = new Blob([bytes], { type: 'image/png' });
      const attachment = upload.attachment?.status === 'ready' ? upload.attachment : await upload.upload({ collection: 'exploreNotes', recordId: pendingId.current, file, name: 'halo-observation.png', metadataRemoved: true, reviewed: true });
      if (attachment?.status !== 'ready') return;
      next.photo = undefined; next.photoAttachment = { id: attachment.id, revision: attachment.revision, name: 'halo-observation.png', metadataRemoved: true };
    }
    if (await save(next)) {
      // A confirmed save retires only its own draft, even if the user has left.
      // Reference checks keep any newer writing or incoming context untouched.
      workspace.clearDraft(draftKey, draft);
      workspace.clearDraft('explore:note-starter', starter);
      workspace.clearDraft('explore:note-evidence-starter', evidenceStarter);
      if (alive.current && navigationUnchanged() && navigationIntent.current === intentAtSave && window.location.pathname + window.location.search === locationAtSave) go('observations', 'detail', next.id);
    }
  }
  if (edit && !record) return <div className="ex-empty"><h3>This note is unavailable</h3><button className="ex-button" onClick={() => go('observations')}>All notes</button></div>;
  return <form className="ex-form" onSubmit={event => { event.preventDefault(); void submit(); }}><h3>{edit ? 'Edit your note' : 'Make a little room for a thought.'}</h3>{!record && starter && draft.description !== starter && <aside className="ex-notice"><p>You already have an unfinished draft. Keep your writing, or append the community question you selected.</p><p>{starter}</p><button type="button" className="ex-text-button" onClick={() => { const description = `${draft.description}\n\n${starter}`.trim(); if (description.length > 3000) { setError('This question will not fit in the current note. Save your writing first, then create a separate question note.'); return; } setDraft({ ...draft, description, evidence: evidenceStarter.recordId ? [...(draft.evidence ?? []).filter(item => !(item.recordId === evidenceStarter.recordId && item.layer === evidenceStarter.layer)), evidenceStarter] : draft.evidence }); clearStarter(); clearEvidence(); }}>Add this question to my draft</button><button type="button" className="ex-text-button" onClick={() => { clearStarter(); clearEvidence(); }}>Keep my draft as it is</button></aside>}{upload.message && <p role="status">{upload.message}</p>}{upload.unknown && <button type="button" className="ex-button" disabled={upload.busy} onClick={() => void upload.upload()}>Check photo upload status</button>}<fieldset className="ex-note-fields" disabled={workspace.pending || upload.busy || upload.unknown}><label>Note type<select value={draft.noteType ?? 'Observation'} onChange={event => setDraft({ ...draft, noteType: event.target.value as FieldNote['noteType'] })}>{types.map(value => <option key={value}>{value}</option>)}</select></label><label>Title (required)<input required maxLength={160} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>{observed && <label>What you noticed<select value={draft.kind} onChange={event => setDraft({ ...draft, kind: event.target.value })}>{['Appearance', 'Odor', 'Litter', 'Habitat', 'Other'].map(value => <option key={value}>{value}</option>)}</select></label>}<label>{observed ? 'Observed date and time (required)' : 'Date and time (optional)'}<input required={observed} type="datetime-local" value={draft.observedAt} onChange={event => setDraft({ ...draft, observedAt: event.target.value })} /></label><label>Timezone<input value={draft.timezone} onChange={event => setDraft({ ...draft, timezone: event.target.value })} /></label><label>Coarse place label (optional)<input maxLength={160} value={draft.place} onChange={event => setDraft({ ...draft, place: event.target.value })} /></label><label>{observed ? 'Factual description (required)' : 'Your note (required)'}<textarea required maxLength={3000} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>{draft.photoAttachment && !draft.photo && <div className="ex-photo-review"><PrivateAttachmentDownload attachmentId={draft.photoAttachment.id} revision={draft.photoAttachment.revision} name={draft.photoAttachment.name} image /><button type="button" className="ex-text-button" onClick={()=>setDraft({...draft,photoAttachment:undefined})}>Remove photo when saving</button></div>}<NotePhotoEditor photo={draft.photo} onChange={photo=>{if(upload.reset())setDraft({...draft,photo});}} disabled={workspace.pending || upload.busy || upload.unknown} onPendingChange={setPhotoPending}/>{workspace.mode === 'production' && draft.photo && <p className="ex-meta">Only this reviewed, processed photo will be uploaded privately when you save the note.</p>}<label className="ex-check"><input type="checkbox" checked={Boolean(draft.pinned)} onChange={event => setDraft({ ...draft, pinned: event.target.checked })} />Pin this note</label></fieldset><p className="ex-meta">{observed ? 'Describe what you observed from a safe place. Appearance or odor alone does not identify a contaminant.' : 'Keep a question or idea without having to supply an observation date.'} Nothing is sent to Luna or an external contact when you save.</p>{error && <p role="alert">{error}</p>}<button className="ex-button" disabled={workspace.pending || workspace.scenario === 'offline' || photoPending || upload.busy || upload.unknown}>Save note</button><button type="button" className="ex-text-button" disabled={upload.busy || upload.unknown} onClick={() => go('observations')}>Back and keep draft</button></form>;
}
