import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { homeMemberKeys } from '@/lib/frontend/home-household';
import { copy } from '@/lib/frontend/copy';
type Props = { params: Promise<{ member: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { member } = await params;
  const label = (copy.household.groups as Record<string, string>)[`has_${member}`];
  return { title: label ? `Your household: ${label}` : 'Page unavailable' };
}
export default async function Page({ params }: Props) {
  const { member } = await params;
  if (!homeMemberKeys.some(key => key === member)) notFound();
  return null;
}
