import type { Metadata } from 'next';
import OnboardingScreen from '../OnboardingScreen';
export const metadata: Metadata = {title:'Welcome'};
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const params = await searchParams;
  return <OnboardingScreen entry={params.entry==='1'} changeAddress={params.change==='1'} />;
}
