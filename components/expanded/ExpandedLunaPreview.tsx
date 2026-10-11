'use client';

import { useSearchParams } from 'next/navigation';
import { useHomeWorkspace } from '@/components/homeguard/HomeWorkspaceState';
import { findProjectGuide, projectStepIndex } from '@/lib/frontend/explore-project-guides';
import LunaConversation from './LunaConversation';

export default function ExpandedLunaPreview({ context, onClose, go, offline, environmentAvailable = true }: { context: string; onClose: () => void; go: (tab: string, destination?: string, view?: string, id?: string) => void; offline?: boolean; environmentAvailable?: boolean }) {
  const query = useSearchParams(); const workspace = useHomeWorkspace();
  const id = query.get('exploreRecord') ?? ''; const project = query.get('destination') === 'projects' ? findProjectGuide(id) : undefined;
  const index = projectStepIndex(Number(workspace.drafts[`explore:project-step:${id}`] ?? 0), project?.steps.length ?? 0);
  const step = project?.steps[index]; const source = project?.sources.find(source => step?.sourceIds.includes(source.id));
  return <LunaConversation context={project?.title ?? context} onClose={onClose} go={go} offline={offline} environmentAvailable={environmentAvailable} currentGuide={project && step && source ? { id: project.id, title: project.title, stepTitle: step.title, instructions: step.instructions, source: source.url } : undefined} />;
}
