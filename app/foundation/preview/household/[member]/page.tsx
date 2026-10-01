import { notFound } from 'next/navigation';
import FoundationPreview from '@/components/foundation/FoundationPreview';
import { isFoundationScenario } from '@/lib/frontend/foundation-preview';
import { readPreviewPreferences } from '@/lib/frontend/factor-preview';
import { isHomeMemberKey } from '@/lib/frontend/home-household';

export default async function HomeMemberPreviewPage({ params, searchParams }: { params: Promise<{ member: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === 'production' && process.env.HALO_ENABLE_FRONTEND_PREVIEW !== '1') notFound();
  const { member } = await params;
  if (!isHomeMemberKey(member)) notFound();
  const query = await searchParams;
  return <FoundationPreview initialMember={member} initialScenario={isFoundationScenario(query.scenario) ? query.scenario : 'shell'} preferences={readPreviewPreferences(query)} />;
}
