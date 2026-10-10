'use client';

import Link from 'next/link';
import { NotebookPen } from 'lucide-react';
import { useHomeDraft } from '@/components/homeguard/HomeWorkspaceState';
import type { EvidenceReference } from '@/lib/frontend/explore-workspace';

export const blankEvidence: EvidenceReference = { recordId: '', title: '', layer: '', observedAt: null, scope: '' };
export default function MapRecordToExplore({ evidence, href }: { evidence: EvidenceReference; href: string }) {
  const [, setQuestion] = useHomeDraft('explore:note-starter', '');
  const [, setEvidence] = useHomeDraft('explore:note-evidence-starter', blankEvidence);
  return <div className="halo-map-detail ex-map-to-note"><h3>Make this record useful.</h3><p>Keep a factual question and this public record reference in a private note. Existing writing is retained, and nothing is sent to Luna or an office.</p><Link href={href} prefetch={false} onClick={() => { setQuestion(`I want to understand the public ${evidence.layer} record for ${evidence.title}. Which source and date should I review, and what would be an appropriate follow-up?`); setEvidence(evidence); }}><NotebookPen size={17} aria-hidden="true" />Keep a question about this record</Link><p className="halo-f-meta">Sample record context, not a household measurement or a verified finding.</p></div>;
}
