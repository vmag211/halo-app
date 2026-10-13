'use client';
import Link from 'next/link';
import {useState} from 'react';
import {BookOpen,Search,ArrowUpRight} from 'lucide-react';
import {LEARN_CONTENT} from '@/lib/learnContent';
import {factorKeys,type FactorKey} from '@/lib/frontend/factor-preview';
import {completionCopy as c} from '@/lib/frontend/copy/completion';
import {useHomeDraft} from '@/components/homeguard/HomeWorkspaceState';
import './completion-workflows.css';

const clean=(text:string)=>text.replace(/\u2014/g,',');
export default function LearnLibrary({factorHref}:{factorHref?:(key:FactorKey)=>string}){
 const [query,setQuery]=useHomeDraft('view:learn:query','');
 const [filter,setFilter]=useHomeDraft('view:learn:filter','all');
 const [selected,setSelected]=useState<string|null>(null);
 const [scenario,setScenario]=useHomeDraft('review:learn','ready');
 const q=query.trim().toLowerCase();
 const topics=factorKeys.filter(key=>(filter==='all'||filter===key)&&`${key} ${LEARN_CONTENT[key].title} ${LEARN_CONTENT[key].what_it_is}`.toLowerCase().includes(q));
 const terms=c.glossary.filter(term=>(filter==='all'||filter===term.related)&&`${term.title} ${term.text}`.toLowerCase().includes(q));
 return <section className="hc-library" aria-label={c.learn}><h3><BookOpen size={20}/>{c.learn}</h3>
 <label className="hc-search"><Search size={17}/><span className="halo-sr-only">{c.search}</span><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder={c.search}/></label>
 <label className="hc-filter"><span>{c.all}</span><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">{c.all}</option>{factorKeys.map(key=><option key={key} value={key}>{LEARN_CONTENT[key].title}</option>)}</select></label>
 {query&&<button className="hp-text" onClick={()=>setQuery('')}>{c.clear}</button>}
 {scenario==='error'?<div role="status"><p>{c.catalogUnavailable}</p><button className="hp-text" onClick={()=>setScenario('ready')}>{c.catalogRetry}</button></div>:scenario==='loading'?<p role="status">{c.pending}</p>:scenario==='empty'?<p>{c.emptyLibrary}</p>:<>
 {!topics.length&&!terms.length&&<p role="status">{c.none}</p>}
 {topics.map(key=><details key={key} className="hc-topic" open={selected===key} onToggle={e=>{if(e.currentTarget.open)setSelected(key);else if(selected===key)setSelected(null);}}><summary>{LEARN_CONTENT[key].title}</summary><p>{clean(LEARN_CONTENT[key].what_it_is)}</p>{factorHref&&<Link className="hp-link-row" href={factorHref(key)}><span>{c.openGuide}</span><ArrowUpRight size={16}/></Link>}<h4>{c.sources}</h4>{LEARN_CONTENT[key].sources.map((source:{url:string;label:string;retrieved:string})=><div className="hc-source" key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{clean(source.label)}<ArrowUpRight size={14}/></a><small>{c.checked}: {source.retrieved}</small></div>)}<small>{c.sourceLimit}</small></details>)}
 {terms.length>0&&<h4>{c.terms}</h4>}{terms.map(term=><details className="hc-topic" key={term.id}><summary>{term.title}</summary><p>{term.text}</p>{factorHref&&<Link className="hp-text" href={factorHref(term.related)}>{c.openGuide}<ArrowUpRight size={16}/></Link>}</details>)}
 </> }</section>;
}
