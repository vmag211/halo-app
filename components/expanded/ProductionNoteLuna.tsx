'use client';
import {useState} from 'react';
import LunaMark from '@/components/foundation/LunaMark';
import {useProductionResource} from '@/components/production/ProductionContext';
import {validLunaCapabilities} from '@/lib/frontend/production/luna-service';
import {lunaCapabilityCopy as copy} from '@/lib/frontend/copy/luna-capability';
import type {FieldNote} from '@/lib/frontend/explore-preview';
// A note is household data, and production Luna never receives it (B09 decision 2; the message
// route validates `noteContext` and then ignores it). So this handoff offers no field selection and
// no consent step: accepting a selection Luna would silently drop is the failure it exists to prevent.
// It says so before anything is chosen, and offers only a general question with nothing attached.
export default function ProductionNoteLuna({record}:{record:FieldNote}){
 const [open,setOpen]=useState(false);
 const capabilities=useProductionResource<unknown>('luna.capabilities',{},open);
 const caps=validLunaCapabilities(capabilities.data)?capabilities.data:null;
 return <details className="ex-disclosure ex-luna-context" data-note={record.id} onToggle={event=>setOpen(event.currentTarget.open)}><summary><LunaMark size={23}/>Luna and this note</summary><p className="ex-meta">HALO and Luna are not emergency reporting channels.</p><p>{copy.noteUnavailable}</p><p className="ex-meta">{copy.answersOnly} {copy.selfServe}</p>{!open?null:capabilities.loading?<p className="ex-meta" role="status">{copy.checking}</p>:caps?.available?<button className="ex-button" onClick={()=>window.dispatchEvent(new Event('halo:luna-open'))}>{copy.noteAsk}</button>:<p className="ex-meta" role="status">{copy.unavailable}{capabilities.error&&<> <button className="ex-text-button" onClick={capabilities.retry}>Try again</button></>}</p>}</details>;
}
