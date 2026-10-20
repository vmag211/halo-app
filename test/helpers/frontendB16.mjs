/**
 * What the Explore project screens do with the project service, TRANSCRIBED
 * from this tree: TypeScript to JavaScript with the types removed and React
 * state turned into plain fields, nothing else changed. The runtime and the
 * validators are NOT transcribed: test/routesProjectsDb.test.mjs loads the
 * real lib/frontend/production/runtime.ts and explore-service.ts through
 * test/frontend-test-loader.mjs.
 *
 * - `components/production/ProductionContext.tsx:8-19` useProductionResource,
 *   as one awaited read (`load`);
 * - `components/expanded/ProductionProjectGeneration.tsx:22-30` (commit and the
 *   saved-result effect), `:32-52` (regenerate, with its poll; the 1,500 ms
 *   wait is a parameter here so a test need not sleep), `:55` (cancel) and
 *   `:56` (retry);
 * - `components/expanded/ExploreProjects.tsx:50-58` (startProject, the
 *   production branch; `workspace.applyCanonical` is recorded, not applied).
 *
 * `FRAGMENTS` lists text that must occur character for character both in the
 * frontend file and in this file; the drift test reads both, so a change to
 * any of those lines fails it.
 */
import { loadFrontend } from '../frontend-test-loader.mjs';

const { FrontendServiceError, serviceMessage } = await loadFrontend('production/runtime');
const { validProjectGeneration, validProjectGuide } = await loadFrontend('production/explore-service');
const { defaultProjectConstraints } = await loadFrontend('explore-personalization');
const { validProductionRecord, validProductionCollection } = await loadFrontend('production/home-records');

const GENERATION = 'components/expanded/ProductionProjectGeneration.tsx';
const PROJECTS = 'components/expanded/ExploreProjects.tsx';
export const FRAGMENTS = Object.freeze([
  { file: GENERATION, text: "if(result.contextKey!==contextKey||!result.batch||!result.guides)return false;" },
  { file: GENERATION, text: "if(saved.data.pendingStart)setters.current.setStartAttempt(saved.data.pendingStart);if(saved.data.status==='completed')commitRef.current(saved.data);else if(!['failed','cancelled'].includes(saved.data.status))setters.current.setPending({id:saved.data.id,jobId:saved.data.id,constraints:defaultProjectConstraints,request:'',interpret:false});" },
  { file: GENERATION, text: "retry?await runtime.request('projects.generation',{id:attempt.jobId??attempt.id},{signal:controller.signal}):await runtime.request('projects.generate',{contextKey,constraints:attempt.constraints,request:attempt.request,interpret:attempt.interpret,previousIdeaIds:" },
  { file: GENERATION, text: "{idempotencyKey:id,signal:controller.signal});" },
  { file: GENERATION, text: "if(result.status==='completed'){if(!commitRef.current(result))throw new Error('invalid result');setPending(null);setMessage(`${result.batch" },
  { file: GENERATION, text: ".items.length} ideas ready.`);last.current=null;done?.();return;}" },
  { file: GENERATION, text: "if(result.status==='failed'||result.status==='cancelled'){setPending(null);setMessage(result.message||'Could not generate ideas. Your current set is kept.');return;}" },
  { file: GENERATION, text: "result=await runtime.request('projects.generation',{id:jobId.current},{signal:controller.signal});" },
  { file: GENERATION, text: "catch(error){if(!controller.signal.aborted&&captured===version.current){if(error instanceof FrontendServiceError&&error.code!=='unknown_outcome'&&!jobId.current)setPending(null);setMessage(serviceMessage(error));}}" },
  { file: GENERATION, text: "('projects.cancel',{id},{idempotencyKey:`cancel:${id}`}).then(result=>{if(!validProjectGeneration(result)||!['completed','cancelled','failed'].includes(result.status))throw new Error('unconfirmed');if(result.status==='completed')commitRef.current(result);setPending(null);setMessage(result.status==='completed'?'Ideas were ready before cancellation.':'Generation cancelled. Your current ideas are kept.');}).catch(()=>setMessage('Stopped waiting. Cancellation is unconfirmed. Check the existing request before starting another.'));" },
  { file: PROJECTS, text: "if(startAttempt&&(startAttempt.guideId!==project.id||startAttempt.version!==project.version)){setError('Check your previous project start before starting another.');" },
  { file: PROJECTS, text: "const attempt=startAttempt??{id:crypto.randomUUID(),guideId:project.id,version:project.version};setStartAttempt(attempt);setStarting(true);setError('');" },
  { file: PROJECTS, text: "await runtime.request('projects.start',{guideId:attempt.guideId,guideVersion:attempt.version},{idempotencyKey:attempt.id});if(!result||typeof result!=='object'||!('record' in result)||!('collection' in result))throw new Error('invalid project receipt');const row=result.record;if(!validProductionRecord('exploreProjects',row)||!validProductionCollection('exploreProjects',result.collection)||!('guide' in row)||!validProjectGuide(row.guide)||row.guide.id!==attempt.guideId||row.guide.version!==attempt.version||!result.collection.some(item=>item.id===row.id&&item.revision===row.revision))throw new Error('invalid project receipt');workspace.applyCanonical({collections:{exploreProjects:result.collection}});setStartAttempt(null);go('projects','detail',row.id);}" },
  { file: PROJECTS, text: "catch(error){if(error instanceof FrontendServiceError&&error.code!=='unknown_outcome')setStartAttempt(null);setError(serviceMessage(error));}finally{setStarting(false);}" },
]);

/** useProductionResource as one read: `{ data, loading, error }` once the request settles. */
export async function resource(runtime, operation, input) {
  try {
    const data = await runtime.request(operation, input === undefined ? undefined : JSON.parse(JSON.stringify(input)), { signal: new AbortController().signal });
    return { data, loading: false, error: null };
  } catch (error) {
    return { data: null, loading: false, error: serviceMessage(error) };
  }
}

/**
 * useProductionProjectGeneration(), as plain state. `pollMs` stands in for the
 * hook's fixed 1,500 ms wait between status checks.
 */
export function projectGeneration(runtime, { pollMs = 0 } = {}) {
  const contextKey = runtime?.scopeKey ?? '';
  const empty = { request: '', constraints: defaultProjectConstraints, items: [], contextKey, generation: 0 };
  const state = { storedBatch: empty, pending: null, startAttempt: null, guides: {}, evidence: [], busy: false, message: '', saved: { data: null, loading: true, error: null } };
  const setBatch = (value) => { state.storedBatch = value; };
  const setGuides = (value) => { state.guides = typeof value === 'function' ? value(state.guides) : value; };
  const setEvidence = (value) => { state.evidence = value; };
  const setPending = (value) => { state.pending = value; };
  const setStartAttempt = (value) => { state.startAttempt = value; };
  const setBusy = (value) => { state.busy = value; };
  const setMessage = (value) => { state.message = value; };
  const active = { current: null }, requestId = { current: '' }, jobId = { current: '' }, version = { current: 0 }, lock = { current: false }, last = { current: null };
  const setters = { current: { setBatch, setGuides, setEvidence, setPending, setStartAttempt } };
  const batch = () => state.storedBatch ?? empty;
  const commit = (result) => {
    if(result.contextKey!==contextKey||!result.batch||!result.guides)return false;
    setters.current.setBatch(result.batch);setters.current.setGuides(old=>({...old,...Object.fromEntries(result.guides.map(guide=>[guide.id,guide]))}));setters.current.setEvidence(result.evidence??[]);return true;
  };
  const commitRef = { current: commit };

  /** The mount read and the saved-result effect (`:21`, `:30`). */
  async function load() {
    state.saved = await resource(runtime, 'projects.current', {});
    const saved = state.saved;
    if(!runtime||saved.loading||!validProjectGeneration(saved.data)||saved.data.contextKey!==runtime.scopeKey)return;if(saved.data.pendingStart)setters.current.setStartAttempt(saved.data.pendingStart);if(saved.data.status==='completed')commitRef.current(saved.data);else if(!['failed','cancelled'].includes(saved.data.status))setters.current.setPending({id:saved.data.id,jobId:saved.data.id,constraints:defaultProjectConstraints,request:'',interpret:false});
  }

  async function regenerate(constraints=batch().constraints,request=batch().request,interpret=false,done,retry=false){
    const busy = state.busy, pending = state.pending;
    if(!runtime||busy||lock.current)return;
    if(pending&&!retry){setMessage('Check or cancel the existing generation before starting another.');return;}
    active.current?.abort();const controller=new AbortController();active.current=controller;const captured=++version.current;
    const attempt=retry&&pending?pending:{id:crypto.randomUUID(),constraints,request,interpret,jobId:undefined};const id=attempt.id;requestId.current=id;jobId.current=attempt.jobId??'';last.current={constraints:attempt.constraints,request:attempt.request,interpret:attempt.interpret,done};setPending(attempt);lock.current=true;setBusy(true);setMessage('');
    try{
      let result=retry?await runtime.request('projects.generation',{id:attempt.jobId??attempt.id},{signal:controller.signal}):await runtime.request('projects.generate',{contextKey,constraints:attempt.constraints,request:attempt.request,interpret:attempt.interpret,previousIdeaIds:batch().contextKey===contextKey?batch().items.map(item=>item.id):[]},{idempotencyKey:id,signal:controller.signal});
      for(let poll=0;poll<90;poll++){
        if(controller.signal.aborted||captured!==version.current)return;
        if(!validProjectGeneration(result))throw new Error('invalid generation');
        jobId.current=result.id;setPending({...attempt,jobId:result.id});
        if(result.contextKey!==contextKey)throw new Error('context changed');
        if(result.status==='completed'){if(!commitRef.current(result))throw new Error('invalid result');setPending(null);setMessage(`${result.batch.items.length} ideas ready.`);last.current=null;done?.();return;}
        if(result.status==='failed'||result.status==='cancelled'){setPending(null);setMessage(result.message||'Could not generate ideas. Your current set is kept.');return;}
        await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{controller.signal.removeEventListener('abort',cancel);resolve();},pollMs);const cancel=()=>{clearTimeout(timer);reject(new Error('cancelled'));};controller.signal.addEventListener('abort',cancel,{once:true});});
        result=await runtime.request('projects.generation',{id:jobId.current},{signal:controller.signal});
      }
      setMessage('Generation is taking longer than expected. Your current ideas are kept. Check this request again before starting another.');
    }catch(error){if(!controller.signal.aborted&&captured===version.current){if(error instanceof FrontendServiceError&&error.code!=='unknown_outcome'&&!jobId.current)setPending(null);setMessage(serviceMessage(error));}}
    finally{lock.current=false;if(captured===version.current){active.current=null;setBusy(false);}}
  }

  /** `:55`. Returns the cancel request's promise so a test can await it. */
  function cancel(){const pending=state.pending;const id=pending?.jobId||pending?.id||jobId.current||requestId.current;version.current++;active.current?.abort();active.current=null;lock.current=false;setBusy(false);setMessage('Stopped waiting. Checking cancellation...');if(runtime&&id)return runtime.request('projects.cancel',{id},{idempotencyKey:`cancel:${id}`}).then(result=>{if(!validProjectGeneration(result)||!['completed','cancelled','failed'].includes(result.status))throw new Error('unconfirmed');if(result.status==='completed')commitRef.current(result);setPending(null);setMessage(result.status==='completed'?'Ideas were ready before cancellation.':'Generation cancelled. Your current ideas are kept.');}).catch(()=>setMessage('Stopped waiting. Cancellation is unconfirmed. Check the existing request before starting another.'));return Promise.resolve();}

  function retry(){const pending=state.pending;if(pending)return regenerate(pending.constraints,pending.request,pending.interpret,last.current?.done,true);else if(last.current){const input=last.current;return regenerate(input.constraints,input.request,input.interpret,input.done);}return load();}

  return {
    state, load, regenerate, cancel, retry,
    /** What the screen shows (`:57-58`). */
    get batch() { const b = batch(); return b.contextKey===contextKey?b:{...empty,constraints:b.constraints,request:b.request}; },
    get evidence() { return batch().contextKey===contextKey?state.evidence:[]; },
    get message() { const saved = state.saved, pending = state.pending; return state.message||saved.error||(pending?'A generation needs checking. Retry checks the existing request.':saved.data&&!validProjectGeneration(saved.data)?'Saved project ideas could not be read. Try again.':''); },
    get pendingGeneration() { return Boolean(state.pending); },
    findGuide: (id) => state.guides[id],
  };
}

/**
 * ExploreProjects.tsx:50-58, startProject() on the production branch. `startAttempt`
 * is shared with the generation hook's draft (the same useHomeDraft key).
 * Returns `{ error, applied, went }`.
 */
export async function startProject(runtime, generation, project) {
  const out = { error: '', applied: null, went: null, starting: false };
  const workspace = { applyCanonical: (value) => { out.applied = value; } };
  const go = (...args) => { out.went = args; };
  const setError = (value) => { out.error = value; };
  const setStarting = (value) => { out.starting = value; };
  const setStartAttempt = (value) => { generation.state.startAttempt = value; };
  const startAttempt = generation.state.startAttempt;
  if(!project||out.starting)return out;
  if(startAttempt&&(startAttempt.guideId!==project.id||startAttempt.version!==project.version)){setError('Check your previous project start before starting another.');return out;}
  const attempt=startAttempt??{id:crypto.randomUUID(),guideId:project.id,version:project.version};setStartAttempt(attempt);setStarting(true);setError('');
  try{const result=await runtime.request('projects.start',{guideId:attempt.guideId,guideVersion:attempt.version},{idempotencyKey:attempt.id});if(!result||typeof result!=='object'||!('record' in result)||!('collection' in result))throw new Error('invalid project receipt');const row=result.record;if(!validProductionRecord('exploreProjects',row)||!validProductionCollection('exploreProjects',result.collection)||!('guide' in row)||!validProjectGuide(row.guide)||row.guide.id!==attempt.guideId||row.guide.version!==attempt.version||!result.collection.some(item=>item.id===row.id&&item.revision===row.revision))throw new Error('invalid project receipt');workspace.applyCanonical({collections:{exploreProjects:result.collection}});setStartAttempt(null);go('projects','detail',row.id);}
  catch(error){if(error instanceof FrontendServiceError&&error.code!=='unknown_outcome')setStartAttempt(null);setError(serviceMessage(error));}finally{setStarting(false);}
  return out;
}
