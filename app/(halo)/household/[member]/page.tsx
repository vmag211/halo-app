import { notFound } from 'next/navigation';
import { homeMemberKeys } from '@/lib/frontend/home-household';
export default async function Page({ params }: { params: Promise<{ member: string }> }) {
  const { member } = await params;
  if (!homeMemberKeys.some(key => key === member)) notFound();
  return null;
}
