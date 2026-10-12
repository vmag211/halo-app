'use client';
import DateInput from '@/components/ui/DateInput';

import { useMemo, useState } from 'react';
import { Download, FileText, Image as ImageIcon, Printer, Share2, ShieldCheck } from 'lucide-react';
import { useExpandedPreview } from '@/components/expanded/ExpandedPreviewState';
import { usePreviewHousehold } from '@/components/foundation/PreviewHousehold';
import { factorKeys, factorReadings } from '@/lib/frontend/factor-preview';
import { homeMemberKeys, memberCatalog } from '@/lib/frontend/home-household';
import { resultQualifiers } from '@/lib/frontend/home-test-preview';
import { defaultSummarySelection, summaryDateError, summaryHtml, withinSummaryDates, type SummarySection, type SummarySelection } from '@/lib/frontend/home-maintenance-preview';
import { useHomeDraft, useHomeWorkspace } from './HomeWorkspaceState';
import { Field, PageIntro, SourceNote, WorkspaceLink, type WorkspaceProps } from './HomeWorkspaceUI';
import SummaryReport from './SummaryReport';

type SummaryRecord = { id: string; title: string; revision?: number; [key: string]: unknown };
const sectionLabels: Record<SummarySection, string> = { scores: 'Today & Homeguard scores', factors: 'Factors & sources', tests: 'Test reports', actions: 'Saved actions', maintenance: 'Maintenance records', observations: 'Moisture observations', gardens: 'Garden records' };
const sectionDescriptions: Record<SummarySection, string> = { scores: 'Both scores and what they include.', factors: 'All seven factors with original source dates.', tests: 'Choose which test results to include.', actions: 'Selected steps from My Week.', maintenance: 'Equipment, schedules and completed work.', observations: 'Notes and measurements you recorded.', gardens: 'Selected growing sites and their context.' };
const recordSections: SummarySection[] = ['tests', 'actions', 'maintenance', 'observations', 'gardens'];
const dateFields = ['observedAt', 'collectedAt', 'collectionStart', 'collected', 'collectionDate', 'date', 'proposedDate', 'plannedDate', 'lastCompleted', 'installed', 'createdAt'];
const scalar = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
function recordDate(record: SummaryRecord): string { for (const key of dateFields) if (scalar(record[key])) return scalar(record[key]); return ''; }
function recordDescription(record: SummaryRecord): string {
  const parts = [scalar(record.status) || scalar(record.state), recordDate(record) || 'Date not supplied'];
  if (record.reading !== undefined && record.reading !== '') parts.push(`${scalar(record.reading)} ${scalar(record.unit)} (user entered)`);
  if (record.nextDue) parts.push(`Next due ${scalar(record.snoozedUntil) || scalar(record.nextDue)}`);
  if (record.lastCompleted) parts.push(`Last completed ${scalar(record.lastCompleted)}`);
  if (record.irrigation) parts.push(`Irrigation source: ${scalar(record.irrigation)}`);
  return parts.filter(Boolean).join(' · ');
}
function resultLines(record: SummaryRecord): string[] {
  if (!Array.isArray(record.rows)) return [];
  return record.rows.filter(row => row && typeof row === 'object').map(row => {
    const result = row as Record<string, unknown>;
    const qualifier = scalar(result.qualifier);
    return [scalar(result.analyte) || 'Unlabelled analyte', resultQualifiers[qualifier as keyof typeof resultQualifiers] || qualifier, scalar(result.originalValue) || 'Original value not supplied', scalar(result.originalUnit) || 'Reported unit missing', result.limit ? `Reporting limit: ${scalar(result.limit)} ${scalar(result.limitUnit) || '(limit unit missing)'}` : '', result.basis ? `Basis: ${scalar(result.basis)}` : ['soil', 'tissue'].includes(scalar(record.medium)) ? 'Sample basis missing' : '', scalar(result.reportDate) || 'Report date not supplied', 'User-entered transcription, no scored interpretation'].filter(Boolean).join(' · ');
  });
}

export default function SummaryWorkspace(props: WorkspaceProps) {
  const { collections, scenario, setDraft } = useHomeWorkspace();
  const expanded = useExpandedPreview(); const { bands } = usePreviewHousehold();
  const [selection, setSelection] = useHomeDraft<SummarySelection>('summary-selection', defaultSummarySelection);
  const [waterContext, setWaterContext] = useHomeDraft<'utility' | 'well' | 'spring'>('summary-water-context', 'utility');
  const [unavailable] = useHomeDraft<SummarySection | ''>('summary-section-failure', '');
  const [error, setError] = useState(''); const [status, setStatus] = useState(''); const [busy, setBusy] = useState(false);
  const [generated, setGenerated] = useHomeDraft<string>('summary-generated-time', '');
  const [openedAt] = useState(() => new Date().toISOString());
  const sources = useMemo<Record<string, SummaryRecord[]>>(() => ({ tests: (collections.tests ?? []) as SummaryRecord[], actions: (expanded?.actions ?? []) as unknown as SummaryRecord[], maintenance: (collections.assets ?? []) as SummaryRecord[], observations: (collections.observations ?? []) as SummaryRecord[], gardens: (collections.gardens ?? []) as SummaryRecord[] }), [collections, expanded?.actions]);
  const selectedCategories = homeMemberKeys.filter(key => bands[memberCatalog[key].band]).map(key => memberCatalog[key].label);
  const privateWater = waterContext !== 'utility';
  const missingSections = scenario === 'error' ? ['tests' as const] : unavailable ? [unavailable] : [];
  const selectedRecords = (section: SummarySection) => (sources[section] ?? []).filter(record => !selection.excluded.includes(`${section}:${record.id}`) && withinSummaryDates(recordDate(record), selection));
  const sections: { title: string; lines: string[] }[] = [];
  if (selection.sections.scores) sections.push({ title: 'Two score snapshot', lines: [`Today: 74 / 100 · Moderate · September 30, 2026.`, privateWater ? 'Homeguard: unavailable for this private-water context. No household water test is available.' : 'Homeguard: 58 / 100 · Elevated · September 30, 2026.', 'Higher scores are better. Today uses air, UV, pollen and the outdoor mold estimate. Homeguard uses available PFAS and radon inputs. Lead is shown separately, not scored. Completing an action does not change either score.'] });
  if (selection.sections.factors) sections.push({ title: 'Seven factors, with their original dates', lines: factorKeys.map(key => {
    const factor = factorReadings[key];
    if (key === 'pfas' && privateWater) return 'PFAS in water: missing household measurement. Private well or spring; the utility result does not apply. Review the selected private tests below, or arrange a test.';
    const kind = factor.provenance || (key === 'uv' || key === 'pollen' ? 'forecast' : 'source supplied');
    return `${factor.title}: ${factor.reading} ${factor.unit} · ${factor.severity.replace('_', ' ')} · ${kind}. Source: ${factor.source}. Original observation or classification date: ${factor.asOf}.${key === 'pfas' ? ' Older utility sample, not a current tap measurement.' : key === 'radon' ? ' County estimate, not a home measurement.' : key === 'mold' ? ' Outdoor weather estimate, not detected mold.' : key === 'lead' ? ' Building-era estimate, not measured lead; not scored.' : ''}`;
  }) });
  for (const section of recordSections) {
    if (!selection.sections[section]) continue;
    if (missingSections.includes(section)) { sections.push({ title: sectionLabels[section], lines: ['Omitted: this optional section is unavailable. The remaining selected evidence is retained. Retry this section before exporting if it is needed.'] }); continue; }
    const records = selectedRecords(section);
    const lines = records.flatMap(record => {
      const testContext = section === 'tests' ? [`Sample medium: ${scalar(record.medium) || 'Unknown'}. Method: ${scalar(record.method) || 'Not supplied'}. Collection: ${scalar(record.collectionStart) || 'Not supplied'}${record.collectionEnd ? ` through ${scalar(record.collectionEnd)}` : ''}.`, `Transcription review: ${({ not_received: 'No results received', unreviewed: 'Not checked against the original report', needs_clarification: 'Needs clarification', user_confirmed: 'Checked by you, not verified by a laboratory' } as Record<string, string>)[scalar(record.review)] || 'Not supplied'}.${record.reviewReason ? ` ${scalar(record.reviewReason)}` : ''}`] : [];
      const details = [`${record.title}: ${recordDescription(record)} · User-reported record${record.revision ? `, revision ${record.revision}` : ''}.`, ...testContext, ...resultLines(record)];
      if (selection.location) { const place = scalar(record.room) || scalar(record.sampleLabel) || scalar(record.siteLabel) || scalar(record.county); if (place) details.push(`Included place label: ${place}.`); if (section === 'tests' && record.contextId) details.push(`Sample context: ${scalar(record.contextId)}.`); }
      if (selection.notes) { const note = scalar(record.note) || scalar(record.privateNote); if (note) details.push(`Included private note: ${note}`); }
      if (selection.attachments) { const name = scalar(record.photoName); if (name) details.push(`Selected attachment reference: ${name}. Image contents and metadata are omitted from this summary export.`); if (Array.isArray(record.attachments) && record.attachments.length) details.push(`${record.attachments.length} attachment reference(s). Original files are omitted; this summary is not a full private-data export.`); }
      if (selection.appendix && section === 'maintenance' && Array.isArray(record.history)) for (const entry of record.history) { if (entry && typeof entry === 'object') { const event = entry as Record<string, unknown>; details.push(`History: ${scalar(event.kind)} · ${scalar(event.date)}${event.due ? ` · Due ${scalar(event.due)}` : ''}${selection.notes && event.note ? ` · ${scalar(event.note)}` : ''}.`); } }
      return details;
    });
    sections.push({ title: sectionLabels[section], lines: lines.length ? lines : ['No selected records in this date range. Undated records are labelled separately. No result is inferred from an empty section.'] });
  }
  if (selection.categories) sections.push({ title: 'Household categories you chose to include', lines: [selectedCategories.length ? selectedCategories.join(', ') : 'No household categories selected.'] });
  if (selection.location) sections.push({ title: 'Included location context', lines: ['Iredell County, North Carolina. No street address or device location included.'] });
  const omissions = [!selection.categories && 'Household categories', !selection.location && 'Location labels', !selection.notes && 'Private notes', !selection.attachments && 'Attachment references', 'Original attachment contents and metadata', ...recordSections.filter(key => !selection.sections[key]).map(key => sectionLabels[key])].filter(Boolean).join('; ');
  const lines = [
    `Purpose: ${selection.purpose}.`,
    `Generated: ${generated || openedAt}. Selected private-record dates: ${selection.start} through ${selection.end}. Existing environmental observations retain their original dates even when older than this range.`,
    `Water context: ${waterContext === 'utility' ? 'Public utility' : waterContext === 'well' ? 'Private well, no inferred utility match' : 'Private spring, no inferred utility match'}.`,
    ...(scenario === 'stale' ? ['Older saved information. Check original source dates.'] : []),
    ...sections.flatMap(section => [section.title, ...section.lines]),
    `Omitted by selection or export scope: ${omissions}.`,
    ...(selection.excluded.length ? [`${selection.excluded.length} record selection(s) are excluded.`] : []),
    ...(selection.appendix ? ['Evidence appendix', ...factorKeys.filter(() => selection.sections.factors).map(key => `${factorReadings[key].title}: ${key === 'pfas' && privateWater ? 'No applicable household water measurement.' : factorReadings[key].detail}`), 'Recorded work does not prove improved water, air or health.'] : []),
  ];
  const update = (patch: Partial<SummarySelection>) => { setSelection({ ...selection, ...patch }); setStatus(''); setError(''); };
  function preview() { const invalid = summaryDateError(selection); setError(invalid ?? ''); if (invalid) return; setGenerated(new Date().toISOString()); setStatus(''); props.navigate('preview'); }
  function download(blob: Blob, extension: string) { const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `halo-household-summary.${extension}`; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
  async function exportSummary(kind: 'file' | 'image' | 'print' | 'share') {
    if (busy) return; setError(''); setStatus('Preparing your selected summary...'); setBusy(true);
    try {
      const html = summaryHtml(lines);
      if (kind === 'file') { download(new Blob([html], { type: 'text/html;charset=utf-8' }), 'html'); setStatus('Download started.'); }
      else if (kind === 'image') {
        const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Image export is unsupported here. Download the file or print instead.');
        ctx.font = '20px Arial';
        const wrapped: string[] = ['HALO HOUSEHOLD SUMMARY', ''];
        for (const line of lines) {
          let row = '';
          for (const word of line.split(/\s+/)) {
            const candidate = `${row}${row ? ' ' : ''}${word}`;
            if (ctx.measureText(candidate).width <= 1024) { row = candidate; continue; }
            if (row) wrapped.push(row);
            row = '';
            for (const character of Array.from(word)) {
              if (ctx.measureText(row + character).width > 1024 && row) { wrapped.push(row); row = ''; }
              row += character;
            }
          }
          wrapped.push(row, '');
        }
        if (wrapped.length > 480) throw new Error('This summary is too long for one readable image. Download the file or reduce sections.');
        canvas.width = 1120; canvas.height = Math.max(320, 100 + wrapped.length * 30); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#111'; ctx.font = '20px Arial'; wrapped.forEach((line, i) => ctx.fillText(line, 48, 58 + i * 30));
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('The image could not be created. Try downloading the file.')), 'image/png'));
        download(blob, 'png'); setStatus('Image download started.');
      } else if (kind === 'print') {
        const frame = document.createElement('iframe'); frame.title = 'Selected household summary print document'; frame.setAttribute('aria-hidden', 'true'); frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-9999px;border:0';
        document.body.appendChild(frame);
        try { await new Promise<void>((resolve, reject) => { frame.onload = () => resolve(); frame.onerror = () => reject(new Error('The print document could not be prepared.')); frame.srcdoc = html; }); const target = frame.contentWindow; if (!target) throw new Error('Printing is unsupported. Download the file instead.'); target.focus(); target.print(); setStatus('Print dialog opened. Your selections are kept.'); } finally { window.setTimeout(() => frame.remove(), 1000); }
      } else {
        if (!navigator.share) { setStatus('Native sharing is unsupported in this browser. Download the file or image instead.'); return; }
        const file = new File([html], 'halo-household-summary.html', { type: 'text/html' });
        if (navigator.canShare?.({ files: [file] })) await navigator.share({ title: 'HALO household summary', files: [file] });
        else await navigator.share({ title: 'HALO household summary', text: lines.join('\n\n') });
        setStatus('Share sheet opened. Confirm in your chosen app.');
      }
    } catch (failure) {
      if (failure instanceof DOMException && failure.name === 'AbortError') setStatus('Sharing cancelled. Your selections are kept.');
      else if (failure instanceof DOMException && failure.name === 'NotAllowedError') { setStatus(''); setError('Sharing permission denied. Download a file or image instead.'); }
      else { setStatus(''); setError(failure instanceof Error ? failure.message : 'Export failed. Your selections are kept. Try again.'); }
    } finally { setBusy(false); }
  }
  if (props.view === 'preview') return <>
    <PageIntro eyebrow="Ready for your review" title="Your household summary" description="A useful copy of your selected information, ready to keep or share." icon={<FileText />} />
    <SummaryReport onReady={pages => setDraft('summary-last-created', () => ({ at: new Date().toISOString(), pages }))} report={{ title: selection.purpose, generated: generated || openedAt, introduction: lines.slice(0, scenario === 'stale' ? 4 : 3), sections: [...sections, { title: 'Omissions and scope', lines: lines.slice((scenario === 'stale' ? 4 : 3) + sections.reduce((count, section) => count + 1 + section.lines.length, 0)) }] }} />
    <button className="hg-button-secondary" onClick={() => { setStatus(''); props.navigate('selection'); }}>Edit included information</button>
    <details className="hg-record-tools hg-card"><summary>Other formats & printing</summary><div className="hg-actions"><button disabled={busy} onClick={() => exportSummary('file')}><Download size={18} />Download accessible text</button><button disabled={busy} onClick={() => exportSummary('image')}><ImageIcon size={18} />Save image</button><button disabled={busy} onClick={() => exportSummary('print')}><Printer size={18} />Print</button><button disabled={busy} onClick={() => exportSummary('share')}><Share2 size={18} />Share text</button></div></details>
    {status && <p role="status" className="hg-notice">{status}</p>}{error && <div role="alert" className="hg-notice"><p>{error}</p><p>Use any export button to retry. No public link was created.</p></div>}
    <details className="hg-summary-readable"><summary>Review the included information</summary><article className="hg-summary-preview" aria-label="Selected household summary"><header><p className="hg-eyebrow">HALO · Household summary</p><h2>{selection.purpose}</h2><p>Generated {generated || openedAt}</p><p>Water context: {waterContext === 'utility' ? 'Public utility' : waterContext === 'well' ? 'Private well, no inferred utility match' : 'Private spring, no inferred utility match'}.</p><p>Private records: {selection.start} to {selection.end}. Environmental evidence retains its original dates.</p></header>{scenario === 'stale' && <p>Older saved information. Check each original source date.</p>}{sections.map(section => <section key={section.title}><h3>{section.title}</h3>{section.lines.map((line, index) => <p key={index}>{line}</p>)}</section>)}<footer><h3>Omissions and scope</h3><p>{omissions}.</p>{selection.excluded.length > 0 && <p>{selection.excluded.length} record selection(s) excluded.</p>}<p>Attachment names only. Original files and photo metadata are not included.</p></footer>{selection.appendix && <section><h3>Evidence appendix</h3>{factorKeys.filter(() => selection.sections.factors).map(key => <p key={key}><strong>{factorReadings[key].title}: </strong>{key === 'pfas' && privateWater ? 'No applicable household water measurement.' : factorReadings[key].detail}</p>)}<p>Recorded work does not prove improved water, air or health.</p></section>}</article></details>
    <SourceNote>Only selected information is shared. No public link is created.</SourceNote>
  </>;
  return <>
    <PageIntro eyebrow="Homeguard" title="Household summary" description="Choose what to include. Luna will arrange it into a PDF you can keep or share." icon={<FileText />} />
    <section className="hg-card hg-stack"><h2>Set up your summary</h2>
      <Field label="What is this summary for?"><select value={selection.purpose} onChange={e => update({ purpose: e.target.value })}><option>Household review</option><option>Water provider questions</option><option>Landlord or contractor discussion</option><option>Care professional questions</option></select></Field>
      <Field label="Water context for this summary"><select value={waterContext} onChange={e => setWaterContext(e.target.value as typeof waterContext)}><option value="utility">Public utility</option><option value="well">Private well</option><option value="spring">Private spring</option></select></Field>
      {privateWater && <SourceNote>Utility readings do not apply to your well or spring. This summary will show the missing measurement, not a complete Homeguard score.</SourceNote>}
    </section>
    <section className="hg-card hg-stack"><h2>What to include</h2>
      <div role="group" aria-label="Environmental information">{(['scores', 'factors'] as const).map(key => <label key={key} className="hg-option"><input type="checkbox" aria-label={sectionLabels[key]} checked={selection.sections[key]} onChange={e => update({ sections: { ...selection.sections, [key]: e.target.checked } })} /><span><strong>{sectionLabels[key]}</strong><small>{sectionDescriptions[key]}</small></span></label>)}</div>
      <details className="hg-filter-details" open={recordSections.some(key => selection.sections[key]) ? true : undefined}><summary>Add private records{recordSections.some(key => selection.sections[key]) ? ` · ${recordSections.filter(key => selection.sections[key]).length} selected` : ' · Optional'}</summary>
        <p className="hg-meta">Nothing private is included until you choose it.</p>
        {recordSections.map(key => <div key={key}>
          <label className="hg-option"><input type="checkbox" aria-label={sectionLabels[key]} checked={selection.sections[key]} onChange={e => update({ sections: { ...selection.sections, [key]: e.target.checked } })} /><span><strong>{sectionLabels[key]}</strong><small>{sectionDescriptions[key]}</small></span></label>
          {selection.sections[key] && <fieldset className="hg-fieldset"><legend>Choose {sectionLabels[key].toLowerCase()}</legend>{sources[key]?.length ? sources[key].map(record => <label key={record.id} className="hg-option"><input type="checkbox" checked={!selection.excluded.includes(`${key}:${record.id}`)} onChange={e => update({ excluded: e.target.checked ? selection.excluded.filter(id => id !== `${key}:${record.id}`) : [...selection.excluded, `${key}:${record.id}`] })} /><span><strong>{record.title}</strong><small>{recordDescription(record)}{withinSummaryDates(recordDate(record), selection) ? '' : ' · Outside this date range; omitted'}</small></span></label>) : <p className="hg-meta">No records yet. This section will say so.</p>}</fieldset>}
        </div>)}
        <div className="hg-grid"><Field label="Private records from"><DateInput value={selection.start} onChange={e => update({ start: e.target.value })} /></Field><Field label="Private records through"><DateInput value={selection.end} onChange={e => update({ end: e.target.value })} /></Field></div>
        <p className="hg-meta">These dates filter your records only. Environmental readings keep their original dates. Records without a date are labelled.</p>
      </details>
      {privateWater && <WorkspaceLink title="Open home tests & reports" detail="Keep your own water test with this summary." onClick={() => props.go('tests')} />}
    </section>
    <details className="hg-card hg-record-tools"><summary>Privacy & extra detail</summary>
      <p className="hg-meta">These optional details apply only to the records you chose.</p>
      {([{ key: 'categories', label: 'Household categories', detail: selectedCategories.length ? selectedCategories.join(', ') : 'No categories selected.' }, { key: 'location', label: 'Location labels', detail: 'Approximate area and places named in your records.' }, { key: 'notes', label: 'Private notes on selected records', detail: 'Include your saved comments.' }, { key: 'attachments', label: 'Attachment names', detail: 'Names only. Original files are never included.' }] as const).map(item => <label className="hg-option" key={item.key}><input type="checkbox" aria-label={item.label} checked={selection[item.key]} onChange={e => update({ [item.key]: e.target.checked })} /><span><strong>{item.label}</strong><small>{item.detail}</small></span></label>)}
      <label className="hg-option"><input type="checkbox" checked={selection.appendix} onChange={e => update({ appendix: e.target.checked })} /><span><strong>Detailed appendix</strong><small>Evidence explanations and maintenance history.</small></span></label>
      <p className="hg-meta">Original photos, metadata, device location and account fields are not included. Review selected record names and notes, which may contain personal details you entered.</p>
    </details>
    <section className="hg-summary-selections" aria-label="Selected report contents"><header><FileText size={19} aria-hidden="true" /><h3>Your report contents</h3><ShieldCheck size={19} aria-hidden="true" /></header>{Object.values(selection.sections).some(Boolean) ? <ol>{(Object.keys(sectionLabels) as SummarySection[]).filter(key => selection.sections[key]).map(key => <li key={key}>{sectionLabels[key]}{recordSections.includes(key) && <span>{selectedRecords(key).length} {selectedRecords(key).length === 1 ? 'record' : 'records'}{missingSections.includes(key) ? ' · Section unavailable' : ''}</span>}</li>)}</ol> : <p className="hg-meta">No evidence sections selected.</p>}<footer>{selection.notes || selection.location || selection.categories || selection.attachments ? 'Optional private fields selected. Review their contents before sharing.' : 'Private notes, place labels, household categories and attachment names stay out.'}</footer></section>
    {error && <p role="alert">{error}</p>}<div className="hg-summary-cta"><p className="hg-meta">{Object.values(selection.sections).filter(Boolean).length} sections selected. You can review everything before sharing.</p><button className="hg-primary" onClick={preview}>Create household PDF</button></div>
  </>;
}
