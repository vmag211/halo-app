'use client';

import { useId, useRef, useState } from 'react';
import { ArrowRight, NotebookPen, Plus, Trash2 } from 'lucide-react';
import { BottomSheet } from '@/components/ui/Foundation';
import { Confirm } from '@/components/homeguard/HomeWorkspaceUI';
import { useHomeCollection, useHomeDraft, useHomeWorkspace } from '@/components/homeguard/HomeWorkspaceState';
import LunaMark from '@/components/foundation/LunaMark';
import { blankFieldNote, fieldNoteError, initialFieldNotes, type FieldNote, type ExploreSection } from '@/lib/frontend/explore-preview';
import { companionIntent, noteSelectionIsCurrent, suggestedProjectKinds, type NoteSelection } from '@/lib/frontend/explore-companion';
import './explore-companion.css';

type Go = (section?: ExploreSection, view?: string, id?: string) => void;
type Props = { context: string; go?: Go; initialNoteId?: string; guide?: { title: string; instructions: string[]; source: string }; projectChoices?: { id: string; title: string; kind: string }[]; initialPanel?: 'luna'; onClose?: () => void; hideToolbar?: boolean };
const defaults = [{ id: 'demo-habitat-project', title: 'Plant a native pollinator space', kind: 'native' }, { id: 'bee-house', title: 'Build and maintain a bee house', kind: 'bee' }, { id: 'community-cleanup', title: 'Host a supported community cleanup', kind: 'cleanup' }, { id: 'solar-oven', title: 'Build a solar energy experiment', kind: 'solar' }];

/** Connected interaction study. No model requests, private transmission or API writes. */
export default function ExploreCompanion({ context, go, initialNoteId, guide, projectChoices = defaults, initialPanel, onClose, hideToolbar }: Props) {
  const workspace = useHomeWorkspace(); const collection = useHomeCollection<FieldNote>('exploreNotes', initialFieldNotes);
  const uid = useId();
  const [panel, setPanel] = useState<'note' | 'luna' | null>(initialPanel ?? null);
  const [draft, setDraft, clearDraft] = useHomeDraft<FieldNote>(`explore:quick-note:${context}`, { ...blankFieldNote(), noteType: 'Idea' });
  const noteId = useRef<string | null>(null); const [error, setError] = useState('');
  const [request, setRequest] = useHomeDraft(`explore:companion-request:${context}`, 'Find project ideas based on my selected notes');
  const [selected, setSelected] = useState<string[]>(initialNoteId ? [initialNoteId] : []);
  const [includePlace, setIncludePlace] = useState(false); const [includeDate, setIncludeDate] = useState(false);
  const [proposal, setProposal] = useState<{ request: string; selection: NoteSelection[]; text: string; intent: ReturnType<typeof companionIntent> } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const chosen = collection.records.filter(note => selected.includes(note.id));
  const current = proposal && (!proposal.selection.length || noteSelectionIsCurrent(collection.records, proposal.selection));
  const unavailable = workspace.pending || ['offline', 'loading', 'error'].includes(workspace.scenario);
  const open = (next: 'note' | 'luna') => { setError(''); setPanel(next); };
  const close = () => { setPanel(null); setProposal(null); onClose?.(); };
  const prepare = () => {
    if (!request.trim()) { setError('Tell Luna what you want to work on.'); return; }
    const intent = companionIntent(request);
    if (intent === 'delete' && !chosen.length) { setError('Select the exact notes you want to remove first.'); return; }
    setError('');
    setProposal({ request, intent, selection: chosen.map(({ id, revision }) => ({ id, revision })), text: chosen.map(note => `${note.title}\n${note.description}${includeDate && note.observedAt ? `\nDate: ${note.observedAt} (${note.timezone})` : ''}${includePlace && note.place ? `\nPlace: ${note.place}` : ''}`).join('\n\n') });
  };
  const matches = suggestedProjectKinds(proposal?.text ?? '');
  return <>
    {!hideToolbar && <div className="halo-companion" aria-label={`Tools for ${context}`}>
      <button onClick={() => open('note')}><Plus size={17} aria-hidden="true" /><span>Quick note</span></button>
      <button onClick={() => open('luna')}><LunaMark size={23} /><span>Work with Luna</span></button>
      {go && <button onClick={() => go('observations')} aria-label="Open my notes"><NotebookPen size={18} aria-hidden="true" /><span>My notes</span></button>}
    </div>}
    {panel === 'note' && <BottomSheet id={`quick-note-${uid}`} title="Keep a thought, right here" height="content" onClose={() => { if (!workspace.pending) setPanel(null); }}><form className="halo-companion-form" onSubmit={async event => {
      event.preventDefault(); if (unavailable) return;
      const invalid = fieldNoteError(draft); setError(invalid ?? ''); if (invalid) return;
      noteId.current ??= crypto.randomUUID();
      if (await collection.save({ ...draft, id: noteId.current })) { clearDraft(); noteId.current = null; setPanel(null); }
    }}><p>From {context}. Your note goes into the same private notebook, without leaving this screen.</p><fieldset className="halo-companion-entry" disabled={workspace.pending}><legend className="sr-only">Quick note details</legend><label>Note type<select value={draft.noteType} onChange={event => setDraft({ ...draft, noteType: event.target.value as FieldNote['noteType'] })}>{['Idea', 'Question', 'Observation', 'Conversation'].map(type => <option key={type}>{type}</option>)}</select></label><label>Note title<input required maxLength={160} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label><label>Your thought<textarea required maxLength={3000} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>{draft.noteType === 'Observation' && <label>Observed date and time<input required type="datetime-local" value={draft.observedAt} onChange={event => setDraft({ ...draft, observedAt: event.target.value })} /><small>Timezone: {draft.timezone}. Describe what you saw, without guessing a cause.</small></label>}<p className="halo-companion-meta">Private sample only, resets on reload. Nothing is shared with Luna when you save.</p>{error && <p role="alert">{error}</p>}<button className="halo-companion-primary" disabled={unavailable}>Save quick note</button><button type="button" onClick={() => setPanel(null)}>Close and keep draft</button></fieldset></form></BottomSheet>}
    {panel === 'luna' && <BottomSheet id={`context-luna-${uid}`} title="A next step with Luna" height="tall" onClose={close}><div className="halo-companion-form">
      <div className="halo-companion-identity"><LunaMark size={32} /><div><strong>{context}</strong><p>Interactive action preview, not a live AI conversation.</p></div></div>
      <label>What would you like to do?<textarea maxLength={1000} value={request} onChange={event => { setRequest(event.target.value); setProposal(null); }} /></label>
      <div className="halo-companion-prompts">{['Find project ideas based on my selected notes', 'Guide me through this project step', 'Delete my selected notes'].map(prompt => <button key={prompt} onClick={() => { setRequest(prompt); setProposal(null); }}>{prompt}</button>)}</div>
      <fieldset><legend>Choose notes, only if they help</legend><p>No notes are included automatically. Only checked titles and text enter the preview below.</p>{collection.records.map(note => <label className="halo-companion-check" key={note.id}><input type="checkbox" checked={selected.includes(note.id)} onChange={event => { setSelected(event.target.checked ? [...selected, note.id] : selected.filter(id => id !== note.id)); setProposal(null); }} /><span>{note.title}<small>Revision {note.revision} · {note.noteType ?? 'Observation'}</small></span></label>)}{!collection.records.length && <p>Your notebook is empty. You can still browse projects or add a quick note.</p>}<label className="halo-companion-check"><input type="checkbox" checked={includeDate} onChange={event => { setIncludeDate(event.target.checked); setProposal(null); }} />Include selected note dates</label><label className="halo-companion-check"><input type="checkbox" checked={includePlace} onChange={event => { setIncludePlace(event.target.checked); setProposal(null); }} />Include selected place labels</label></fieldset>
      <button className="halo-companion-primary" disabled={unavailable} onClick={prepare}>Preview Luna response</button>{error && <p role="alert">{error}</p>}
      {proposal && <section className="halo-companion-proposal" aria-label="Luna action preview"><h3>{proposal.intent === 'delete' ? 'Review the exact removal' : proposal.intent === 'guide' ? 'Work through the next step' : 'Projects you could try'}</h3><details><summary>Review the request and selected context</summary><pre>{proposal.request}\n\n{proposal.text || 'No private notes selected.'}</pre><p>Other notes, Homeguard records, Journal text and household location are excluded. No model receives this text in the preview.</p></details>{!current ? <p role="alert">A selected note changed or was deleted. Preview the request again before continuing.</p> : proposal.intent === 'delete' ? <><p>Remove {proposal.selection.length} selected note{proposal.selection.length === 1 ? '' : 's'} and their own case history. Independent My Week tasks, other records and previously copied messages remain.</p><ul>{chosen.map(note => <li key={note.id}>{note.title}</li>)}</ul><button className="halo-companion-danger" disabled={unavailable} onClick={() => setConfirmDelete(true)}><Trash2 size={16} aria-hidden="true" />Review deletion</button></> : proposal.intent === 'guide' ? guide ? <><h4>{guide.title}</h4><ol>{guide.instructions.map(line => <li key={line}>{line}</li>)}</ol><a href={guide.source} target="_blank" rel="noreferrer">Read the source instructions</a><p>You decide when a step is complete. Luna does not check it off.</p></> : <><p>Open a project guide for specific instructions, materials and safety checks. I can help you read the current step there.</p>{go && <button onClick={() => { setPanel(null); go('projects'); }}>Choose a guided project <ArrowRight size={17} /></button>}</> : <><p>{proposal.text ? 'These matches use only the themes in your selected text. They do not infer site suitability or a measured environmental benefit.' : 'Start with a reviewed guide. Choose one that fits your space, permission and capacity.'}</p>{projectChoices.filter(item => matches.includes(item.kind)).map(item => <button className="halo-companion-project" key={item.id} disabled={!go} onClick={() => { setPanel(null); go?.('projects', 'detail', item.id); }}><span><strong>{item.title}</strong><small>Materials, instructions and a follow-up</small></span><ArrowRight size={18} /></button>)}<p className="halo-companion-meta">Deterministic catalogue matching demonstrates the proposed Luna flow. Live note-based generation requires new backend capabilities and privacy controls.</p></>}</section>}
      <p className="halo-companion-meta">No external action, email, registration or production note deletion occurs. Real assistant tools must verify ownership and revisions, show exact scope, and wait for confirmation.</p>
    </div></BottomSheet>}
    {confirmDelete && proposal && <Confirm title="Delete these selected notes?" danger confirmLabel="Yes, delete" cancelLabel="No, keep it" onCancel={() => setConfirmDelete(false)} onConfirm={async () => { if (await workspace.removeNotes(proposal.selection)) { setSelected([]); setProposal(null); setConfirmDelete(false); setError('Selected notes removed from this sample visit only.'); } }}><ul>{chosen.map(note => <li key={note.id}>{note.title}</li>)}</ul><p>Only these notes and their own case history are removed. Independent tasks and copied text stay. This cannot be undone in this sample visit.</p></Confirm>}
  </>;
}
