"use client";
import { useCallback, useMemo, useState } from 'react';
import OnboardingScreen from '@/app/OnboardingScreen';
import Button from '@/components/ui/Button';
import { createMockOnboardingApi, mockScenarios, type MockScenario } from '@/lib/frontend/mock';
import { copy } from '@/lib/frontend/copy';

export default function Preview({initialScenario='default',initialDesign='approved'}:{initialScenario?:MockScenario;initialDesign?:'approved'|'mobile'}) {
  const [design,setDesign]=useState(initialDesign);
  const [scenario,setScenario]=useState<MockScenario>(initialScenario);
  const [run,setRun]=useState(0);
  const [completed,setCompleted]=useState(false);
  const api=useMemo(()=>{ void run; return createMockOnboardingApi(scenario); },[scenario,run]);
  const complete=useCallback(()=>setCompleted(true),[]);
  function restart() {setCompleted(false);setRun(value=>value+1);}
  return <><aside className="halo-preview-toolbar" aria-label={copy.preview.title}>
    <p>{copy.preview.disclaimer}</p><label>{copy.preview.scenario}<select value={scenario} onChange={event=>{setScenario(event.target.value as MockScenario);restart();}}>{mockScenarios.map(value=><option key={value} value={value}>{value}</option>)}</select></label>
    <label>Design<select value={design} onChange={event=>setDesign(event.target.value as 'approved'|'mobile')}><option value="approved">Previous design</option><option value="mobile">Approved mobile design</option></select></label>
  </aside><div className={design==='mobile'?'halo-mobile-shell':undefined}>{completed?<main className="halo-app halo-handoff"><h1>{copy.preview.complete}</h1><p>{copy.preview.handoff}</p><Button onClick={restart}>{copy.preview.restart}</Button></main>:<OnboardingScreen key={`${scenario}-${run}`} api={api} preview stackedWelcomeSubtitle={design==='mobile'} onComplete={complete} />}</div></>;
}
