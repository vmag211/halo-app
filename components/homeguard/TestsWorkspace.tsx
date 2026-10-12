'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, ClipboardList, Download, FileText, FlaskConical, History, Plus, Search } from 'lucide-react';
import Button from '@/components/ui/Button';
import { useExpandedPreview } from '@/components/expanded/ExpandedPreviewState';
import type { FactorKey } from '@/lib/frontend/factor-preview';
import { initialGardens, type GardenSite } from '@/lib/frontend/home-food-preview';
import { comparisonIssues, correctResults, duplicateAnalytes, emptyResult, emptyTest, resultIssues, resultQualifiers, sampleTests, testContexts, testDraftErrors, testExport, testKinds, testStatuses, testStatusLabels, type TestRecord, type TestResultRow } from '@/lib/frontend/home-test-preview';
import { useHomeCollection, useHomeDraft } from './HomeWorkspaceState';
import { ActionButton, Confirm, DeleteButton, Empty, Field, PageIntro, RecordForm, SourceNote, WorkspaceLink, type WorkspaceProps } from './HomeWorkspaceUI';
import TestProgress, { type TestProgressStep } from './TestProgress';
import './records-polish.css';

type Save = (record: TestRecord) => Promise<boolean>;
const kindLabels = { water: 'Drinking water', radon: 'Radon', lead: 'Lead', soil: 'Soil or garden' };
const reviewLabels = { not_received: 'No result yet', unreviewed: 'Transcription not confirmed', needs_clarification: 'Needs clarification', user_confirmed: 'Transcription confirmed by you' };
type TestContext = { id: string; label: string; state: string; revision?: number; irrigation?: string };
const contextLabel = (id: string, contexts: readonly TestContext[] = testContexts) => contexts.find(context => context.id === id)?.label ?? 'Historical context, no longer listed';
const factorFor = (record: TestRecord): FactorKey => record.kind === 'radon' ? 'radon' : record.kind === 'lead' ? 'lead' : 'pfas';
function useTestContexts(): TestContext[] {
  const gardens = useHomeCollection<GardenSite>('gardens', initialGardens);
  return [...testContexts.filter(context => context.state !== 'Garden site'), ...gardens.records.map(site => ({ id: site.id, label: site.title, state: 'Garden site', revision: site.revision, irrigation: site.irrigation }))];
}
const snapshotContext = (context?: TestContext) => context ? { label: context.label, ...(context.revision ? { revision: context.revision } : {}), ...(context.irrigation ? { irrigation: context.irrigation } : {}) } : undefined;

function Errors({ errors }: { errors: string[] }) {
  return errors.length ? <div className="hg-error" role="alert"><strong>Check these details</strong><ul>{errors.map(error => <li key={error}>{error}</li>)}</ul></div> : null;
}

function ResultsTable({ rows }: { rows: TestResultRow[] }) {
  const label = useId();
  return <div className="hg-table-wrap" role="region" tabIndex={0} aria-labelledby={label}><table className="hg-table"><caption id={label}>Original user-entered result transcription<span className="hg-table-hint">Scroll sideways to see all columns.</span></caption><thead><tr><th scope="col">Analyte</th><th scope="col">Reported result</th><th scope="col">Qualifier and limit</th><th scope="col">Report</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><th scope="row">{row.analyte || 'Not entered'}</th><td>{row.originalValue || 'Not reported'} {row.originalUnit}<br /><small>{row.basis || 'Basis not supplied'}</small></td><td>{resultQualifiers[row.qualifier]}<br /><small>{row.limit ? `Limit: ${row.limit} ${row.limitUnit || '(unit missing)'}` : 'No limit supplied'}</small></td><td>{row.reportDate || 'Date not supplied'}<br /><small>{row.reportReference || 'No reference'}</small></td></tr>)}</tbody></table></div>;
}

export default function TestsWorkspace(props: WorkspaceProps) {
  const collection = useHomeCollection<TestRecord>('tests', sampleTests);
  const record = collection.records.find(item => item.id === props.recordId);
  const view = props.view || 'list';
  if (view === 'new' || view === 'prepare' || view === 'report') return <TestEditor key={view === 'report' ? 'report' : 'new'} {...props} save={collection.save} />;
  if (view === 'list' || view === 'overview') return <TestsList {...props} records={collection.records} remove={collection.remove} />;
  if (!record) return <Empty title="This test record is unavailable" action={<Button onClick={() => props.navigate('list')}>Back to tests</Button>}>The record may have been removed from this review. No other household record is substituted.</Empty>;
  if (view === 'edit') return <TestEditor key={`edit-${record.id}`} {...props} record={record} save={collection.save} />;
  if (view === 'arranged') return <ArrangementEditor key={`arranged-${record.id}`} {...props} record={record} save={collection.save} />;
  if (view === 'collect' || view === 'awaiting') return <CollectionEditor key={`${view}-${record.id}`} {...props} record={record} save={collection.save} />;
  if (view === 'results') return <ResultEditor key={`results-${record.id}`} {...props} record={record} save={collection.save} />;
  if (view === 'compare') return <CompareTests {...props} record={record} records={collection.records} />;
  if (view === 'export') return <TestExport {...props} record={record} />;
  if (view === 'attachments') return <div className="hg-stack"><BackToTest {...props} record={record} /><PageIntro eyebrow="Private files" title="Review a report" description="Inspect a local original, then enter the reported fields yourself." icon={<FileText />} /><LocalAttachmentReview /><WorkspaceLink title="Enter or correct result rows" detail="Original values and your transcription stay distinct." onClick={() => props.navigate('results', record.id)} icon={<ArrowRight />} /></div>;
  if (view === 'history') return <TestHistory {...props} record={record} />;
  return <TestDetail {...props} record={record} save={collection.save} remove={collection.remove} />;
}

function BackToTest({ navigate, record }: WorkspaceProps & { record: TestRecord }) {
  return <button className="hg-back" type="button" onClick={() => navigate('detail', record.id)}><ArrowLeft size={16} />Back to test</button>;
}

function TestsList({ records, navigate, factor, remove }: WorkspaceProps & { records: TestRecord[]; remove: (id: string) => Promise<boolean> }) {
  const contexts = useTestContexts();
  const [filters, setFilters] = useHomeDraft(`view:tests:filters:${factor ?? 'all'}`, { search: '', kind: factor === 'radon' || factor === 'lead' ? factor : factor === 'pfas' ? 'water' : 'all', status: 'all', context: 'all', archived: false });
  const { search, kind, status, context, archived } = filters;
  const setSearch = (search: string) => setFilters(previous => ({ ...previous, search }));
  const setKind = (kind: string) => setFilters(previous => ({ ...previous, kind }));
  const setStatus = (status: string) => setFilters(previous => ({ ...previous, status }));
  const setContext = (context: string) => setFilters(previous => ({ ...previous, context }));
  const setArchived = (archived: boolean) => setFilters(previous => ({ ...previous, archived }));
  const visible = records.filter(record => record.archived === archived && (kind === 'all' || record.kind === kind) && (status === 'all' || record.status === status) && (context === 'all' || record.contextId === context) && `${record.title} ${record.provider} ${record.purpose} ${record.rows.map(row => row.analyte).join(' ')}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <div className="hg-stack">
    <PageIntro eyebrow="Homeguard" title="Home tests & reports" description="Keep real-world water, radon, lead and soil tests in one place." icon={<FlaskConical />} />
    <div className="hg-choice-grid">
      <WorkspaceLink title="Plan a test" detail="Track a test you arrange outside HALO." artwork="tests" onClick={() => navigate('new')} />
      <WorkspaceLink title="Add a report" detail="Already have results? Start here." artwork="report" onClick={() => navigate('report')} />
    </div>
    <p className="hg-inline-meta">HALO keeps your records. It does not perform tests or automatically change your score.</p>
    <section className="hg-stack" aria-label="Filter tests">
      <Field label="Search records"><div className="hg-search"><Search size={17} aria-hidden="true" /><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Test name, lab or substance" /></div></Field>
      <details className="hg-filter-details" open={kind !== 'all' || status !== 'all' || context !== 'all' || archived ? true : undefined}><summary>Filter records{kind !== 'all' || status !== 'all' || context !== 'all' || archived ? ' · Active' : ''}</summary><div className="hg-fields">
        <Field label="Test kind"><select value={kind} onChange={event => setKind(event.target.value)}><option value="all">All test kinds</option>{testKinds.map(value => <option key={value} value={value}>{kindLabels[value]}</option>)}</select></Field>
        <Field label="Progress"><select value={status} onChange={event => setStatus(event.target.value)}><option value="all">All progress</option>{testStatuses.map(value => <option key={value} value={value}>{testStatusLabels[value]}</option>)}</select></Field>
        <Field label="Home or site"><select value={context} onChange={event => setContext(event.target.value)}><option value="all">All homes and sites</option>{contexts.map(value => <option key={value.id} value={value.id}>{value.label}</option>)}</select></Field>
        <label className="hg-option"><input type="checkbox" checked={archived} onChange={event => setArchived(event.target.checked)} /><span>Show archived records</span></label>
      </div></details>
    </section>
    <div className="hg-section-head"><h2>{archived ? 'Archived records' : 'Your records'}</h2><span className="hg-meta" role="status">{visible.length} {visible.length === 1 ? 'record' : 'records'}</span>{visible.length > 0 && (search || kind !== 'all' || status !== 'all' || context !== 'all' || archived) && <button type="button" className="hg-text-button" onClick={() => setFilters({ search: '', kind: 'all', status: 'all', context: 'all', archived: false })}>Reset filters</button>}</div>
    {visible.length ? <div className="hg-list">{visible.map(record => <WorkspaceLink key={record.id} deletion={{ remove: () => remove(record.id), description: 'This removes this test, its entered results and correction history. Separate My Week actions and other household records are kept.' }} onClick={() => navigate('detail', record.id)} title={record.title} detail={`${kindLabels[record.kind]} · ${testStatusLabels[record.status]} · ${(record.contextSnapshot?.label ?? contextLabel(record.contextId, contexts))}${record.review === 'needs_clarification' ? ' · Needs clarification' : ''}`} icon={record.status === 'awaiting' ? <CalendarDays /> : <FileText />} />)}</div> : <Empty title={records.length ? 'No records match these filters' : 'Start your home record'} action={<Button onClick={() => records.length ? (setSearch(''), setKind('all'), setStatus('all'), setContext('all'), setArchived(false)) : navigate('new')}>{records.length ? 'Reset filters' : 'Add a test'}</Button>}>{records.length ? 'Try another test kind, context, or search.' : 'Add a planned test or a report you already have.'}</Empty>}
  </div>;
}

function TestEditor({ record, recordId, save, navigate, factor, view }: WorkspaceProps & { record?: TestRecord; save: Save }) {
  const contexts = useTestContexts();
  const linkedContext = contexts.find(context => context.id === recordId);
  const initial = record ?? { ...emptyTest(), contextId: linkedContext?.id ?? '', contextSnapshot: snapshotContext(linkedContext), kind: factor === 'radon' || factor === 'lead' ? factor : 'water' as const };
  const addingReport = !record && view === 'report';
  const [draft, setDraft, clearDraft] = useHomeDraft<TestRecord>(`tests:${record ? `edit:${record.id}` : `${addingReport ? 'report' : 'new'}:${recordId ?? 'default'}`}`, initial);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [discard, setDiscard] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const set = <K extends keyof TestRecord>(key: K, value: TestRecord[K]) => setDraft({ ...draft, [key]: value });
  const leave = () => navigate(record ? 'detail' : 'list', record?.id);
  async function submit() {
    const found = testDraftErrors(draft); setErrors(found); if (found.length || busy) return;
    setBusy(true);
    const next = { ...draft, arrangedByUser: draft.arrangedByUser || draft.status === 'arranged', id: record?.id ?? (draft.id === 'draft-test' ? `test-${crypto.randomUUID()}` : draft.id) };
    if (!record && draft.id === 'draft-test') setDraft(next);
    if (await save(next)) { clearDraft(); navigate(addingReport ? 'results' : 'detail', next.id); }
    setBusy(false);
  }
  return <div className="hg-stack"><PageIntro eyebrow="Home tests & reports" title={record ? 'Edit test details' : addingReport ? 'Add an existing report' : 'Plan a test'} description={addingReport ? 'First identify the sample. Next, copy the results from your report.' : 'Choose what and where to test. You arrange the test with a provider outside HALO.'} icon={<FlaskConical />} /><RecordForm onSubmit={submit} onCancel={leave} submitLabel={record ? 'Save test details' : addingReport ? 'Continue to results' : 'Save test plan'} busy={busy}>
    <Errors errors={errors} />
    <Field label="Test label (required)"><input required maxLength={160} value={draft.title} onChange={event => set('title', event.target.value)} placeholder="For example, kitchen tap test" /></Field>
    <div className="hg-grid"><Field label="Test kind (required)"><select value={draft.kind} onChange={event => set('kind', event.target.value as TestRecord['kind'])}>{testKinds.map(kind => <option key={kind} value={kind}>{kindLabels[kind]}</option>)}</select></Field><Field label="Sample medium (required)"><select required value={draft.medium} onChange={event => set('medium', event.target.value)}><option value="">Choose the medium</option><option value="water">Water</option><option value="air">Air</option><option value="soil">Soil</option><option value="tissue">Tissue</option><option value="unknown">Unknown</option></select></Field></div>
    <Field label="Home or site context (required)" hint="Historical tests keep their original context when you move."><select required value={draft.contextId} onChange={event => setDraft({ ...draft, contextId: event.target.value, contextSnapshot: snapshotContext(contexts.find(context => context.id === event.target.value)) })}><option value="">Choose the sample context</option>{draft.contextId && !contexts.some(context => context.id === draft.contextId) && <option value={draft.contextId}>Retained historical context</option>}{contexts.map(context => <option value={context.id} key={context.id}>{context.label} ({context.state})</option>)}</select></Field>
    <Field label="Purpose (required)"><textarea required maxLength={600} value={draft.purpose} onChange={event => set('purpose', event.target.value)} placeholder="What would you like this test to document?" /></Field>
    <Field label="Lab or provider (optional)" hint="Enter the name on the report or leave it blank."><input maxLength={160} value={draft.provider} onChange={event => set('provider', event.target.value)} /></Field>
    {!addingReport && <><div className="hg-grid"><Field label="Proposed test date (optional)"><input type="date" value={draft.plannedDate} onChange={event => set('plannedDate', event.target.value)} /></Field>{!record && <Field label="Current progress"><select value={draft.status} onChange={event => set('status', event.target.value as TestRecord['status'])}><option value="draft">Still preparing</option><option value="arranged">Already arranged</option></select></Field>}</div><p className="hg-meta">Ask your provider which kit to use, how to collect the sample and what it costs.</p></>}
    {record?.rows.length ? <SourceNote>Changing context or method can change whether a record is comparable. Original result rows and correction history are retained.</SourceNote> : null}
    <p className="hg-meta">{dirty ? 'Unsaved changes. Your draft stays available during this visit.' : 'No unsaved changes.'}</p>{dirty && <Button variant="tertiary" onClick={() => setDiscard(true)}>Discard draft</Button>}
  </RecordForm>{discard && <Confirm title="Discard test edits?" onConfirm={() => { clearDraft(); setDiscard(false); leave(); }} onCancel={() => setDiscard(false)}>Only this unsaved draft will be discarded. Your saved test record stays as it is.</Confirm>}</div>;
}

function ArrangementEditor({ record, save, navigate }: WorkspaceProps & { record: TestRecord; save: Save }) {
  const [arranged, setArranged, clearDraft] = useHomeDraft(`tests:arranged:${record.id}`, record.arrangedByUser === true || record.status === 'arranged');
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (busy) return;
    setBusy(true);
    const status = record.status === 'draft' && arranged ? 'arranged' : record.status === 'arranged' && !arranged ? 'draft' : record.status;
    if (await save({ ...record, arrangedByUser: arranged, status })) { clearDraft(); navigate('detail', record.id); }
    setBusy(false);
  }
  return <div className="hg-stack"><PageIntro eyebrow={record.title} title="Test arrangement" description="Keep this step in sync with what you arranged outside HALO." icon={<CalendarDays />} /><RecordForm onSubmit={submit} onCancel={() => navigate('detail', record.id)} submitLabel="Save arrangement" busy={busy}><label className="hg-option"><input type="checkbox" checked={arranged} onChange={event => setArranged(event.target.checked)} /><span><strong>I arranged this test</strong><small>For example, you ordered a kit or contacted a provider.</small></span></label><p className="hg-meta">Clearing this step does not remove collection details, results or saved My Week actions.</p></RecordForm></div>;
}

function CollectionEditor({ record, save, navigate, view }: WorkspaceProps & { record: TestRecord; save: Save }) {
  const [draft, setDraft, clearDraft] = useHomeDraft<TestRecord>(`tests:collect:${record.id}`, record);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [discard, setDiscard] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(record);
  async function submit() {
    const found = testDraftErrors(draft);
    if (!draft.collectionStart) found.push('Enter the collection start date.');
    if (!draft.sampleLabel.trim()) found.push('Enter the sample location label.');
    if (draft.kind === 'radon' && !draft.collectionEnd) found.push('Enter the collection end date for this radon record.');
    setErrors(found); if (found.length || busy) return;
    setBusy(true);
    if (await save({ ...draft, awaitingRecorded: draft.awaitingRecorded || view === 'awaiting', status: record.rows.length ? record.status : view === 'awaiting' ? 'awaiting' : 'sampled' })) { clearDraft(); navigate('detail', record.id); }
    setBusy(false);
  }
  const set = <K extends keyof TestRecord>(key: K, value: TestRecord[K]) => setDraft({ ...draft, [key]: value });
  return <div className="hg-stack"><PageIntro eyebrow={record.title} title={view === 'awaiting' ? 'Awaiting a result' : 'Record sample collection'} description="Record what happened. A pending test is not a negative result." icon={<CalendarDays />} /><RecordForm onSubmit={submit} onCancel={() => navigate('detail', record.id)} submitLabel={view === 'awaiting' ? 'Mark awaiting result' : 'Save collection'} busy={busy}><Errors errors={errors} /><div className="hg-grid"><Field label="Collection start date (required)"><input required type="date" value={draft.collectionStart} onChange={event => set('collectionStart', event.target.value)} /></Field><Field label={`Collection end date (${record.kind === 'radon' ? 'required' : 'optional'})`}><input required={record.kind === 'radon'} type="date" value={draft.collectionEnd} onChange={event => set('collectionEnd', event.target.value)} /></Field></div><Field label="Sample location label (required)" hint="Use a simple room or site label; no exact address is needed."><input required maxLength={160} value={draft.sampleLabel} onChange={event => set('sampleLabel', event.target.value)} /></Field><Field label="Collection or test method (optional)" hint="Copy a known method from your instructions or report. An unknown method blocks comparison."><input maxLength={160} value={draft.method} onChange={event => set('method', event.target.value)} /></Field>{view === 'awaiting' && <Field label="Expected result date (optional)" hint="Leave blank if the provider did not give you a date."><input type="date" value={draft.expectedDate} onChange={event => set('expectedDate', event.target.value)} /></Field>}{dirty && <Button variant="tertiary" onClick={() => setDiscard(true)}>Discard draft</Button>}<p className="hg-meta">Dates are calendar dates as entered. This sample workflow does not invent collection times or contact a provider.</p></RecordForm>{discard && <Confirm title="Discard collection edits?" onConfirm={() => { clearDraft(); navigate('detail', record.id); }} onCancel={() => setDiscard(false)}>Your previously saved collection details will remain.</Confirm>}</div>;
}

function TestDetail({ record, save, remove, navigate, go }: WorkspaceProps & { record: TestRecord; save: Save; remove: (id: string) => Promise<boolean> }) {
  const contexts = useTestContexts();
  const plan = useExpandedPreview();
  const followup = useRef<HTMLElement>(null);
  const savedAction = plan?.actions.find(action => action.key === `home:${record.id}`);
  const [confirmation, setConfirmation] = useState<'archive' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  async function change(next: TestRecord) { if (busy) return; setBusy(true); await save(next); setBusy(false); }
  async function confirm() {
    if (busy) return;
    setBusy(true);
    const ok = confirmation === 'delete' ? await remove(record.id) : await save({ ...record, archived: !record.archived });
    if (ok) { setConfirmation(null); if (confirmation === 'delete') navigate('list'); }
    setBusy(false);
  }
  const arrangedRecorded = record.arrangedByUser === true || record.status === 'arranged';
  const awaitingRecorded = record.awaitingRecorded === true || record.status === 'awaiting';
  const steps: TestProgressStep[] = [
    { label: 'Prepared', done: true, detail: record.plannedDate ? `Proposed ${record.plannedDate}` : 'Test details saved', editLabel: 'Edit test details', onEdit: () => navigate('edit', record.id) },
    { label: 'Arranged', done: arrangedRecorded, detail: 'Arranged by you', editLabel: 'Edit test arrangement', onEdit: () => navigate('arranged', record.id) },
    { label: 'Collected', done: !!record.collectionStart, detail: record.collectionStart || 'Not recorded', editLabel: 'Edit collection details', onEdit: () => navigate('collect', record.id) },
    { label: 'Awaiting result', done: awaitingRecorded, detail: record.expectedDate ? `Expected ${record.expectedDate}` : 'Waiting for the report', editLabel: 'Edit expected result date', onEdit: () => navigate('awaiting', record.id) },
    { label: 'Result recorded', done: !!record.rows.length, detail: record.review === 'user_confirmed' ? 'Checked against your report' : record.review === 'needs_clarification' ? 'Some details need checking' : 'Ready for your review', editLabel: 'Edit recorded results', onEdit: () => navigate('results', record.id) },
    { label: 'Follow-up', done: !!savedAction || record.status === 'followup', detail: savedAction ? savedAction.state === 'completed' ? 'My Week action completed by you' : savedAction.date ? `Saved in My Week for ${savedAction.date}` : 'Saved in My Week for later' : 'Marked by you. No My Week action saved.', editLabel: savedAction ? 'Edit saved follow-up' : 'Review follow-up', onEdit: () => { if (savedAction) plan?.open(savedAction); else followup.current?.focus(); } },
  ];
  return <div className="hg-stack"><button type="button" className="hg-back" onClick={() => navigate('list')}><ArrowLeft size={16} />All tests</button><PageIntro eyebrow={`${kindLabels[record.kind]} · ${record.archived ? 'Archived record' : testStatusLabels[record.status]}`} title={record.title} description={record.purpose} icon={<FlaskConical />} /><div className="hg-card"><div className="hg-section-head"><h2>Sample context</h2><span className="hg-pill">Revision {record.revision}</span></div><dl className="hg-facts"><div><dt>Home or site</dt><dd>{(record.contextSnapshot?.label ?? contextLabel(record.contextId, contexts))}</dd></div>{record.contextSnapshot?.irrigation && <div><dt>Site source at recording</dt><dd>{record.contextSnapshot.irrigation} (site revision {record.contextSnapshot.revision})</dd></div>}<div><dt>Medium</dt><dd>{record.medium || 'Unknown'}</dd></div><div><dt>Provider or origin</dt><dd>{record.provider || 'User-entered'}</dd></div><div><dt>Sample location</dt><dd>{record.sampleLabel || 'Not supplied'}</dd></div><div><dt>Collection</dt><dd>{record.collectionStart || 'Not recorded'}{record.collectionEnd && record.collectionEnd !== record.collectionStart ? ` to ${record.collectionEnd}` : ''}</dd></div><div><dt>Method</dt><dd>{record.method || 'Unknown'}</dd></div></dl></div>
    <TestProgress steps={steps}><div className="hg-actions">{record.status === 'draft' && !record.arrangedByUser && <Button busy={busy} onClick={() => change({ ...record, status: 'arranged', arrangedByUser: true })}>I arranged this test</Button>}{!record.collectionStart && <Button variant="secondary" onClick={() => navigate('collect', record.id)}>Record collection</Button>}{record.collectionStart && !record.rows.length && !record.awaitingRecorded && record.status !== 'awaiting' && <Button variant="secondary" onClick={() => navigate('awaiting', record.id)}>Awaiting result</Button>}</div>{record.rows.length > 0 && (!arrangedRecorded || (record.collectionStart && !awaitingRecorded)) && <details className="hg-filter-details hg-test-earlier"><summary>Fill in an earlier step</summary><p className="hg-meta">Only add steps you actually completed. Leaving a step blank is fine.</p><div className="hg-fields">{!arrangedRecorded && <button type="button" className="hg-test-earlier-link" onClick={() => navigate('arranged', record.id)}>Record earlier test arrangement</button>}{record.collectionStart && !awaitingRecorded && <button type="button" className="hg-test-earlier-link" onClick={() => navigate('awaiting', record.id)}>Record an earlier waiting stage</button>}</div></details>}</TestProgress>
    <section className="hg-card hg-stack"><h2>Results from your report</h2>{record.rows.length ? <><div className="hg-test-result-summary"><span className="hg-pill">{reviewLabels[record.review]}</span></div><ResultsTable rows={record.rows} /><p className="hg-meta">Your transcription, not a safety assessment.</p><details className="hg-filter-details"><summary>What this record means</summary><p>{record.reviewReason || 'Copied by you, not independently verified.'} Results do not establish safety or change your HALO score.</p><p>Use the pencil beside Result recorded to correct an entry. Earlier versions remain in correction history.</p></details></> : <p>{record.status === 'awaiting' ? 'The result has not arrived. Waiting does not mean a substance was absent.' : 'No result yet. Add it when your report is ready.'}</p>}<div className="hg-actions">{!record.rows.length && <Button onClick={() => navigate('results', record.id)}>Enter results</Button>}<Button variant="secondary" onClick={() => navigate('attachments', record.id)}>Review a local report</Button></div></section>
    <section ref={followup} tabIndex={-1} className="hg-card hg-stack"><h2>Follow up in My Week</h2><p>{savedAction ? 'Your follow-up is saved. Open it to change the title or date.' : 'Keep a question for your provider, or a next step you want to remember.'}</p><ActionButton title={`Follow up on ${record.title}`} reason={`Review the user-entered ${kindLabels[record.kind].toLowerCase()} record, its original report, and any questions for the provider. Synthetic test record ${record.id}.`} factor={factorFor(record)} originId={record.id} /><p className="hg-meta">{savedAction ? 'This is the same action you see in My Week, not a second copy.' : 'Choose a date, or save for later. Saving does not mark the work as done.'}</p></section>
    <div className="hg-grid"><WorkspaceLink title="Compare records" detail="Check compatibility before comparing originals." icon={<ClipboardList />} onClick={() => navigate('compare', record.id)} /><WorkspaceLink title="Correction history" detail={`${record.history.length} retained ${record.history.length === 1 ? 'version' : 'versions'}`} icon={<History />} onClick={() => navigate('history', record.id)} /><WorkspaceLink title="Export this record" detail="Preview and choose whether to include context." icon={<Download />} onClick={() => navigate('export', record.id)} /><WorkspaceLink title="Household summary" detail="Choose which evidence to include." icon={<FileText />} onClick={() => go('summary')} /></div><div className="hg-record-toolbar" role="group" aria-label="Test record tools"><Button variant="tertiary" disabled={busy} onClick={() => setConfirmation('archive')}>{record.archived ? 'Restore from archive' : 'Archive record'}</Button><DeleteButton label="Delete record" disabled={busy} onClick={() => setConfirmation('delete')} /></div>
    {confirmation && <Confirm title={confirmation === 'delete' ? 'Delete this test record?' : record.archived ? 'Restore this record?' : 'Archive this record?'} danger={confirmation === 'delete'} onConfirm={confirm} onCancel={() => { if (!busy) setConfirmation(null); }}><p>{confirmation === 'delete' ? 'This removes this sample test, its result rows, and its correction history from the review session. Related My Week actions remain available and are not marked complete. There are no uploaded files to delete.' : record.archived ? 'The test will return to your active list with its original context and history.' : 'The test will move to Archived records. Results, original context, and history are retained. Related My Week actions stay as they are.'}</p>{busy && <p role="status">Applying your choice to the sample record...</p>}</Confirm>}
  </div>;
}

type ResultDraft = { rows: TestResultRow[]; reason: string; confirmed: boolean; baseRevision: number };
function ResultEditor({ record, save, navigate }: WorkspaceProps & { record: TestRecord; save: Save }) {
  const initial: ResultDraft = { rows: record.rows.length ? record.rows : [emptyResult()], reason: '', confirmed: false, baseRevision: record.revision };
  const [draft, setDraft, clearDraft] = useHomeDraft<ResultDraft>(`tests:results:${record.id}`, initial);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [discard, setDiscard] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const issues = resultIssues(record, draft.rows);
  const duplicates = duplicateAnalytes(draft.rows);
  function rowChange(id: string, key: keyof TestResultRow, value: string) { setDraft({ ...draft, confirmed: false, rows: draft.rows.map(row => row.id === id ? { ...row, [key]: value } : row) }); }
  async function submit() {
    const found: string[] = [];
    if (!draft.rows.length) found.push('Add at least one result row.');
    if (record.rows.length && !draft.reason.trim()) found.push('Give a reason for this correction.');
    setErrors(found); if (found.length || busy) return;
    setBusy(true);
    const next = record.rows.length ? correctResults(record, draft.rows, draft.reason, draft.confirmed, new Date().toISOString().slice(0, 10)) : { ...record, rows: draft.rows, review: draft.confirmed && !issues.length ? 'user_confirmed' as const : issues.length ? 'needs_clarification' as const : 'unreviewed' as const, reviewReason: issues.join(' ') };
    if (await save({ ...next, revision: draft.baseRevision, status: record.status === 'followup' ? 'followup' : 'recorded' })) { clearDraft(); navigate('detail', record.id); }
    setBusy(false);
  }
  return <div className="hg-stack"><PageIntro eyebrow={record.title} title={record.rows.length ? 'Correct your results' : 'Enter reported results'} description="Copy each result exactly as it appears on your report. Leave unknown details blank." icon={<ClipboardList />} /><SourceNote>“Not detected,” “less than,” zero and a missing result mean different things. Keep the wording on your report. HALO does not interpret these results.</SourceNote><RecordForm onSubmit={submit} onCancel={() => navigate('detail', record.id)} submitLabel={issues.length ? 'Save uninterpreted record' : draft.confirmed ? 'Save confirmed transcription' : 'Save unconfirmed transcription'} busy={busy}><Errors errors={errors} />
    {draft.rows.map((row, index) => <fieldset key={row.id} className="hg-card hg-stack"><legend>Result {index + 1}</legend>
      <Field label="Analyte or parameter" hint="The substance or measurement named on the report."><input maxLength={120} value={row.analyte} onChange={event => rowChange(row.id, 'analyte', event.target.value)} placeholder="For example, PFOS" /></Field>
      <div className="hg-grid"><Field label="Original reported value or text"><input maxLength={120} value={row.originalValue} onChange={event => rowChange(row.id, 'originalValue', event.target.value)} placeholder="For example, < 0.5 or ND" /></Field><Field label="Original reported unit"><input maxLength={40} value={row.originalUnit} onChange={event => rowChange(row.id, 'originalUnit', event.target.value)} placeholder="Copy the unit from the report" /></Field></div>
      <Field label="Reporting qualifier" hint="Choose how the lab described the result."><select aria-label="Reporting qualifier" value={row.qualifier} onChange={event => rowChange(row.id, 'qualifier', event.target.value)}>{Object.entries(resultQualifiers).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
      <Field label="Result or report date"><input type="date" value={row.reportDate} onChange={event => rowChange(row.id, 'reportDate', event.target.value)} /></Field>
      <details className="hg-filter-details" open={row.qualifier === 'non_detect' || row.qualifier === 'less_than' || Boolean(row.limit || row.basis || row.reportReference) ? true : undefined}><summary>More details from the report</summary><div className="hg-fields">
        <div className="hg-grid"><Field label="Detection or reporting limit (optional)" hint="The smallest amount the lab reports, if supplied."><input maxLength={80} value={row.limit} onChange={event => rowChange(row.id, 'limit', event.target.value)} inputMode="decimal" /></Field><Field label="Limit unit (if a limit is given)"><input maxLength={40} value={row.limitUnit} onChange={event => rowChange(row.id, 'limitUnit', event.target.value)} /></Field></div>
        <Field label="Sample basis (if reported)" hint="For example, dry weight or wet weight. Leave unknown terms as written."><input maxLength={80} value={row.basis} onChange={event => rowChange(row.id, 'basis', event.target.value)} /></Field>
        <Field label="Report reference (optional)"><input maxLength={160} value={row.reportReference} onChange={event => rowChange(row.id, 'reportReference', event.target.value)} /></Field>
      </div></details>
      <Button variant="tertiary" onClick={() => setDraft({ ...draft, confirmed: false, rows: draft.rows.filter(item => item.id !== row.id) })}>Remove row {index + 1}</Button>
    </fieldset>)}
    <Button variant="secondary" onClick={() => setDraft({ ...draft, confirmed: false, rows: [...draft.rows, emptyResult(`row-${crypto.randomUUID()}`)] })}><Plus size={16} />Add result row</Button>
    {duplicates.length > 0 && <SourceNote>Repeated analyte names: {duplicates.join(', ')}. Rows will remain separate. If these are separate samples, record each sample independently before comparing.</SourceNote>}
    {issues.length > 0 && <div className="hg-card"><h3>Some details need checking</h3><p>You can save now and return later. The result will remain uninterpreted.</p><details className="hg-filter-details"><summary>{issues.length} {issues.length === 1 ? 'detail' : 'details'} to check</summary><ul>{issues.map(issue => <li key={issue}>{issue}</li>)}</ul></details></div>}
    {record.rows.length > 0 && <Field label="Correction reason (required)" hint="The previous version is preserved in correction history."><textarea required maxLength={600} value={draft.reason} onChange={event => setDraft({ ...draft, reason: event.target.value })} /></Field>}
    <label className="hg-option"><input type="checkbox" checked={draft.confirmed} onChange={event => setDraft({ ...draft, confirmed: event.target.checked })} /><span>I compared these fields with my original report and confirm the transcription.</span></label>{dirty && <Button variant="tertiary" onClick={() => setDiscard(true)}>Discard draft</Button>}<p className="hg-meta">This confirms your entry, not that the result is safe. {issues.length ? 'Missing details will stay flagged.' : ''}</p><details><summary>Review a local report</summary><LocalAttachmentReview /></details>
  </RecordForm>{discard && <Confirm title="Discard unsaved result edits?" onConfirm={() => { clearDraft(); navigate('detail', record.id); }} onCancel={() => setDiscard(false)}>Your saved original values and correction history will remain.</Confirm>}</div>;
}

function LocalAttachmentReview() {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [reviewed, setReviewed] = useState(false);
  useEffect(() => {
    if (!file || !file.type.startsWith('image/')) return;
    const objectUrl = URL.createObjectURL(file);
    queueMicrotask(() => setUrl(objectUrl));
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  function select(next: File | undefined) {
    setError(''); setReviewed(false); setUrl(''); setFile(null);
    if (!next) return;
    if (!['image/png', 'image/jpeg', 'application/pdf'].includes(next.type)) { setError('Choose a PNG, JPEG, or PDF. Other formats are not available in this preview.'); return; }
    if (next.size > 10 * 1024 * 1024) { setError('Choose a sample file smaller than 10 MB.'); return; }
    setFile(next);
  }
  return <section className="hg-card hg-stack" aria-label="Local attachment review"><h3>Local original</h3><p>Choose a sample PNG, JPEG, or PDF, up to 10 MB. The file stays in this browser view and is released when you leave. Avoid personal reports in this design review.</p><Field label="Choose a sample report"><input ref={input} type="file" accept="image/png,image/jpeg,application/pdf" onChange={event => select(event.target.files?.[0])} /></Field>{error && <p className="hg-error" role="alert">{error}</p>}{file && <><p><strong>{file.name}</strong><br /><span className="hg-meta">{Math.ceil(file.size / 1024)} KB · Local selection only</span></p>{file.type.startsWith('image/') && url ? <figure>
{/* eslint-disable-next-line @next/next/no-img-element -- Blob image stays in the local browser. */}
<img className="hg-attachment-image" src={url} alt="Locally selected sample report, not uploaded or scanned" /></figure> : <p>PDF rendering is unavailable in this preview. Inspect your original in your own PDF viewer; HALO has not opened or processed its contents.</p>}<label className="hg-check"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} />I reviewed this local original.</label>{reviewed && <p role="status">Local review noted for this view. Confirm the result transcription separately when you save the rows.</p>}<Button variant="tertiary" onClick={() => { setFile(null); setUrl(''); setReviewed(false); if (input.current) input.current.value = ''; }}>Remove local selection</Button></>}<SourceNote>Upload, scanning, metadata removal, OCR, extraction, and permanent attachment storage are unavailable. A file selection is not an upload receipt. No file is sent to a lab or Luna.</SourceNote></section>;
}

function TestHistory(props: WorkspaceProps & { record: TestRecord }) {
  return <div className="hg-stack"><BackToTest {...props} /><PageIntro eyebrow={props.record.title} title="Correction history" description="Previous transcriptions stay inspectable with the reason for each correction." icon={<History />} /><section className="hg-card"><h2>Current version, revision {props.record.revision}</h2><p>{reviewLabels[props.record.review]}</p>{props.record.rows.length ? <ResultsTable rows={props.record.rows} /> : <p>No result rows yet.</p>}</section>{props.record.history.length ? [...props.record.history].reverse().map((version, index) => <section className="hg-card" key={`${version.revision}-${index}`}><span className="hg-pill">Superseded transcription</span><h2>Revision {version.revision}</h2><p>Corrected {version.date}. Reason: {version.reason}</p><p className="hg-meta">Previous review: {reviewLabels[version.review]}</p><ResultsTable rows={version.rows} /></section>) : <Empty title="No corrections yet">Saving a correction preserves the current result rows here with your reason.</Empty>}</div>;
}

function CompareTests({ record, records, navigate, ...props }: WorkspaceProps & { record: TestRecord; records: TestRecord[] }) {
  const contexts = useTestContexts();
  const comparisonLabel = useId();
  const [selected, setSelected] = useState('');
  const second = records.find(item => item.id === selected);
  const issues = second ? comparisonIssues(record, second) : [];
  return <div className="hg-stack"><BackToTest {...props} navigate={navigate} record={record} /><PageIntro eyebrow={record.title} title="Compare original results" description="Compare like samples only. A difference is not a safety assessment or evidence that a HALO action caused a change." icon={<ClipboardList />} /><div className="hg-card"><Field label="Compare with another record"><select value={selected} onChange={event => setSelected(event.target.value)}><option value="">Choose a record</option>{records.filter(item => item.id !== record.id).map(item => <option key={item.id} value={item.id}>{item.title}{item.archived ? ' (archived)' : ''}</option>)}</select></Field></div>{second && (issues.length ? <section className="hg-card"><h2>These records are not compatible</h2><ul>{issues.map(issue => <li key={issue}>{issue}</li>)}</ul><Button variant="secondary" onClick={() => navigate('detail', second.id)}>Inspect selected record</Button></section> : <section className="hg-card"><h2>Compatible reported values</h2><p className="hg-meta">{(record.contextSnapshot?.label ?? contextLabel(record.contextId, contexts))} · {record.medium} · {record.method} · {record.sampleLabel}</p><div className="hg-table-wrap" role="region" tabIndex={0} aria-labelledby={comparisonLabel}><table className="hg-table"><caption id={comparisonLabel}>Original values, same unit and sample basis<span className="hg-table-hint">Scroll sideways to compare all columns.</span></caption><thead><tr><th scope="col">Analyte</th><th scope="col">{record.title}<br />{record.collectionStart}</th><th scope="col">{second.title}<br />{second.collectionStart}</th></tr></thead><tbody>{record.rows.map(row => { const other = second.rows.find(candidate => candidate.analyte.trim().toLowerCase() === row.analyte.trim().toLowerCase())!; return <tr key={row.id}><th scope="row">{row.analyte}</th><td>{row.originalValue} {row.originalUnit}</td><td>{other.originalValue} {other.originalUnit}</td></tr>; })}</tbody></table></div><SourceNote>Compatibility here checks entered fields only. Interpretation, conversion, trends, and test recommendations require reviewed methods and backend validation before production.</SourceNote></section>)}{!second && <SourceNote>Context, medium, test kind, sample location, method, analyte, unit, basis, and transcription status must align. Censored results such as ND cannot be substituted with zero.</SourceNote>}</div>;
}

function TestExport(props: WorkspaceProps & { record: TestRecord }) {
  const [includeContext, setIncludeContext] = useState(false);
  const [state, setState] = useState('');
  const payload = testExport(props.record, includeContext);
  function download() {
    try {
      setState('Preparing local sample export...');
      const url = URL.createObjectURL(new Blob([JSON.stringify({ ...payload, generatedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'halo-sample-test-record.json'; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      setState('Your browser was asked to download the sample JSON file. Check your downloads; HALO cannot confirm the file was saved.');
    } catch { setState('The download could not be prepared. Your preview is still here. Try again in a browser that supports local downloads.'); }
  }
  return <div className="hg-stack"><BackToTest {...props} /><PageIntro eyebrow="Private export preview" title="Export this test" description="Review the included content before creating a file on this device." icon={<Download />} /><div className="hg-card hg-stack"><h2>{props.record.title}</h2><p>Includes test type, purpose, dates, provider, method, original result rows, qualifiers, units, review status, and correction history. File contents are unavailable and omitted.</p><label className="hg-check"><input type="checkbox" checked={includeContext} onChange={event => setIncludeContext(event.target.checked)} />Include home or site context and sample location</label><p className="hg-meta">{includeContext ? 'Context and sample location will be included.' : 'Home or site context and sample location are excluded.'} The generated filename contains no household identifier.</p><details open><summary>Exact export preview</summary><pre className="hg-export-preview">{JSON.stringify(payload, null, 2)}</pre></details><Button onClick={download}><Download size={16} />Download sample JSON</Button>{state && <p role="status">{state}</p>}<SourceNote>This is a local synthetic export. No public link is created and nothing is shared. Original dates remain separate from the export generation time.</SourceNote></div></div>;
}
