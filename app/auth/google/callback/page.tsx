'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {supabase} from '@/lib/supabase';
import {GOOGLE_CALLBACK_PATH,LINK_MESSAGES,finishGoogleLinkOnCallback} from '@/lib/googleSignin';

type Outcome = keyof typeof LINK_MESSAGES;

/**
 * Where Supabase returns after Google (feasibility spike, behind
 * HALO_FEATURE_GOOGLE_SIGNIN). The URL can carry the implicit flow's tokens,
 * so it is stripped before anything else runs, and lib/supabase.js does not
 * adopt them on this path. completeGoogleLink decides whether the returned
 * session is this household's; nothing here creates a session or merges one.
 */
export default function GoogleLinkCallback() {
  const [outcome,setOutcome]=useState<Outcome|null>(null);
  const started=useRef(false);
  useEffect(()=>{
    if(started.current)return;
    started.current=true;
    const href=window.location.href;
    window.history.replaceState(null,'',GOOGLE_CALLBACK_PATH);
    let storage:Storage|null=null;
    try{storage=window.sessionStorage;}catch{storage=null;}
    void (async()=>{
      try{setOutcome((await finishGoogleLinkOnCallback({auth:supabase.auth,storage,href,fetcher:fetch})).outcome);}
      catch{setOutcome('failed');}
    })();
  },[]);
  return <main className="halo-status-page"><h1>{outcome==='linked'?'Household kept':'Google sign-in'}</h1><p role="status">{outcome?LINK_MESSAGES[outcome]:'Checking your sign-in...'}</p>{outcome&&<p><Link href="/settings">Back to Settings</Link></p>}</main>;
}
