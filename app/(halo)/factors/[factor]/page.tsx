import { notFound } from 'next/navigation';
import { isFactorKey } from '@/lib/frontend/factor-preview';
export default async function Page({ params }: { params: Promise<{ factor: string }> }) {
  if (!isFactorKey((await params).factor)) notFound();
  return null;
}
