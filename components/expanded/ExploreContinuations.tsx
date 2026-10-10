'use client';

import { ArrowRight, HandHeart, MessageSquare, Sprout } from 'lucide-react';
import { useHomeWorkspace } from '@/components/homeguard/HomeWorkspaceState';
import type { Engagement, OutcomeRecord, ProjectRecord } from '@/lib/frontend/explore-workspace';
import type { ExploreSection } from '@/lib/frontend/explore-preview';

export default function ExploreContinuations({ go }: { go: (section?: ExploreSection, view?: string, id?: string) => void }) {
  const workspace = useHomeWorkspace();
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
  return <section className="ex-ongoing-work"><h3>Keep your work moving.</h3><p>A commitment, a project or a question you are still following through.</p>{engagement && <button className="ex-hub-row" onClick={() => go('opportunities', 'detail', engagement.id)}><HandHeart size={20} aria-hidden="true" /><span><strong>{engagement.title}</strong><small>My volunteering · {engagement.status}</small></span><ArrowRight size={17} aria-hidden="true" /></button>}{project && <button className="ex-hub-row" onClick={() => go('projects', 'detail', project.id)}><Sprout size={20} aria-hidden="true" /><span><strong>{project.title}</strong><small>My project · {project.status}</small></span><ArrowRight size={17} aria-hidden="true" /></button>}{outcome && <button className="ex-hub-row" onClick={() => openOutcome(outcome)}><MessageSquare size={20} aria-hidden="true" /><span><strong>{outcome.title}</strong><small>{outcome.goal}</small><small>{outcome.status}, recorded by you</small></span><ArrowRight size={17} aria-hidden="true" /></button>}</section>;
}
