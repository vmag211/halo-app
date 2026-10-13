'use client';
import { useState } from 'react';
import { Copy, Download, Share2 } from 'lucide-react';
import { publicDistrictBrief, publicDistrictExport } from '@/lib/frontend/map-public-brief';
import type { DistrictPreviewData } from '@/lib/frontend/map-district-preview';
import { mapComparisonCopy as c } from '@/lib/frontend/copy/map-comparison';

export default function MapPublicBrief({data}:{data:DistrictPreviewData}) {
  const [message,setMessage]=useState(''),[pending,setPending]=useState(false);
  const text=publicDistrictBrief(data);
  async function copy(){try{await navigator.clipboard.writeText(text);setMessage(c.copied);}catch{setMessage(c.copyFailed);}}
  async function share(){setPending(true);try{if(!navigator.share){setMessage(c.shareFailed);return;}await navigator.share({title:c.publicBrief,text});setMessage(c.shared);}catch(error){setMessage(error instanceof Error&&error.name==='AbortError'?c.shareCancelled:c.shareFailed);}finally{setPending(false);}}
  function download(){let url:string|null=null;try{url=URL.createObjectURL(new Blob([JSON.stringify(publicDistrictExport(data),null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='halo-public-district.json';document.body.append(link);link.click();link.remove();setMessage(c.downloaded);}catch{setMessage(c.downloadFailed);}finally{if(url){const created=url;setTimeout(()=>URL.revokeObjectURL(created),1000);}}}
  return <details className="halo-map-public-brief"><summary>{c.publicBrief}</summary><p>{c.briefHint}</p><label>{c.briefPreview}<textarea readOnly value={text} rows={8}/></label><div><button onClick={copy} disabled={pending}><Copy size={17}/>{c.copyBrief}</button><button onClick={download} disabled={pending}><Download size={17}/>{c.downloadBrief}</button><button onClick={share} disabled={pending}><Share2 size={17}/>{pending?c.busy:c.shareBrief}</button></div>{message&&<p role="status">{message}</p>}</details>;
}
