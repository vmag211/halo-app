import {notificationKinds,type AlertItem} from '../settings-preview';
import {validActionDate} from '../expanded-preview';
export type AlertSnapshot={items:AlertItem[];unresolvedOperations:string[]};
export type AlertReceipt=AlertSnapshot&{operationId:string;status:'succeeded'|'pending'|'unknown'|'failed'|'cancelled'};
const destinations:Record<string,string[]>={home:['tests','maintenance','food','summary'],plan:['journal','patterns','recap','outdoors','reminders'],today:[]};
const factors=['air','uv','pollen','mold','pfas','radon','lead'];
function source(value:AlertItem['source']){if(!value)return true;try{const url=new URL(value.url);return typeof value.title==='string'&&!!value.title&&url.protocol==='https:'&&!url.username&&!url.password;}catch{return false;}}
export function validAlertSnapshot(value:unknown):value is AlertSnapshot{
 const v=value as AlertSnapshot;
 return !!v&&Array.isArray(v.unresolvedOperations)&&v.unresolvedOperations.every(id=>typeof id==='string'&&!!id)&&Array.isArray(v.items)&&new Set(v.items.map(item=>item?.id)).size===v.items.length&&v.items.every(item=>item&&typeof item.id==='string'&&!!item.id&&Number.isSafeInteger(item.revision)&&item.revision>0&&typeof item.title==='string'&&!!item.title&&typeof item.body==='string'&&['Home','Your week','Conditions'].includes(item.category)&&!!item.date&&validActionDate(item.date)&&typeof item.read==='boolean'&&typeof item.dismissed==='boolean'&&[...notificationKinds,'app'].includes(item.kind)&&item.target&&Object.hasOwn(destinations,item.target.tab)&&(!item.target.destination||destinations[item.target.tab].includes(item.target.destination))&&(!item.target.learn||factors.includes(item.target.learn))&&source(item.source));
}
/** A saved inbox must prove the exact reviewed patch, not only return valid rows. */
export function alertReceiptCovers(value:AlertSnapshot,selected:Pick<AlertItem,'id'|'revision'>[],patch:{read?:boolean;dismissed?:boolean}){
 return selected.length>0&&selected.every(previous=>{const next=value.items.find(item=>item.id===previous.id);return !!next&&next.revision>previous.revision&&(patch.read===undefined||next.read===patch.read)&&(patch.dismissed===undefined||next.dismissed===patch.dismissed);});
}
