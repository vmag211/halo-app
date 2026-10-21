'use client';

import { ArrowRight, HandHeart, MessageSquare, Sprout } from 'lucide-react';
import { useHomeWorkspace } from '@/components/homeguard/HomeWorkspaceState';
import { useExpandedPreview } from './ExpandedPreviewState';
import { findProjectGuide, projectActionKey } from '@/lib/frontend/explore-project-guides';
import type { Engagement, OutcomeRecord, ProjectRecord } from '@/lib/frontend/explore-workspace';
import type { ExploreSection } from '@/lib/frontend/explore-preview';

export default function ExploreContinuations({ go }: { go: (section?: ExploreSection, view?: string, id?: string) => void }) {
  const workspace = useHomeWorkspace(); const state = useExpandedPreview();
  const engagement = (workspace.collections.exploreEngagements as Engagement[] | undefined)?.filter(item => item.status !== 'Closed').at(-1);
  const project = (workspace.collections.exploreProjects as ProjectRecord[] | undefined)?.filter(item => item.status !== 'Completed').at(-1);
  const outcome = (workspace.collections.exploreOutcomes as OutcomeRecord[] | undefined)?.filter(item => !['Result recorded', 'Closed without a result'].includes(item.status)).at(-1);
  if (!engagement && !project && !outcome) return null;
  function openOutcome(record: OutcomeRecord) {
    if (record.id.startsWith('note-case:')) go('observations', 'detail', record.id.slice(10));
    else if (record.id.startsWith('organization:')) go('organizations', 'detail', record.id.slice(13));
    else if (record.id.startsWith('project-review:')) go('projects', 'detail', record.id.slice(15));
    else if (record.id.startsWith('community:')) { workspace.setDraft('explore:community-topic', () => record.id.slice(10)); go('community'); }
    else { if (record.id.startsWith('outreach-resolution:')) workspace.setDraft('explore:recipient', () => record.id.slice(20)); go('outreach'); }
  }
  const guide = project ? findProjectGuide(project.id) : undefined;
  const completed = guide?.steps.filter((_, index) => state?.actions.some(action => action.key === projectActionKey(guide.id, index) && action.state === 'completed')).length ?? 0;
  const status = project ? project.status === 'Paused' ? 'Paused' : guide ? `${completed} of ${guide.steps.length} steps complete` : 'In progress' : engagement ? engagement.status : outcome!.status;
  const Icon = project ? Sprout : engagement ? HandHeart : MessageSquare;
  return <div className="ex-continue-strip" role="group" aria-label="Continue your work"><button onClick={() => project ? go('projects', 'detail', project.id) : engagement ? go('opportunities', 'detail', engagement.id) : openOutcome(outcome!)}><Icon size={19} aria-hidden="true" /><span><small>Continue · {status}</small><strong>{project?.title ?? engagement?.title ?? outcome!.title}</strong></span><ArrowRight size={17} aria-hidden="true" /></button></div>;
}
