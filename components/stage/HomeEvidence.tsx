'use client';

import Link from 'next/link';
import { Callout } from '@/components/ui/Foundation';
import SeverityPill from '@/components/ui/SeverityPill';
import { useStageSession } from './StageSession';
import { dateLabel, finite, isoDate, nonnegative, record, rows, safeText, safeUrl, severity, textList } from '@/lib/frontend/stage-values';
import type { FactorKey } from '@/lib/frontend/factor-preview';

const money = (value: unknown) => {
  const cost = record(value); const low = nonnegative(cost.low), high = nonnegative(cost.high);
  return low !== null && high !== null && high >= low ? `$${low.toLocaleString('en-US')} to $${high.toLocaleString('en-US')}` : 'Cost estimate unavailable';
};

/** Conditional backend evidence uses the existing detail panels. No tests,
 * household predictions, priorities, or action costs are invented client-side. */
export function HomeEvidence({ factor }: { factor: FactorKey }) {
  const { home, profile, refresh, offline } = useStageSession();
  const water = record(home.data?.water); const lead = record(home.data?.lead);
  const privateWater = water.status === 'private_well' || ['well', 'spring'].includes(profile?.profile?.water_source ?? '');
  if (factor === 'pfas') {
    if (privateWater) return <TestingPlan />;
    const detections = rows(water.detected_unregulated_latest);
    const excluded = rows(water.excluded_from_score);
    const readingCount = nonnegative(water.reading_count);
    const source = safeUrl(water.source_url);
    return <section className="halo-ph-panel"><span className="halo-ph-kicker">About these results</span><h2>Your water source</h2>
      {safeText(water.pws_name) && <p>{safeText(water.pws_name)}</p>}
      {profile?.profile?.pwsid && <p className="halo-f-meta">Utility ID: <code>{safeText(profile.profile.pwsid)}</code></p>}
      {profile?.profile?.water_source === 'other' && <p>You told HALO you are not sure where your water comes from. You can change this in Settings.</p>}
      {water.status === 'lookup_failed' && <Callout tone="error"><p>This is a problem on our end, not a finding about your water.</p><button className="halo-text-button" disabled={home.loading || offline} onClick={() => void refresh()}>Retry water lookup</button></Callout>}
      {water.status === 'no_pwsid_available' && <Callout tone="notice"><p>Your address could not be matched to a water utility. Confirm whether you use a private well, spring, or utility water.</p><Link href="/settings?open=home">Confirm your water source</Link></Callout>}
      {readingCount !== null && <p>{readingCount.toLocaleString('en-US')} recorded readings. {isoDate(water.earliest_sample_iso) && isoDate(water.latest_sample_iso) ? `${dateLabel(water.earliest_sample_iso)} to ${dateLabel(water.latest_sample_iso)}.` : 'Sample date range unavailable.'}</p>}
      {detections.length > 0 && <details><summary>Detected without an enforceable comparison</summary><p>Detection does not establish safety or individual exposure.</p><ul>{detections.map((row, index) => <li key={index}>{safeText(row.contaminant, 'Compound')}: {nonnegative(row.value_ppt) === null ? 'Concentration unavailable' : `${Number(row.value_ppt).toFixed(1)} ppt`}. {dateLabel(row.date_iso)}.</li>)}</ul></details>}
      {excluded.length > 0 && <details><summary>Shown, not scored</summary>{excluded.map((row, index) => { const value = nonnegative(row.value_ppt); const lithium = safeText(row.contaminant).toLowerCase() === 'lithium'; return <div key={index}><h3>{safeText(row.contaminant, 'Compound')}</h3><p>{value === null ? 'Concentration unavailable' : lithium ? `${(value / 1000).toFixed(1)} µg/L` : `${value.toFixed(1)} ppt`}. {dateLabel(row.date_iso)}.</p><p>{safeText(row.reason)}</p>{lithium && nonnegative(row.health_reference_level_ppt) !== null && <p>Reference level: {(Number(row.health_reference_level_ppt) / 1000).toFixed(1)} µg/L, non-regulatory.</p>}</div>; })}</details>}
      {source && <a href={source} target="_blank" rel="noopener noreferrer">Water data source</a>}
      <Link href="/settings?open=home">Review home details</Link>
    </section>;
  }
  if (factor === 'lead') {
    const inventory = record(lead.utility_inventory); const source = record(inventory.source); const url = safeUrl(source.url);
    return <section className="halo-ph-panel"><span className="halo-ph-kicker">What is known about this home</span><h2>Keep the evidence in context</h2>
      {safeText(lead.text) && safeText(lead.text) !== safeText(lead.sentence) && <p>{safeText(lead.text)}</p>}
      {profile?.profile?.home_year == null && <Link href="/settings?open=home">Add the year your home was built in Settings</Link>}
      {privateWater && <Link href="/factors/pfas#reading-detail">View the private-water testing plan</Link>}
      {Object.keys(inventory).length > 0 && <><h3>Utility-wide service lines</h3><p>{safeText(inventory.utility, 'Your utility')} reported {nonnegative(inventory.needs_replacement)?.toLocaleString('en-US') ?? 'an unknown number of'} service lines needing replacement, and {nonnegative(inventory.unknown)?.toLocaleString('en-US') ?? 'an unknown number'} with unknown material.</p><p>This is utility-wide context, not a finding about your address. It does not change the lead estimate.</p>{url && <a href={url} target="_blank" rel="noopener noreferrer">{safeText(source.name, 'Service-line inventory source')}{isoDate(source.retrieved) ? `, retrieved ${dateLabel(source.retrieved)}` : ''}</a>}</>}
    </section>;
  }
  return null;
}

function TestingPlan() {
  const { home } = useStageSession(); const water = record(home.data?.water); const plan = record(water.test_plan);
  const tests = rows(plan.tests).slice().sort((a, b) => (finite(a.rank) ?? Infinity) - (finite(b.rank) ?? Infinity));
  return <section className="halo-ph-panel" id="testing-plan"><span className="halo-ph-kicker">Private water</span><h2>Your testing plan</h2><p>{safeText(water.status === 'private_well' ? water.message : null, 'HALO has no agency testing result for this supply. A lab test is needed to understand your water.')}</p>
    {textList(plan.reasons).map((reason, index) => <p key={index}>{reason}</p>)}
    {!tests.length && <p>A tailored testing plan is not available yet. No water score has been inferred.</p>}
    {tests.map((test, index) => <details key={safeText(test.id, String(index))}><summary>{finite(test.rank) ?? index + 1}. {safeText(test.name, 'Water test')}</summary><p>{safeText(test.priority)}{safeText(test.cadence) ? ` · ${safeText(test.cadence)}` : ''}</p><p>{safeText(test.why)}</p><p>{safeText(test.where)}</p><p>Estimated cost: {money(test.estimated_cost)}</p>{test.needs_local_context === true && <p>Local conditions matter for this test.</p>}</details>)}
    {!!plan.start_here_cost && <p>Starting tests, estimated total: {money(plan.start_here_cost)}</p>}
    {!!plan.full_panel_cost && <p>Full panel, estimated total: {money(plan.full_panel_cost)}</p>}
  </section>;
}

export function HomeActionPlan() {
  const { home, profile } = useStageSession();
  const water = record(home.data?.water);
  const privateWater = water.status === 'private_well' || ['well', 'spring'].includes(profile?.profile?.water_source ?? '');
  const actions = rows(home.data?.action_plan).sort((a, b) => (finite(a.rank) ?? Infinity) - (finite(b.rank) ?? Infinity));
  if (!home.data) return null;
  return <section className="halo-ph-panel"><span className="halo-ph-kicker">From the home assessment</span><h2>{privateWater ? 'Start with testing' : 'Your action plan'}</h2>
    {privateWater ? <><p>No measured result has been assigned to your private water supply.</p><Link href="/factors/pfas#reading-detail">Open your water testing plan</Link></> : actions.length ? actions.map((item, index) => <details key={safeText(item.key, String(index))}><summary>{finite(item.rank) ?? index + 1}. {safeText(item.title, 'Recommended action')}</summary><SeverityPill severity={severity(item.severity)} /><p>{safeText(item.reason)}</p>{safeText(item.cost) && <p>Estimated cost: {safeText(item.cost)}</p>}{safeText(item.certification) && <p>Certification to verify: <code>{safeText(item.certification)}</code></p>}<p>{safeText(item.action)}</p>{profile && typeof profile.profile?.renter_mode === 'boolean' && <p className="halo-f-meta">{profile.profile.renter_mode ? 'For renters' : 'For owners'}</p>}</details>) : <p>{record(home.data.score).display_score == null ? 'There is not enough evidence for a scored action plan. Missing data is not an all-clear.' : 'No action items were returned with this assessment. Check each factor’s guidance and data coverage.'}</p>}
  </section>;
}
