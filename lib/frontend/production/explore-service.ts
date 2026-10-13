import type { ProjectGuide } from '../explore-project-guides';
import type { ProjectGenerationState, ProjectConstraints, ProjectEvidence } from '../explore-personalization';
import type { CommunityOpportunity } from '../explore-opportunities';
import type { LocalParticipationResource } from '../explore-local-resources';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 10000): value is string => typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const strings = (value: unknown, max = 100): value is string[] => Array.isArray(value) && value.length <= max && value.every(item => text(item));
export function safeSourceUrl(value: unknown): value is string { if (!text(value, 3000)) return false; try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; } }
const member = (value: unknown, values: readonly string[]) => typeof value === 'string' && values.includes(value);
export function validProjectConstraints(value: unknown): value is ProjectConstraints {
  return object(value) && member(value.space,['any','indoors','balcony','yard','community']) && member(value.mode,['any','solo','group']) && member(value.time,['any','quick','half-day','ongoing']) && member(value.budget,['any','reuse','low']) && typeof value.count==='number'&&[3,5,10,11,12,13,14,15].includes(value.count);
}
export type ProductionProjectGuide = Omit<ProjectGuide,'steps'> & { steps: (ProjectGuide['steps'][number] & { id: string })[] };
export function validProjectGuide(value: unknown): value is ProductionProjectGuide {
  if (!object(value) || !['id','version','title','description','purpose','effort','cost','scope','suitability','completion','followup'].every(key => text(value[key]) && value[key] !== '') || !member(value.cause,['Water','Habitats','Community','Energy','Air']) || !member(value.scene,['river','trail','garden','bee','tree','soil','water','compost','food','moisture','solar','cleanup']) || !member(value.icon,['plant','bee','cleanup','sun','water','air']) || !strings(value.materials) || !strings(value.constraints) || !value.constraints.length) return false;
  if (!Array.isArray(value.sources) || !value.sources.length || value.sources.length > 40 || !value.sources.every(source => object(source) && ['id','title','publisher','checked'].every(key => text(source[key]) && source[key] !== '') && safeSourceUrl(source.url))) return false;
  const sources = new Set(value.sources.map(source => source.id));
  if (!Array.isArray(value.steps) || !value.steps.length || value.steps.length > 100 || !value.steps.every(step => object(step) && text(step.id,200) && step.id && text(step.title,500) && strings(step.instructions,40) && step.instructions.length && text(step.checkpoint) && strings(step.sourceIds,40) && step.sourceIds.length && step.sourceIds.every(id => sources.has(id))) || new Set(value.steps.map(step => step.id)).size !== value.steps.length) return false;
  if (value.buildPlan !== undefined) {
    const plan=value.buildPlan;
    if (!object(plan) || !text(plan.title) || !text(plan.note) || !text(plan.sourceId) || !sources.has(plan.sourceId) || !strings(plan.assembly) || !Array.isArray(plan.parts) || plan.parts.length>100 || !plan.parts.every(part => object(part) && text(part.name) && text(part.size) && typeof part.quantity === 'number' && Number.isFinite(part.quantity) && part.quantity>0)) return false;
  }
  return true;
}
export type ProjectGenerationResult = { id: string; status: 'queued'|'retrieving'|'validating'|'preparing'|'completed'|'failed'|'cancelled'; contextKey: string; batch?: ProjectGenerationState; guides?: ProductionProjectGuide[]; evidence?: ProjectEvidence[]; message?: string;pendingStart?:{id:string;guideId:string;version:string} };
export function validProjectGeneration(value: unknown): value is ProjectGenerationResult {
  if (!object(value) || !text(value.id,200) || !value.id || !text(value.contextKey,500) || !member(value.status,['queued','retrieving','validating','preparing','completed','failed','cancelled']) || value.message!==undefined&&!text(value.message,1000)) return false;
  if(value.pendingStart!==undefined&&(!object(value.pendingStart)||!['id','guideId','version'].every(key=>text(value.pendingStart&&typeof value.pendingStart==='object'?(value.pendingStart as Record<string,unknown>)[key]:undefined,200))||!value.pendingStart.id||!value.pendingStart.guideId||!value.pendingStart.version))return false;
  if (value.status !== 'completed') return true;
  const batch=value.batch;
  if (!object(batch) || !text(batch.request,500) || !text(batch.contextKey,500) || batch.contextKey!==value.contextKey || !Number.isInteger(batch.generation) || !validProjectConstraints(batch.constraints) || !Array.isArray(batch.items) || batch.items.length>15 || !Array.isArray(value.guides) || value.guides.length>15 || !value.guides.every(validProjectGuide)) return false;
  const guides=new Map(value.guides.map(guide=>[guide.id,guide]));
  if (!batch.items.every(item=>object(item)&&['id','title','reason'].every(key=>text(item[key])&&item[key]!=='')&&guides.has(String(item.id))&&['tags','evidenceIds','sourceIds','needsCheck'].every(key=>strings(item[key]))&&member(item.fit,['context','interest','general'])))return false;
  if (new Set(batch.items.map(item=>item.id)).size!==batch.items.length)return false;
  if(value.evidence!==undefined&&(!Array.isArray(value.evidence)||value.evidence.length>60||!value.evidence.every(item=>object(item)&&['id','label','value','scope','asOf','provenance'].every(key=>text(item[key]))&&member(item.topic,['air','uv','pollen','weather','water','radon','lead','garden','moisture','filter','test'])&&typeof item.stale==='boolean'&&member(item.status,['available','unknown']))))return false;
  const evidenceIds = new Set((value.evidence as ProjectEvidence[] | undefined)?.map(item=>item.id) ?? []);
  return batch.items.every(item => (item.evidenceIds as string[]).every(id=>evidenceIds.has(id)) && (item.sourceIds as string[]).every(id=>guides.get(String(item.id))?.sources.some(source=>source.id===id)));
}
export type OpportunityResults = { items: CommunityOpportunity[]; areaLabel: string; checkedAt: string; availability: 'ready'|'empty'|'partial'|'no_coverage'|'unavailable'; nextCursor: string|null; complete: boolean };
export function validOpportunity(value: unknown): value is CommunityOpportunity {
  if (!object(value) || !['id','organizer','title','interest','area','venue','timeLabel','checkedAt','summary','duration','cost','age','access','bring','join','safety'].every(key=>text(value[key])) || !member(value.artwork,['tree','cleanup','garden']) || !member(value.kind,['scheduled','rolling']) || !member(value.status,['listed','cancelled','full','postponed']) || !safeSourceUrl(value.url) || !strings(value.work) || !strings(value.scopes))return false;
  if (value.kind==='scheduled' && (!text(value.startsAt)||!text(value.endsAt)||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value.startsAt)||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value.endsAt)||!Number.isFinite(Date.parse(value.startsAt))||Date.parse(value.endsAt)<=Date.parse(value.startsAt))) return false;
  return Number.isFinite(Date.parse(String(value.checkedAt))) && (value.address===undefined||text(value.address));
}
export function validOpportunityResults(value: unknown): value is OpportunityResults {
  return object(value)&&Array.isArray(value.items)&&value.items.length<=100&&value.items.every(validOpportunity)&&new Set(value.items.map(item=>item.id)).size===value.items.length&&text(value.areaLabel,300)&&text(value.checkedAt,100)&&member(value.availability,['ready','empty','partial','no_coverage','unavailable'])&&typeof value.complete==='boolean'&&(value.nextCursor===null||text(value.nextCursor,2000));
}

export type PublicContact = { id:string;revision:number;name:string;role:string;organization:string;email:string|null;url:string;checkedAt:string;jurisdiction:string;reason:string };
export function validContacts(value: unknown): value is { contacts:PublicContact[] } {
  return object(value)&&Array.isArray(value.contacts)&&value.contacts.length<=20&&value.contacts.every(contact=>object(contact)&&['id','name','role','organization','checkedAt','jurisdiction','reason'].every(key=>text(contact[key]))&&Number.isInteger(contact.revision)&&safeSourceUrl(contact.url)&&(contact.email===null||text(contact.email,254)&&/^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/.test(contact.email)));
}
export type OrganizationResults={items:(LocalParticipationResource&{checkedAt:string})[];complete:boolean;nextCursor:string|null};
export function validOrganizations(value:unknown):value is OrganizationResults {
 return object(value)&&Array.isArray(value.items)&&value.items.length<=100&&typeof value.complete==='boolean'&&(value.nextCursor===null||text(value.nextCursor,2000))&&value.items.every(item=>object(item)&&['id','title','organizer','area','mission','work','sourceTitle','effort','age','cost','access','bring','followup','checkedAt'].every(key=>text(item[key]))&&member(item.interest,['Cleanup','Trees & habitat','Gardening','Community learning'])&&strings(item.scopes)&&safeSourceUrl(item.url)&&['address','addressRole','contact'].every(key=>item[key]===undefined||text(item[key]))&&Array.isArray(item.steps)&&item.steps.length<=30&&item.steps.every(step=>object(step)&&text(step.title)&&text(step.text))&&(item.extraSources===undefined||Array.isArray(item.extraSources)&&item.extraSources.length<=20&&item.extraSources.every(source=>object(source)&&text(source.title)&&safeSourceUrl(source.url))));
}
export type DiscoveryPlace={id:string;place:string;state:string;label:string;timezone:string};
export function validPlaces(value:unknown):value is {candidates:DiscoveryPlace[]}{return object(value)&&Array.isArray(value.candidates)&&value.candidates.length<=20&&value.candidates.every(place=>object(place)&&['id','place','state','label','timezone'].every(key=>text(place[key],300))&&!!place.id);}
export type DiscoveryArea={place:DiscoveryPlace|null;revision:number;pendingOperation?:{id:string;place:DiscoveryPlace|null}};
export function validDiscoveryArea(value:unknown):value is DiscoveryArea{return object(value)&&Number.isSafeInteger(value.revision)&&Number(value.revision)>0&&(value.place===null||validPlaces({candidates:[value.place]}))&&(value.pendingOperation===undefined||object(value.pendingOperation)&&text(value.pendingOperation.id,200)&&!!value.pendingOperation.id&&(value.pendingOperation.place===null||validPlaces({candidates:[value.pendingOperation.place]})));}
