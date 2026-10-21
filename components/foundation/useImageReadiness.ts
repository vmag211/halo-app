'use client';

import {useEffect,useRef,useState} from 'react';

/** Load/error events can precede hydration. Observe the node and its settled state. */
export function useImageReadiness(source:string){
 const ref=useRef<HTMLImageElement>(null);
 const [settled,setSettled]=useState<{source:string;image:HTMLImageElement;failed:boolean}|null>(null);
 useEffect(()=>{
  const image=ref.current;if(!image)return;
  let active=true;
  const check=()=>{if(active&&image.complete)setSettled(old=>old?.source===source&&old.image===image&&old.failed===(image.naturalWidth===0)?old:{source,image,failed:image.naturalWidth===0});};
  image.addEventListener('load',check);image.addEventListener('error',check);
  // Catch cached and server-rendered images without treating a pending lazy image as failed.
  queueMicrotask(check);
  return()=>{active=false;image.removeEventListener('load',check);image.removeEventListener('error',check);};
 },[source]);
 const current=settled?.source===source?settled:null;
 return {ref,loaded:Boolean(current&&!current.failed),failed:Boolean(current?.failed),image:current&&!current.failed?current.image:null};
}
