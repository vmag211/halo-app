import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isFactorKey, type FactorKey } from '@/lib/frontend/factor-preview';
type Props = { params: Promise<{ factor: string }> };
const titles: Record<FactorKey, string> = { air: 'Air quality', uv: 'UV index', pollen: 'Pollen', mold: 'Mold conditions', pfas: 'PFAS in water', radon: 'Radon', lead: 'Lead in plumbing' };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { factor } = await params;
  return { title: isFactorKey(factor) ? titles[factor] : 'Page unavailable' };
}
export default async function Page({ params }: Props) {
  if (!isFactorKey((await params).factor)) notFound();
  return null;
}
