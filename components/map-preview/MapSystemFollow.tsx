'use client';
import { useState } from 'react';
import { Bell, Check } from 'lucide-react';
import { useHomeDraft,useHomeWorkspace } from '@/components/homeguard/HomeWorkspaceState';
import { mapComparisonCopy as c } from '@/lib/frontend/copy/map-comparison';
type Follow={id:string;kind:number;label:string;publicRecordId?:string};
export default function MapSystemFollow({id,name,offline}:{id:string;name:string;offline:boolean}){
  const workspace=useHomeWorkspace();
  const [follows,setFollows]=useHomeDraft<Follow[]>('settings:follows',[]);
  const [message,setMessage]=useState('');
  const matches=(item:Follow)=>item.publicRecordId===id||item.kind===0&&item.label.toLocaleLowerCase()===name.toLocaleLowerCase();
  const followed=follows.some(matches);
  function toggle(){
    if(offline||!navigator.onLine||workspace.pending||['loading','error','offline','save-error','conflict'].includes(workspace.scenario)){setMessage(c.followFailed);return;}
    setFollows(previous=>followed?previous.filter(item=>!matches(item)):previous.some(matches)?previous:[...previous,{id:`map:utility:${id}`,kind:0,label:name,publicRecordId:id}]);
    setMessage(followed?c.unfollowed:c.followed);
  }
  return <div className="halo-map-system-follow"><button aria-pressed={followed} onClick={toggle}>{followed?<Check size={17}/>:<Bell size={17}/>} {followed?c.stopFollow:c.follow}</button><p>{followed?c.following+'. ':''}{c.followHint}</p>{message&&<p role="status">{message}</p>}</div>;
}
