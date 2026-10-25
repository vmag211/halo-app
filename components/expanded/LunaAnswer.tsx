import {BookOpen,Compass,Sparkles} from 'lucide-react';
import type {LunaMessage} from '@/lib/frontend/production/luna-service';

const clean=(value:string)=>value.replace(/[^\S\n]*\u2014[^\S\n]*/g,', ');
const labels={fact:'From the source',interpretation:'Luna’s interpretation','next-step':'Suggested next step'};
const icons={fact:BookOpen,interpretation:Sparkles,'next-step':Compass};

/** Only server-qualified evidence is presented as source findings. Legacy answers stay unqualified. */
export default function LunaAnswer({message}:{message:LunaMessage}){
 return <div className="lc-answer">
  {message.text&&<p>{clean(message.text)}</p>}
  {message.evidence?.map((block,index)=>{const Icon=icons[block.kind];return <section className={`lc-evidence lc-evidence--${block.kind}`} key={index} aria-label={labels[block.kind]}>
   <h3><Icon size={15} aria-hidden="true"/>{labels[block.kind]}</h3><p>{clean(block.text)}</p>
   {(block.scope||block.observedAt)&&<small>{block.scope&&clean(block.scope)}{block.scope&&block.observedAt?' · ':''}{block.observedAt&&<time dateTime={block.observedAt}>Source date: {new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeZone:'UTC'}).format(new Date(block.observedAt))} (UTC)</time>}</small>}
   {block.sourceIndexes.length>0&&<ul className="lc-evidence-citations" aria-label="Sources for this statement">{block.sourceIndexes.map(sourceIndex=>{const source=message.sources![sourceIndex];return <li key={sourceIndex}><a href={source.url} target="_blank" rel="noreferrer">{clean(source.title)}</a></li>;})}</ul>}
  </section>;})}
  {!message.evidence&&!!message.sources?.length&&<details className="lc-sources"><summary>Sources and scope</summary><small>Listed sources are not linked to individual statements in this answer.</small>{message.sources.map(source=><a key={source.url} href={source.url} target="_blank" rel="noreferrer">{clean(source.title)}</a>)}</details>}
 </div>;
}
