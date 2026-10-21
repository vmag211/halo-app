/**
 * What the outreach screen does with the B17 services, TRANSCRIBED from
 * components/expanded/ProductionOutreach.tsx: TypeScript to JavaScript with
 * the types removed and React state turned into plain fields, nothing else
 * changed. The runtime and the validators are NOT transcribed:
 * test/routesOutreachDb.test.mjs loads the real
 * lib/frontend/production/runtime.ts, outreach-service.ts and
 * explore-service.ts through test/frontend-test-loader.mjs.
 *
 * - `:35-36` the connection and history reads, and `account`;
 * - `:37-39` the recipients offered and the active one, and `context`;
 * - `:40-45` the public context read, the selected entry, the composed body and the signature;
 * - `:47-52` stale, ready, unknown, duplicate, historyReady and blocked;
 * - `:55` history copied into the send ledger;
 * - `:57` lookup, `:58` authorize, `:59-66` prepare, `:68` accept, `:69` send, `:70` check;
 * - `:73` the lookup button (disabled for Landlord and without an area) and "Use this contact" only for an email.
 *
 * `useProductionResource` (components/production/ProductionContext.tsx:8-19)
 * is modelled as one request per read: `data` on success, `error` its
 * `serviceMessage`. `FRAGMENTS` lists text that must occur character for
 * character both in the frontend file and in this file; the drift test reads
 * both, so a change to any of those lines fails it.
 */
import { loadFrontend } from '../frontend-test-loader.mjs';

const { FrontendServiceError, serviceMessage } = await loadFrontend('production/runtime');
const { validContacts } = await loadFrontend('production/explore-service');
const { validEmail, validGoogleAuthorization, validOutreachAttempt, validOutreachConnection, validOutreachEvidence, validOutreachHistory, validOutreachReview } = await loadFrontend('production/outreach-service');
const { outreachTemplate, recipients } = await loadFrontend('explore-preview');

const clean=(value)=>value.replace(/\u2014/g,',');
const blank=(recipient)=>({name:'',email:'',reviewedFor:'',body:outreachTemplate(recipient,'Request information'),subject:'A question about local environmental information',notes:[]});
const areaLabel = (area) => [area.place.trim(), area.state.trim()].filter(Boolean).join(', ');

/** The screen for one runtime. `notes` is the exploreNotes collection; `area` the saved area (a DiscoveryPlace or blank). */
export function outreachScreen(runtime, { notes: noteRecords = [], area = { place: '', state: '' }, assign = () => { throw new Error('window.location.assign must not be reached'); } } = {}) {
  const s = {
    recipient: 'Utility', topic: 'Drinking water', purpose: 'Request information', water: 'Utility', area,
    letters: { Utility: blank('Utility'), Landlord: blank('Landlord'), Representative: blank('Representative'), 'Local office': blank('Local office') },
    attempts: [], pending: null, publicContext: {}, busy: false, message: '', review: null, candidates: null, authorizing: false,
    connection: { data: null, error: null, loading: true }, history: { data: null, error: null, loading: true }, evidenceRead: { data: null, error: null, loading: true },
    requests: [], assigned: [],
  };
  const notes = { records: noteRecords };
  const lock = { current: false }, mounted = { current: true }, request = { current: null };
  const window = { location: { assign: (url) => { s.assigned.push(url); assign(url); } } };
  const setBusy = (v) => { s.busy = v; }, setMessage = (v) => { s.message = v; }, setReview = (v) => { s.review = v; };
  const setCandidates = (v) => { s.candidates = v; }, setAuthorizing = (v) => { s.authorizing = v; }, setPending = (v) => { s.pending = v; };
  const setAttempts = (f) => { s.attempts = typeof f === 'function' ? f(s.attempts) : f; };
  const setLetters = (f) => { s.letters = f(s.letters); };
  const setPreview = () => {};
  const setters = { current: { setAttempts } };
  const tracked = { request: (operation, input, options) => { s.requests.push(operation); return runtime.request(operation, input, options); } };

  /** Every value the render derives (`:36-52`), recomputed from the state. */
  function derive() {
    const { topic, water, area: currentArea, letters, attempts, pending, publicContext, busy, connection, history, evidenceRead } = s;
    const area = currentArea;
    const recipient = s.recipient;
 const account=validOutreachConnection(connection.data)?connection.data:null;
 const available=water==='Utility'?recipients:recipients.filter(item=>item!=='Utility');
 const active=available.includes(recipient)?recipient:'Representative',letter=letters[active];
 const context=JSON.stringify([active,topic,area,water]);
 const evidence=validOutreachEvidence(evidenceRead.data)?evidenceRead.data:null,selectedEvidence=publicContext[active];
 const evidenceStale=Boolean(selectedEvidence&&(selectedEvidence.context!==context||selectedEvidence.revision!==evidence?.revision||!evidence.entries.some(item=>item.id===selectedEvidence.entry.id)));
 const evidenceText=selectedEvidence?`\n\nPublic context I chose to include:\n${selectedEvidence.entry.title}\n${selectedEvidence.entry.text}\n${selectedEvidence.entry.scope}\nAs of ${selectedEvidence.entry.asOf}\n${selectedEvidence.entry.url}`:'';
 const body=clean(`${letter.body}${evidenceText}${letter.notes.length?`\n\nNotes I chose to include:\n${letter.notes.map(note=>`${note.title}\n${note.description}`).join('\n\n')}`:''}`);
 const signature=JSON.stringify([context,letter.email.trim(),clean(letter.subject.trim()),body,letter.notes.map(note=>[note.id,note.revision]),account?.revision]);
 const stale=letter.notes.some(note=>notes.records.find(row=>row.id===note.id)?.revision!==note.revision);
 const ready=validEmail(letter.email)&&!!letter.subject.trim()&&!/[\r\n]/.test(letter.subject)&&!!letter.body.trim()&&letter.reviewedFor===context&&!stale&&!evidenceStale;
 const unknown=attempts.filter(item=>['queued','unknown'].includes(item.status));
 const duplicate=attempts.some(item=>item.to===letter.email.trim()&&item.subject===clean(letter.subject.trim())&&item.body===body&&['queued','unknown','submitted'].includes(item.status));
 const historyReady=validOutreachHistory(history.data)&&history.data.complete;
 const blocked=busy||history.loading||Boolean(history.error)||!historyReady||typeof navigator!=='undefined'&&!navigator.onLine;
 const off=connection.off||history.off||evidenceRead.off;
    return { account, available, active, letter, context, evidence, selectedEvidence, evidenceStale, body, signature, stale, ready, unknown, duplicate, historyReady, blocked, pending, off };
  }

  async function resource(operation, input) {
    try { return { data: await tracked.request(operation, input, { signal: new AbortController().signal }), error: null, loading: false }; }
    catch (error) { return { data: null, error: serviceMessage(error), loading: false, off: error instanceof FrontendServiceError && error.reason === 'feature_unavailable' }; }
  }

  return {
    state: s, derive,
    /** The three reads on mount, then `:55`. */
    async mount() {
      s.connection = await resource('outreach.connection', {});
      s.history = await resource('outreach.history', {});
      s.evidenceRead = await resource('outreach.context', { topic: s.topic, water: s.water, area: s.area });
      const history = s.history;
      if(validOutreachHistory(history.data))setters.current.setAttempts(history.data.attempts);
    },
    async reloadEvidence() { s.evidenceRead = await resource('outreach.context', { topic: s.topic, water: s.water, area: s.area }); },
    set(values) { Object.assign(s, values); },
    /** `update` (`:56`) on the active letter. */
    update(values) { const { active } = derive(); setLetters(old=>({...old,[active]:{...old[active],...values}}));setPreview('');setReview(null);setMessage(''); },
    /** Ticks "I checked the recipient" (`:74`). */
    confirmRecipient() { const { context } = derive(); this.update({ reviewedFor: context }); },
    /** Chooses a public source entry (`:78`). */
    chooseEvidence(entry) { const { active, context, evidence } = derive(); s.publicContext = { ...s.publicContext, [active]: { context, revision: evidence.revision, entry } }; },
    /** The lookup button's disabled rule: `disabled={off||busy||!areaLabel(area)||active==='Landlord'}`. */
    lookupDisabled() { const { active, off } = derive(); const { busy, area } = s; return off||busy||!areaLabel(area)||active==='Landlord'; },
    /** "Use this contact" is offered only for a contact with an email (`:73`, `contact.email&&`). */
    usable(contact) { return Boolean(contact.email); },
    async lookup() {
      const { active, context } = derive(); const { topic, water, area } = s; const runtime = tracked;
      if(lock.current||!areaLabel(area))return;lock.current=true;setBusy(true);setMessage('');const controller=new AbortController();request.current=controller;const scope=context;try{const result=await runtime.request('contacts.resolve',{topic,recipient:active,water,area},{signal:controller.signal,idempotencyKey:crypto.randomUUID()});if(controller.signal.aborted||!mounted.current)return;if(!validContacts(result))throw new Error('invalid contacts');setCandidates({scope,items:result.contacts});if(!result.contacts.length)setMessage('No matching public contact was found. You can use an official website or add a public address.');}catch(error){if(!controller.signal.aborted)setMessage(serviceMessage(error));}finally{lock.current=false;if(mounted.current)setBusy(false);}
    },
    async authorize() {
      const runtime = tracked;
      if(lock.current)return;lock.current=true;setAuthorizing(true);setMessage('');try{const result=await runtime.request('outreach.connect',{provider:'gmail',returnPath:'/act?view=main&destination=outreach'},{idempotencyKey:crypto.randomUUID()});if(!validGoogleAuthorization(result))throw new Error('invalid authorization');window.location.assign(result.authorizationUrl);}catch(error){setMessage(serviceMessage(error));}finally{lock.current=false;setAuthorizing(false);}
    },
    async prepare() {
      const { blocked, ready, account, pending, unknown, duplicate, signature, letter, body, selectedEvidence, active } = derive(); const { topic, area, water } = s; const runtime = tracked;
      const latest = { current: signature };
  if(blocked||!ready||!account?.connected||pending||unknown.length||duplicate)return;
  lock.current=true;setBusy(true);setMessage('');const captured=signature;
  try{
   const result=await runtime.request('outreach.prepare',{to:letter.email.trim(),name:letter.name,subject:clean(letter.subject.trim()),body,notes:letter.notes.map(note=>({id:note.id,revision:note.revision})),publicContext:selectedEvidence?{id:selectedEvidence.entry.id,revision:selectedEvidence.revision}:null,context:{topic,recipient:active,area,water},signature:captured,senderRevision:account.revision},{idempotencyKey:crypto.randomUUID()});
   if(latest.current!==captured){setMessage('The message changed. Review it again.');return;}
   if(!validOutreachReview(result)||result.signature!==captured||result.to!==letter.email.trim()||result.subject!==clean(letter.subject.trim())||result.body!==body||result.from!==account.sender)throw new Error('invalid review');setReview(result);
  }catch(error){setMessage(serviceMessage(error));}finally{lock.current=false;if(mounted.current)setBusy(false);}
    },
    accept(result) { setAttempts(old=>[result,...old.filter(item=>item.id!==result.id)]);if(!['queued','unknown'].includes(result.status))setPending(null);setMessage(result.status==='submitted'?'Submitted to Gmail. Delivery to the recipient is not confirmed.':result.status==='queued'?'The send is queued. Check this attempt; do not resend.':result.status==='unknown'?'The send result is not confirmed. Check this attempt before trying again.':clean(result.message||'This attempt was not submitted. Your draft is kept.')); },
    async send() {
      const { review } = s; const { blocked, ready, pending, unknown, duplicate, signature } = derive(); const runtime = tracked; const accept = (r) => this.accept(r);
      if(!review||blocked||!ready||pending||unknown.length||duplicate||review.signature!==signature||Date.parse(review.expiresAt)<=Date.now()){setReview(null);setMessage('This review changed or expired. Review the current message again.');return;}const attempt={id:crypto.randomUUID(),review};setPending(attempt);setReview(null);lock.current=true;setBusy(true);try{const result=await runtime.request('outreach.send',{reviewId:review.id,reviewRevision:review.revision},{idempotencyKey:attempt.id,expectedRevision:review.revision});if(!validOutreachAttempt(result)||result.id!==attempt.id||result.to!==attempt.review.to||result.subject!==attempt.review.subject||result.body!==attempt.review.body||result.from!==attempt.review.from)throw new Error('invalid send receipt');accept(result);}catch(error){if(error instanceof FrontendServiceError&&error.code!=='unknown_outcome')setPending(null);setMessage(serviceMessage(error));}finally{lock.current=false;if(mounted.current)setBusy(false);}
    },
    async check(id) {
      const runtime = tracked; const accept = (r) => this.accept(r);
      if(lock.current)return;lock.current=true;setBusy(true);try{const result=await runtime.request('outreach.status',{id});if(!validOutreachAttempt(result)||result.id!==id)throw new Error('invalid send status');accept(result);}catch(error){setMessage(serviceMessage(error));}finally{lock.current=false;if(mounted.current)setBusy(false);}
    },
  };
}

/** Text that must occur in both ProductionOutreach.tsx and this file. */
export const FRAGMENTS = Object.freeze([
  'const account=validOutreachConnection(connection.data)?connection.data:null;',
  "water==='Utility'?recipients:recipients.filter(item=>item!=='Utility');",
  "available.includes(recipient)?recipient:'Representative',letter=letters[active];",
  'const context=JSON.stringify([active,topic,area,water]);',
  'const evidence=validOutreachEvidence(evidenceRead.data)?evidenceRead.data:null,selectedEvidence=publicContext[active];',
  'const evidenceStale=Boolean(selectedEvidence&&(selectedEvidence.context!==context||selectedEvidence.revision!==evidence?.revision||!evidence.entries.some(item=>item.id===selectedEvidence.entry.id)));',
  'const evidenceText=selectedEvidence?`\\n\\nPublic context I chose to include:\\n${selectedEvidence.entry.title}\\n${selectedEvidence.entry.text}\\n${selectedEvidence.entry.scope}\\nAs of ${selectedEvidence.entry.asOf}\\n${selectedEvidence.entry.url}`:\'\';',
  "const body=clean(`${letter.body}${evidenceText}${letter.notes.length?`\\n\\nNotes I chose to include:\\n${letter.notes.map(note=>`${note.title}\\n${note.description}`).join('\\n\\n')}`:''}`);",
  'const signature=JSON.stringify([context,letter.email.trim(),clean(letter.subject.trim()),body,letter.notes.map(note=>[note.id,note.revision]),account?.revision]);',
  'const stale=letter.notes.some(note=>notes.records.find(row=>row.id===note.id)?.revision!==note.revision);',
  "const ready=validEmail(letter.email)&&!!letter.subject.trim()&&!/[\\r\\n]/.test(letter.subject)&&!!letter.body.trim()&&letter.reviewedFor===context&&!stale&&!evidenceStale;",
  "const unknown=attempts.filter(item=>['queued','unknown'].includes(item.status));",
  "const duplicate=attempts.some(item=>item.to===letter.email.trim()&&item.subject===clean(letter.subject.trim())&&item.body===body&&['queued','unknown','submitted'].includes(item.status));",
  'const historyReady=validOutreachHistory(history.data)&&history.data.complete;',
  "const blocked=busy||history.loading||Boolean(history.error)||!historyReady||typeof navigator!=='undefined'&&!navigator.onLine;",
  'if(validOutreachHistory(history.data))setters.current.setAttempts(history.data.attempts);',
  "await runtime.request('contacts.resolve',{topic,recipient:active,water,area},{signal:controller.signal,idempotencyKey:crypto.randomUUID()});if(controller.signal.aborted||!mounted.current)return;if(!validContacts(result))throw new Error('invalid contacts');setCandidates({scope,items:result.contacts});if(!result.contacts.length)setMessage('No matching public contact was found. You can use an official website or add a public address.');}catch(error){if(!controller.signal.aborted)setMessage(serviceMessage(error));}finally{lock.current=false;if(mounted.current)setBusy(false);}",
  "await runtime.request('outreach.connect',{provider:'gmail',returnPath:'/act?view=main&destination=outreach'},{idempotencyKey:crypto.randomUUID()});if(!validGoogleAuthorization(result))throw new Error('invalid authorization');window.location.assign(result.authorizationUrl);}catch(error){setMessage(serviceMessage(error));}finally{lock.current=false;setAuthorizing(false);}",
  'if(blocked||!ready||!account?.connected||pending||unknown.length||duplicate)return;',
  "await runtime.request('outreach.prepare',{to:letter.email.trim(),name:letter.name,subject:clean(letter.subject.trim()),body,notes:letter.notes.map(note=>({id:note.id,revision:note.revision})),publicContext:selectedEvidence?{id:selectedEvidence.entry.id,revision:selectedEvidence.revision}:null,context:{topic,recipient:active,area,water},signature:captured,senderRevision:account.revision},{idempotencyKey:crypto.randomUUID()});",
  "if(!validOutreachReview(result)||result.signature!==captured||result.to!==letter.email.trim()||result.subject!==clean(letter.subject.trim())||result.body!==body||result.from!==account.sender)throw new Error('invalid review');setReview(result);",
  "setAttempts(old=>[result,...old.filter(item=>item.id!==result.id)]);if(!['queued','unknown'].includes(result.status))setPending(null);",
  "await runtime.request('outreach.send',{reviewId:review.id,reviewRevision:review.revision},{idempotencyKey:attempt.id,expectedRevision:review.revision});if(!validOutreachAttempt(result)||result.id!==attempt.id||result.to!==attempt.review.to||result.subject!==attempt.review.subject||result.body!==attempt.review.body||result.from!==attempt.review.from)throw new Error('invalid send receipt');accept(result);}catch(error){if(error instanceof FrontendServiceError&&error.code!=='unknown_outcome')setPending(null);setMessage(serviceMessage(error));}",
  "await runtime.request('outreach.status',{id});if(!validOutreachAttempt(result)||result.id!==id)throw new Error('invalid send status');accept(result);",
  "disabled={off||busy||!areaLabel(area)||active==='Landlord'}",
  'const off=connection.off||history.off||evidenceRead.off;',
  'contact.email&&',
  "=>value.replace(/\\u2014/g,',');",
]);
