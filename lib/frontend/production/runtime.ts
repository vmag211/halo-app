/** Production frontend boundary. No provider keys, review fixtures or automatic write retries. */
import {readSwitchedOff,type FeatureFlags} from './features';
export type RequestOptions = { signal?: AbortSignal; idempotencyKey?: string; expectedRevision?: string | number; responseType?: 'json'|'blob' };
export type Capability = { enabled: boolean; reason?: string };
export interface ProductionRuntime {
  readonly scopeKey: string;
  readonly identityId: string | null;
  readonly homeContextId: string | null;
  readonly capabilities: Readonly<Record<string, Capability>>;
  request<T>(operation: string, input?: unknown, options?: RequestOptions): Promise<T>;
}
export type FailureCode = 'offline' | 'session' | 'permission' | 'conflict' | 'validation' | 'rate_limited' | 'unavailable' | 'invalid_response' | 'aborted' | 'unknown_outcome';
export class FrontendServiceError extends Error {
  constructor(public readonly code: FailureCode, message: string, public readonly operationId?: string, public readonly retryAfter?: number, public readonly fields?: Record<string,string>, public readonly reason?: 'feature_unavailable') { super(message); this.name = 'FrontendServiceError'; }
}
type Endpoint = { path: string; method?: 'GET'|'POST'|'PATCH'|'DELETE'; public?: boolean };
/** These are explicit frontend contracts, not claims that the backend implements them. */
export const productionOperations: Readonly<Record<string, Endpoint>> = {
  'capabilities.read': {path:'/api/capabilities'},
  'features.read': {path:'/api/frontend/capabilities'},
  'sourceOps.read': {path:'/api/operator/sources'},
  'sourceOps.history': {path:'/api/operator/sources/history'},
  'sourceOps.command': {path:'/api/operator/sources/commands',method:'POST'},
  'workspace.load': {path:'/api/frontend/workspace'},
  'workspace.execute': {path:'/api/frontend/workspace/commands',method:'POST'},
  'attachments.upload': {path:'/api/attachments',method:'POST'},
  'attachments.inspect': {path:'/api/attachments/inspect'},
  'attachments.download': {path:'/api/attachments/download'},
  'attachments.remove': {path:'/api/attachments/remove',method:'POST'},
  'operations.read': {path:'/api/operations'},
  'actions.load': {path:'/api/frontend/actions'},
  'actions.commit': {path:'/api/frontend/actions/commands',method:'POST'},
  'week.changes': {path:'/api/week/changes'},
  'week.acknowledge': {path:'/api/week/changes/acknowledge',method:'POST'},
  'settings.read': {path:'/api/settings'},
  'settings.save': {path:'/api/settings',method:'PATCH'},
  'alerts.read': {path:'/api/alerts'},
  'alerts.update': {path:'/api/alerts/state',method:'POST'},
  'projects.generate': {path:'/api/projects/generations',method:'POST'},
  'projects.current': {path:'/api/projects/generations/current'},
  'projects.guide': {path:'/api/projects/guides/detail'},
  'projects.start': {path:'/api/projects/start',method:'POST'},
  'projects.generation': {path:'/api/projects/generations/status'},
  'projects.cancel': {path:'/api/projects/generations/cancel',method:'POST'},
  'opportunities.search': {path:'/api/opportunities'},
  'opportunities.detail': {path:'/api/opportunities/detail'},
  'organizations.search': {path:'/api/explore/organizations'},
  'explore.area.save': {path:'/api/explore/area',method:'PATCH'},
  'explore.area.read': {path:'/api/explore/area'},
  'locations.search': {path:'/api/locations/search'},
  'community.read': {path:'/api/community'},
  'contacts.resolve': {path:'/api/outreach/contacts',method:'POST'},
  'outreach.send': {path:'/api/outreach/messages',method:'POST'},
  'outreach.context': {path:'/api/outreach/context'},
  'outreach.connection': {path:'/api/outreach/connection'},
  'outreach.connect': {path:'/api/outreach/connect',method:'POST'},
  'outreach.prepare': {path:'/api/outreach/messages/prepare',method:'POST'},
  'outreach.history': {path:'/api/outreach/messages'},
  'outreach.status': {path:'/api/outreach/messages/status'},
  'luna.conversations': {path:'/api/luna/conversations'},
  'luna.capabilities': {path:'/api/luna/capabilities'},
  'luna.proposal.edit': {path:'/api/luna/proposals/edit',method:'POST'},
  'luna.proposal.cancel': {path:'/api/luna/proposals/cancel',method:'POST'},
  'luna.operation': {path:'/api/luna/operations'},
  'luna.clear': {path:'/api/luna/conversations/clear',method:'POST'},
  'luna.message': {path:'/api/luna/messages',method:'POST'},
  'luna.run': {path:'/api/luna/runs/status'},
  'luna.cancel': {path:'/api/luna/runs/cancel',method:'POST'},
  'luna.confirm': {path:'/api/luna/tools/confirm',method:'POST'},
  'map.layer': {path:'/api/map',public:true},
  'map.comparison': {path:'/api/map/comparison',public:true},
  'map.district': {path:'/api/district',public:true},
  'map.brief': {path:'/api/map/brief',public:true},
  'forecast.read': {path:'/api/forecast'},
  'evidence.read': {path:'/api/evidence'},
  'summary.prepare': {path:'/api/summaries',method:'POST'},
  'summary.list': {path:'/api/summaries'},
  'summary.read': {path:'/api/summaries/detail'},
  'food.search': {path:'/api/food/evidence'},
  'fish.read': {path:'/api/fish/advisories'},
  'water.read': {path:'/api/water/notices'},
  'growers.search': {path:'/api/growers'},
  'account.read': {path:'/api/account'},
  'account.command': {path:'/api/account/commands',method:'POST'},
  'recovery.request': {path:'/api/recovery/request',method:'POST',public:true},
  'recovery.status': {path:'/api/recovery/status',method:'POST',public:true},
  'recovery.complete': {path:'/api/recovery/complete',method:'POST',public:true},
  'privacy.status': {path:'/api/privacy/status'},
  'privacy.inspect': {path:'/api/privacy/export/inspect',method:'POST'},
  'privacy.export': {path:'/api/privacy/exports',method:'POST'},
  'privacy.clear': {path:'/api/privacy/clear',method:'POST'},
};
const messages: Record<FailureCode,string> = {
  offline:'You are offline. Your changes are still here.', session:'Please reconnect your session to continue.',
  permission:'This action is not available for this account.', conflict:'This item changed. Review the latest version before saving.',
  validation:'Check the highlighted information and try again.', rate_limited:'Please wait before trying again.',
  unavailable:'This service is unavailable. Try again later.', invalid_response:'The service returned incomplete information. Please retry.',
  aborted:'Request cancelled.', unknown_outcome:'The result is not confirmed. Check its status before trying again.',
};
export function serviceMessage(error: unknown): string { return error instanceof FrontendServiceError ? error.message : messages.unavailable; }
export function createProductionRuntime(input: {
  identityId: string | null; homeContextId: string | null; contextRevision?: number;
  capabilities?: Record<string,Capability>; publicAccess?: boolean;
  /** Switched-on capabilities from `features.read`; null or absent means unknown, so every read is sent. */
  features?: FeatureFlags | null;
  credential: () => Promise<{identityId:string;accessToken:string}|null>;
  fetcher?: typeof fetch; active?: () => boolean; writeAllowed?: () => boolean; timeoutMs?: number;
}): ProductionRuntime {
  const scopeKey = `${input.identityId ?? 'public'}:${input.homeContextId ?? 'none'}:${input.contextRevision ?? 0}`;
  return { scopeKey, identityId:input.identityId, homeContextId:input.homeContextId, capabilities:input.capabilities ?? {},
    async request<T>(operation: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
      const endpoint = productionOperations[operation];
      if (!endpoint || input.publicAccess && !endpoint.public) throw new FrontendServiceError('permission',messages.permission);
      if (input.capabilities?.[operation]?.enabled === false) throw new FrontendServiceError('unavailable', messages.unavailable);
      // A read whose capability is known to be off gets the same settled answer the server would send, without the request.
      if ((endpoint.method ?? 'GET') === 'GET' && readSwitchedOff(operation, input.features)) throw new FrontendServiceError('unavailable', messages.unavailable, undefined, undefined, undefined, 'feature_unavailable');
      const method = endpoint.method ?? 'GET', mutation = method !== 'GET';
      const operationId = mutation ? options.idempotencyKey ?? crypto.randomUUID() : undefined;
      const controller = new AbortController(); let sent = false;
      const abort = () => controller.abort(); options.signal?.addEventListener('abort',abort,{once:true});
      if(options.signal?.aborted) controller.abort();
      const timeout = setTimeout(abort,input.timeoutMs ?? 20_000);
      const bounded = <V,>(work:Promise<V>) => new Promise<V>((resolve,reject)=>{const stop=()=>reject(new DOMException('Request ended','AbortError'));controller.signal.addEventListener('abort',stop,{once:true});if(controller.signal.aborted)stop();work.then(resolve,reject).finally(()=>controller.signal.removeEventListener('abort',stop));});
      const current = () => { if(input.active?.() === false) throw new FrontendServiceError('session',messages.session,operationId); if(controller.signal.aborted) throw new FrontendServiceError(sent && mutation ? 'unknown_outcome':'aborted',messages[sent && mutation ? 'unknown_outcome':'aborted'],operationId); };
      try {
        current();
        if(mutation&&input.writeAllowed?.()===false)throw new FrontendServiceError('permission','Reconnect your profile before making changes.');
        const credential = input.publicAccess ? null : await bounded(input.credential()); current();
        if(!input.publicAccess && (!credential || credential.identityId !== input.identityId)) throw new FrontendServiceError('session',messages.session,operationId);
        let path = endpoint.path;
        if(!mutation && body && typeof body==='object') {
          const query = new URLSearchParams();
          for(const [key,value] of Object.entries(body)) if(value !== undefined && value !== null) query.set(key,typeof value==='object'?JSON.stringify(value):String(value));
          if(query.size) path += `?${query}`;
        }
        const headers: Record<string,string> = {Accept:'application/json'};
        if(credential) headers.Authorization = `Bearer ${credential.accessToken}`;
        if(input.homeContextId && !input.publicAccess) headers['X-Halo-Home-Context'] = input.homeContextId;
        // Never a standard If-Match: Vercel's edge turns a committed 2xx into its own 412 (lib/ifMatch.js).
        if(options.expectedRevision !== undefined) headers['X-Halo-If-Match'] = String(options.expectedRevision);
        if(operationId) headers['Idempotency-Key'] = operationId;
        const multipart=typeof FormData!=='undefined'&&body instanceof FormData;
        if(mutation&&!multipart) headers['Content-Type']='application/json';
        if(mutation&&input.writeAllowed?.()===false)throw new FrontendServiceError('permission','Reconnect your profile before making changes.');
        sent = true;
        const response = await bounded((input.fetcher ?? fetch)(path,{method,headers,body:mutation?(multipart?body as FormData:JSON.stringify(body ?? {})):undefined,signal:controller.signal,cache:'no-store',credentials:'same-origin',redirect:'error'}));
        current();
        if(response.ok&&options.responseType==='blob') {const blob=await bounded(response.blob());current();if(!['application/pdf','image/jpeg','image/png','image/webp','application/json','text/csv'].includes(blob.type)||blob.size>25*1024*1024)throw new FrontendServiceError('invalid_response',messages.invalid_response);return blob as T;}
        const json: unknown = await bounded(response.json().catch(()=>null)); current();
        if(!response.ok) {
          const code:FailureCode = response.status===401?'session':response.status===403?'permission':response.status===409||response.status===412?'conflict':response.status===400||response.status===422?'validation':response.status===429?'rate_limited':response.status>=500&&mutation?'unknown_outcome':'unavailable';
          const retry=Number(response.headers.get('Retry-After'));
          // A read refused because its capability is switched off (503 feature_unavailable) is a settled
          // answer, not an outage: mark it so screens can say "not available yet" instead of offering a retry.
          // Mutations keep their existing outcome authority.
          const off=!mutation&&response.status===503&&!!json&&typeof json==='object'&&(json as {code?:unknown}).code==='feature_unavailable';
          throw new FrontendServiceError(code,messages[code],operationId,Number.isFinite(retry)&&retry>0?retry:undefined,undefined,off?'feature_unavailable':undefined);
        }
        if(json===null || typeof json!=='object') throw new FrontendServiceError(mutation?'unknown_outcome':'invalid_response',messages[mutation?'unknown_outcome':'invalid_response'],operationId);
        // The response envelope is unwrapped once. Domain adapters validate its canonical schema.
        if(Object.hasOwn(json,'data')) {
          const envelope=json as {data:unknown;meta?:unknown};
          return (envelope.data && typeof envelope.data==='object' && !Array.isArray(envelope.data) && envelope.meta ? {...envelope.data,_meta:envelope.meta} : envelope.data) as T;
        }
        return json as T;
      } catch(error) {
        if(error instanceof FrontendServiceError) throw error;
        const code:FailureCode=sent&&mutation?'unknown_outcome':controller.signal.aborted?'aborted':typeof navigator!=='undefined'&&!navigator.onLine?'offline':'unavailable';
        throw new FrontendServiceError(code,messages[code],operationId);
      } finally { clearTimeout(timeout); options.signal?.removeEventListener('abort',abort); }
    }
  };
}
