/** Only an explicitly configured production origin may identify the public homepage. */
export function publicOrigin(value:string|undefined):string|null{
 if(!value)return null;
 try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/'&&url.hostname!=='localhost'&&!url.hostname.endsWith('.localhost')&&!/^\d+(?:\.\d+){3}$/.test(url.hostname)&&!url.hostname.includes(':')?url.origin:null;}catch{return null;}
}
