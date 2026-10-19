'use client';

import { useEffect, useRef, useState } from 'react';
import { useHomeDraft, useHomeWorkspace } from '@/components/homeguard/HomeWorkspaceState';
import { findProjectGuide, projectActionKey } from '@/lib/frontend/explore-project-guides';
import { validDay, type Engagement, type ProjectRecord } from '@/lib/frontend/explore-workspace';
import { lunaCalendarAnchor } from '@/lib/frontend/luna-tools-preview';
import { dayAdd, emptyWeekMeta } from '@/lib/frontend/week-preview';
import { useExpandedPreview } from './ExpandedPreviewState';

/** Explicit review-control fixture loader. Never rendered in the application surface. */
export default function WeekConnectedExamples() {
  const workspace = useHomeWorkspace(); const state = useExpandedPreview();
  const latestWorkspace = useRef(workspace);
  const latestState = useRef(state);
  useEffect(() => { latestWorkspace.current = workspace; latestState.current = state; }, [workspace, state]);
  const [zone] = useHomeDraft('week:zone', 'America/New_York');
  const [, setDate] = useHomeDraft('week:date', lunaCalendarAnchor(new Date(), zone));
  const [busy, setBusy] = useState(false); const busyRef = useRef(false);
  const [feedback, setFeedback] = useState(''); const [failed, setFailed] = useState(false);
  const unavailable = () => (!busyRef.current && latestWorkspace.current.pending) || ['offline', 'loading', 'error', 'save-error', 'conflict'].includes(latestWorkspace.current.scenario) || latestState.current?.fail || !latestState.current || !navigator.onLine;
  async function load() {
    if (busyRef.current) return;
    if (unavailable()) { setFailed(true); setFeedback('Connected examples could not load. Existing work is kept; use an available review state and retry.'); return; }
    const guide = findProjectGuide('solar-oven');
    if (!guide) { setFailed(true); setFeedback('The example guide is unavailable. Nothing changed.'); return; }
    busyRef.current = true; setBusy(true); setFailed(false); setFeedback('Preparing connected activity examples...');
    const today = lunaCalendarAnchor(new Date(), zone);
    const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
    const saturday = dayAdd(today, ((6 - weekday + 7) % 7) || 7);
    const project: ProjectRecord = { id: guide.id, revision: 0, title: guide.title, status: 'Active', goal: guide.purpose, stepNotes: {}, outcome: '', reviewDate: '', history: [{ status: 'Active', note: 'Explicitly loaded illustrative review project. No actual build or result is recorded.' }] };
    const engagement: Engagement = { id: 'week-cleanup-example', revision: 0, title: 'Community cleanup example', organizer: 'Illustrative community plan', cause: 'Community', url: 'https://www.charlottenc.gov/Streets-and-Neighborhoods/Get-Involved/Keep-Charlotte-Beautiful', place: 'Example meeting place, confirm with organizer', date: saturday, status: 'Considering', statusDate: '', hours: '', preparation: 'Example checklist: check organizer instructions, meeting place, access and supplies before joining. No real event availability is loaded.', outcome: '', reference: '', followupDate: '', history: [] };
    let savedRecords = 0; let addedTasks = 0;
    try {
      for (const [key, record] of [['exploreProjects', project], ['exploreEngagements', engagement]] as const) {
        if (latestWorkspace.current.collections[key]?.some(item => item.id === record.id)) continue;
        if (unavailable() || !await latestWorkspace.current.write(key, record)) throw new Error('record');
        savedRecords++;
      }
      if (unavailable()) throw new Error('state');
      const retainedEngagement = latestWorkspace.current.collections.exploreEngagements?.find(item => item.id === engagement.id) as Engagement | undefined;
      const communityDate = retainedEngagement ? validDay(retainedEngagement.date) ? retainedEngagement.date : '' : saturday;
      const entries = [
        { key: projectActionKey(guide.id, 0)!, title: guide.steps[0].title, date: today, time: '09:00', duration: 45, reason: `Illustrative scheduled project step. Guide ${guide.version}; no actual work is recorded.` },
        { key: projectActionKey(guide.id, 1)!, title: guide.steps[1].title, date: '', time: '', duration: 30, reason: `Illustrative unscheduled project step. Guide ${guide.version}; no actual work is recorded.` },
        { key: `explore:commitment:${engagement.id}`, title: retainedEngagement?.title ?? engagement.title, date: communityDate, time: communityDate ? '10:00' : '', duration: 60, reason: 'Explicit illustrative community plan, not a real listing, reservation or registration. Confirm any actual event with the organizer.' },
      ];
      for (const entry of entries) {
        if (latestState.current?.actions.some(action => action.key === entry.key)) continue;
        const metadata = { [entry.key]: { ...emptyWeekMeta, time: entry.time, duration: entry.duration, estimateSet: true, zone, history: ['Explicitly loaded connected activity example.'] } };
        if (unavailable() || !await latestState.current?.addActions([{ key: entry.key, title: entry.title, origin: 'Explore', reason: entry.reason }], entry.date, {metadata})) throw new Error('task');
        addedTasks++;
      }
      setDate(today); setFailed(false); setFeedback('Connected activity examples loaded for this visit. Existing records, tasks, schedules and edits were kept. The community date and place are illustrative, not a verified event.');
    } catch {
      setFailed(true); setFeedback(`${savedRecords || addedTasks ? `Partial load: ${savedRecords} new record${savedRecords === 1 ? '' : 's'} and ${addedTasks} new task${addedTasks === 1 ? '' : 's'} were kept. ` : ''}The remaining connected examples could not load. Existing work and edits are unchanged. Retry when saving is available.`);
    } finally { busyRef.current = false; setBusy(false); }
  }
  return <div><button type="button" disabled={busy || workspace.pending} onClick={load}>{busy ? 'Loading connected examples...' : 'Load connected activity examples'}</button>{feedback && <p role={failed ? 'alert' : 'status'}>{feedback}</p>}</div>;
}
