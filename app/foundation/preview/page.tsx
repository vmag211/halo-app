import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import FoundationPreview from '@/components/foundation/FoundationPreview';
import { isFoundationScenario } from '@/lib/frontend/foundation-preview';
import { readPreviewPreferences } from '@/lib/frontend/factor-preview';

export const metadata: Metadata = { title: 'Foundation preview' };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === 'production' && process.env.HALO_ENABLE_FRONTEND_PREVIEW !== '1') notFound();
  const params = await searchParams;
  return <FoundationPreview initialScenario={isFoundationScenario(params.scenario) ? params.scenario : 'shell'} preferences={readPreviewPreferences(params)} />;
}
