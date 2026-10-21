'use client';
import Link from 'next/link';
import {useState} from 'react';
import {BookOpen,Search,ArrowUpRight,Wind,Sun,Flower2,Droplets,House,FlaskConical,Pipette,ChevronDown} from 'lucide-react';
import {LEARN_CONTENT} from '@/lib/learnContent';
import {factorKeys,type FactorKey} from '@/lib/frontend/factor-preview';
import {completionCopy as c} from '@/lib/frontend/copy/completion';
import {useHomeDraft} from '@/components/homeguard/HomeWorkspaceState';
import './completion-workflows.css';
import './learn-library.css';

const clean=(text:string)=>text.replace(/\u2014/g,',');
const topicIcons={air:Wind,uv:Sun,pollen:Flower2,mold:Droplets,pfas:FlaskConical,radon:House,lead:Pipette};
/** `level` exposes the outline level when the library sits directly under a page title (public Learn) instead of a settings section. */
export default function LearnLibrary({factorHref,level}:{factorHref?:(key:FactorKey)=>string;level?:2}){
 const [query,setQuery]=useHomeDraft('view:learn:query','');
 const [filter,setFilter]=useHomeDraft('view:learn:filter','all');
 const [selected,setSelected]=useState<string|null>(null);
 const [scenario,setScenario]=useHomeDraft('review:learn','ready');
 const q=query.trim().toLowerCase();
 const topics=factorKeys.filter(key=>(filter==='all'||filter===key)&&`${key} ${LEARN_CONTENT[key].title} ${LEARN_CONTENT[key].what_it_is}`.toLowerCase().includes(q));
 const terms=c.glossary.filter(term=>(filter==='all'||filter===term.related)&&`${term.title} ${term.text}`.toLowerCase().includes(q));
 return <section className="hc-library" id="learn-topics" aria-label={c.learn}><h3 aria-level={level}><BookOpen size={20} aria-hidden="true"/>{c.learn}</h3>
 <div className="hc-library-tools"><label className="hc-search"><Search size={17} aria-hidden="true"/><span className="halo-sr-only">{c.search}</span><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder={c.search}/></label>
 <label className="hc-filter"><span className="halo-sr-only">{c.filter}</span><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">{c.all}</option>{factorKeys.map(key=><option key={key} value={key}>{LEARN_CONTENT[key].title}</option>)}</select></label></div>
 {query&&<button className="hp-text" onClick={()=>setQuery('')}>{c.clear}</button>}
 {scenario==='error'?<div role="status"><p>{c.catalogUnavailable}</p><button className="hp-text" onClick={()=>setScenario('ready')}>{c.catalogRetry}</button></div>:scenario==='loading'?<p role="status">{c.pending}</p>:scenario==='empty'?<p>{c.emptyLibrary}</p>:<>
 {!topics.length&&!terms.length&&<p role="status">{c.none}</p>}
 <div className="hc-topic-grid">{topics.map(key=>{const Icon=topicIcons[key];return <details key={key} className="hc-topic hc-factor-topic" data-factor={key} open={selected===key} onToggle={e=>{if(e.currentTarget.open)setSelected(key);else if(selected===key)setSelected(null);}}><summary><span className="hc-topic-icon" aria-hidden="true"><Icon size={22} strokeWidth={1.6}/></span><span>{LEARN_CONTENT[key].title}</span><ChevronDown className="hc-topic-chevron" size={17} aria-hidden="true"/></summary><div className="hc-topic-content"><p>{clean(LEARN_CONTENT[key].what_it_is)}</p>{factorHref&&<Link className="hp-link-row" href={factorHref(key)}><span>{c.openGuide}</span><ArrowUpRight size={16}/></Link>}<h4 aria-level={level&&level+1}>{c.sources}</h4>{LEARN_CONTENT[key].sources.map((source:{url:string;label:string;retrieved:string})=><div className="hc-source" key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{clean(source.label)}<ArrowUpRight size={14} aria-hidden="true"/></a><small>{c.checked}: {source.retrieved}</small></div>)}<small>{c.sourceLimit}</small></div></details>;})}</div>
 {terms.length>0&&<div className="hc-glossary"><h4 aria-level={level&&level+1}>{c.terms}</h4>{terms.map(term=><details className="hc-topic hc-term" key={term.id}><summary><span>{term.title}</span><ChevronDown className="hc-topic-chevron" size={17} aria-hidden="true"/></summary><p>{term.text}</p>{factorHref&&<Link className="hp-text" href={factorHref(term.related)}>{c.openGuide}<ArrowUpRight size={16}/></Link>}</details>)}</div>}
 </> }</section>;
}
