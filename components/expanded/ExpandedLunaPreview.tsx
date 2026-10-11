'use client';

import { useSearchParams } from 'next/navigation';
import { useHomeWorkspace } from '@/components/homeguard/HomeWorkspaceState';
import { findProjectGuide, projectStepIndex } from '@/lib/frontend/explore-project-guides';
import type { ExploreSection } from '@/lib/frontend/explore-preview';
import ExploreCompanion from './ExploreCompanion';

export default function ExpandedLunaPreview({ home, onClose, go }: { home: boolean; onClose: () => void; go: (section?: ExploreSection, view?: string, id?: string) => void }) {
  const query = useSearchParams(); const workspace = useHomeWorkspace();
  const id = query.get('exploreRecord') ?? ''; const project = query.get('destination') === 'projects' ? findProjectGuide(id) : undefined;
  const index = projectStepIndex(Number(workspace.drafts[`explore:project-step:${id}`] ?? 0), project?.steps.length ?? 0);
  const step = project?.steps[index]; const source = project?.sources.find(source => step?.sourceIds.includes(source.id));
  return <ExploreCompanion context={project?.title ?? (home ? 'Homeguard' : 'Explore')} hideToolbar initialPanel="luna" onClose={onClose} go={go} guide={step && source ? { title: step.title, instructions: step.instructions, source: source.url } : undefined} />;
}
