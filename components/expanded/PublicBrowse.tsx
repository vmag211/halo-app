'use client';
import Link from 'next/link';
import {ArrowLeft,ArrowUpRight,BookOpen,Map,ShieldCheck} from 'lucide-react';
import LearnLibrary from './LearnLibrary';
import RecoveryFlowBoundary from './RecoveryFlowBoundary';
import {completionCopy as c} from '@/lib/frontend/copy/completion';
import './completion-workflows.css';
import './learn-library.css';

/** Public review surface never renders household scores, private actions or Luna context. */
export default function PublicBrowse({mapHref,production=false}:{mapHref:string;production?:boolean}){
 return <main className="hc-public" aria-label="Public HALO">
  <header className="hc-public-header"><span className="hc-public-wordmark"><span className="halo-logo-mark" aria-hidden="true"/>HALO <span>Learn</span></span><Link href={production?'/app':'/foundation/preview/expanded/?tab=plan'} prefetch={false}><ArrowLeft size={16} aria-hidden="true"/>Open HALO</Link></header>
  <div className="hc-public-intro"><div className="hc-public-intro-copy"><span className="hc-public-eyebrow"><BookOpen size={17} aria-hidden="true"/>A little understanding goes a long way</span><h1>Learn with HALO</h1><p>Make sense of the air, water and places around you.</p><a className="hc-browse-topics" href="#learn-topics">Browse the topics<ArrowUpRight size={17} aria-hidden="true"/></a></div><div className="hc-public-landscape" aria-hidden="true"/></div>
  <div className="hc-public-body"><LearnLibrary level={2}/><aside className="hc-public-support" aria-label="Explore and access"><section className="hc-public-map"><Map size={25} aria-hidden="true"/><h2>Put it in context.</h2><p>Explore public environmental records on the map.</p><Link className="hp-primary" href={mapHref}>{c.browseMap}<ArrowUpRight size={18} aria-hidden="true"/></Link></section><section className="hc-public-setup"><ShieldCheck size={22} aria-hidden="true"/><h2>Your space, when you’re ready.</h2><p>{c.browseHint}</p><Link className="hp-primary" href={production?'/onboarding?entry=1':'/onboarding/preview/?design=mobile'} prefetch={false}>{c.setup}<ArrowUpRight size={17} aria-hidden="true"/></Link><RecoveryFlowBoundary/></section></aside></div>
 </main>;
}
