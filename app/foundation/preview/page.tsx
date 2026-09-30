import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import localFont from 'next/font/local';
import FoundationPreview from '@/components/foundation/FoundationPreview';
import { isFoundationScenario } from '@/lib/frontend/foundation-preview';
import './preview.css';

export const metadata: Metadata = { title: 'Foundation preview' };
const plex = localFont({ src: '../../../public/fonts/ibm-plex-mono-latin.woff2', variable: '--font-plex', weight: '400', display: 'swap', fallback: ['Courier New'] });

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === 'production' && process.env.HALO_ENABLE_FRONTEND_PREVIEW !== '1') notFound();
  const params = await searchParams;
  return <div className={plex.variable}><FoundationPreview initialScenario={isFoundationScenario(params.scenario) ? params.scenario : 'shell'} /></div>;
}
