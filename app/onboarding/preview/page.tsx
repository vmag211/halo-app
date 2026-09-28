import { notFound } from 'next/navigation';
import Preview from '@/components/onboarding/Preview';
import { isMockScenario } from '@/lib/frontend/mock';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  if(process.env.NODE_ENV==='production' && process.env.HALO_ENABLE_FRONTEND_PREVIEW!=='1') notFound();
  const params=await searchParams;
  return <Preview initialScenario={isMockScenario(params.scenario)?params.scenario:'default'} />;
}
