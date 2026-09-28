import type { Metadata } from 'next';
import Link from 'next/link';
import { copy } from '@/lib/frontend/copy';
import ProfileRecheck from '@/components/onboarding/ProfileRecheck';
export const metadata:Metadata={title:'Today'};
/** Integration boundary only. No fabricated environmental dashboard. */
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const params = await searchParams;
  return <main className="halo-app halo-handoff"><h1>{copy.handoff.title}</h1><p>{copy.handoff.message}</p>{params.verify==='1' && <ProfileRecheck />}<Link className="halo-button halo-secondary" href="/onboarding">{copy.handoff.review}</Link></main>;
}
