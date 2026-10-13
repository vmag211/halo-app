'use client';
import Link from 'next/link';
import {ArrowUpRight,Map,ShieldCheck} from 'lucide-react';
import LearnLibrary from './LearnLibrary';
import RecoveryFlowBoundary from './RecoveryFlowBoundary';
import {completionCopy as c} from '@/lib/frontend/copy/completion';
import './completion-workflows.css';

/** Public review surface never renders household scores, private actions or Luna context. */
export default function PublicBrowse({mapHref,production=false}:{mapHref:string;production?:boolean}){
 return <main className="hc-public" aria-label="Public HALO"><div className="hc-public-intro"><span className="hc-public-mark" aria-hidden="true"><Map size={44}/></span><h1>Explore with HALO</h1><p>{c.browseHint}</p><Link className="hp-primary" href={mapHref}>{c.browseMap}<ArrowUpRight size={18}/></Link></div><LearnLibrary/><section className="hc-public-setup"><ShieldCheck size={22}/><h2>Your space, when you’re ready.</h2><p>Keep a home, projects and your week together.</p><Link className="hp-primary" href={production?'/onboarding?entry=1':'/onboarding/preview/?design=mobile'}>{c.setup}</Link><RecoveryFlowBoundary/></section></main>;
}
