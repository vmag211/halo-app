/** Isolated frontend contract examples. No provider or identity authority. */
export const capabilityStates=['unavailable','available','verified','denied','expired','error','conflict','unsupported','collision','no-match','unknown'] as const;
export type CapabilityState=typeof capabilityStates[number];
export type HomeTransition={id:string;title:string;revision:number;previousId:string;area:string;portableIds:string[];confirmedAt:string;readings:'unavailable';previousProfile?:{year:string;water:string;tenure:string}};
export const currentHomeId=(rows:HomeTransition[])=>rows.at(-1)?.id??'sample-current-home';
export function validRecoveryEmail(value:string){return value.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);}
export function validArea(value:string){const area=value.trim();return area.length>=2&&area.length<=100&&!/[<>\n\r]/.test(area)&&(/^\d{5}$/.test(area)||/\p{L}/u.test(area));}
export function maskedEmail(value:string){const [name,host]=value.split('@');return host?`${name.slice(0,1)}•••@${host}`:'';}
export function eligiblePortable(origin:string){return ['personal','manual','custom','my week','plan','week'].includes(origin.toLowerCase());}
