import { notFound } from 'next/navigation';
import FoundationPreview from '@/components/foundation/FoundationPreview';
import { isFoundationScenario } from '@/lib/frontend/foundation-preview';
import { isFactorKey, readPreviewPreferences } from '@/lib/frontend/factor-preview';

export default async function FactorPreviewPage({ params, searchParams }: {
  params: Promise<{ factor: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV === 'production' && process.env.HALO_ENABLE_FRONTEND_PREVIEW !== '1') notFound();
  const [{ factor }, query] = await Promise.all([params, searchParams]);
  if (!isFactorKey(factor)) notFound();
  return <FoundationPreview key={factor} initialFactor={factor} initialScenario={isFoundationScenario(query.scenario) ? query.scenario : 'shell'} preferences={readPreviewPreferences(query)} />;
}
