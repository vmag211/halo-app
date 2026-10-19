import type {HouseholdReport} from '../household-pdf';
import type {SummarySelection} from '../home-maintenance-preview';
export type SummaryArchive = {id:string;revision:number;title:string;createdAt:string;homeContextId:string|null};
export type SummarySnapshot = SummaryArchive & {report:HouseholdReport;selection:SummarySelection;manifest:{kind:string;id:string;revision:string|number;asOf:string|null}[];omissions:string[]};
export type SummaryList = {items:SummaryArchive[];complete:boolean;unresolvedOperations:string[]};
export type SummaryReceipt = {operationId:string;status:'succeeded'|'pending'|'unknown'|'failed';snapshot?:SummarySnapshot;message?:string};
const object=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const text=(x:unknown):x is string=>typeof x==='string'&&x.length<=30000;
const strings=(x:unknown):x is string[]=>Array.isArray(x)&&x.length<=5000&&x.every(text);
const archive=(x:unknown):x is SummaryArchive=>object(x)&&text(x.id)&&!!x.id&&Number.isSafeInteger(x.revision)&&Number(x.revision)>0&&text(x.title)&&text(x.createdAt)&&Number.isFinite(Date.parse(x.createdAt))&&(x.homeContextId===null||text(x.homeContextId));
export function validSummarySnapshot(x:unknown):x is SummarySnapshot {
 if(!archive(x))return false;const value=x as unknown as Record<string,unknown>,report=value.report,selection=value.selection;
 return object(report)&&text(report.title)&&text(report.generated)&&strings(report.introduction)&&Array.isArray(report.sections)&&report.sections.length<=50&&report.sections.every(section=>object(section)&&text(section.title)&&strings(section.lines))&&object(selection)&&text(selection.purpose)&&text(selection.start)&&text(selection.end)&&object(selection.sections)&&['scores','factors','tests','actions','maintenance','observations','gardens'].every(key=>typeof (selection.sections as Record<string,unknown>)[key]==='boolean')&&['categories','location','notes','attachments','appendix'].every(key=>typeof selection[key]==='boolean')&&strings(selection.excluded)&&strings(value.omissions)&&Array.isArray(value.manifest)&&value.manifest.every(row=>object(row)&&text(row.kind)&&text(row.id)&&(text(row.revision)||Number.isSafeInteger(row.revision))&&(row.asOf===null||text(row.asOf)));
}
export function validSummaryList(x:unknown):x is SummaryList{return object(x)&&Array.isArray(x.items)&&x.items.every(archive)&&typeof x.complete==='boolean'&&strings(x.unresolvedOperations);}
export function validSummaryReceipt(x:unknown,id:string):x is SummaryReceipt{return object(x)&&x.operationId===id&&['succeeded','pending','unknown','failed'].includes(String(x.status))&&(x.status!=='succeeded'||validSummarySnapshot(x.snapshot));}
