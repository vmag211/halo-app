import type { Metadata } from 'next';
import OnboardingScreen from '../OnboardingScreen';
export const metadata: Metadata = {title:'Welcome'};
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const params = await searchParams;
  return <div className="halo-mobile-shell"><OnboardingScreen stackedWelcomeSubtitle entry={params.entry==='1'} changeAddress={params.change==='1'} returnTo={typeof params.next === 'string' ? params.next : undefined} /></div>;
}
