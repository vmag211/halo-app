import { notFound } from 'next/navigation';
import FoundationPreview from '@/components/foundation/FoundationPreview';
import { isFoundationScenario } from '@/lib/frontend/foundation-preview';
import { readPreviewPreferences } from '@/lib/frontend/factor-preview';

export default async function FamilyPreviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === 'production' && process.env.HALO_ENABLE_FRONTEND_PREVIEW !== '1') notFound();
  const params = await searchParams;
  return <FoundationPreview initialFamily initialScenario={isFoundationScenario(params.scenario) ? params.scenario : 'shell'} preferences={readPreviewPreferences(params)} />;
}
