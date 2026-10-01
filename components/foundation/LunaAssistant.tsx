'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpRight, Ellipsis, Info, MessageSquarePlus, RotateCcw, X } from 'lucide-react';
import { factorReadings, type FactorKey } from '@/lib/frontend/factor-preview';
import { displayText } from '@/lib/frontend/onboarding';
import type { FactorHref } from './PersonalHero';
import { useSceneExperience } from './SceneExperience';
import LunaMark from './LunaMark';
import './luna-assistant.css';

type Prompt = { label: string; factor?: FactorKey };
type Citation = { n: number; label: string; url: string; retrieved?: string | null };
export type LunaSuggestions = { suggestions: string[]; disclaimer: string; sends_household_context?: boolean };
export type LunaResponse = {
  answer: string | null; message: string | null; declined: boolean; configured: boolean | null;
  reason: 'no_source' | 'unavailable' | null; grounded: boolean; citations: Citation[];
  uses_household_data: boolean; disclaimer: string;
};
export type LunaTransport = {
  getAssistant: (page: string, signal?: AbortSignal) => Promise<LunaSuggestions>;
  askAssistant: (question: string, page: string, signal?: AbortSignal) => Promise<LunaResponse>;
};
type Message = {
  role: 'user' | 'assistant'; text: string; factor?: FactorKey; id?: number;
  citations?: Citation[]; disclaimer?: string; usesHousehold?: boolean; retryQuestion?: string;
  kind?: 'answer' | 'refused' | 'unavailable' | 'unconfigured' | 'no_source';
};
const defaultDisclaimer = 'General information, not medical advice.';

function safeCitation(citation: Citation): Citation | null {
  try {
    const url = new URL(citation.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return { ...citation, url: url.href, label: displayText(citation.label) || url.hostname, retrieved: displayText(citation.retrieved) };
  } catch { return null; }
}
function failureText(error: unknown): { text: string; retry: boolean } {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
  if (code === 'rate_limited') return { text: 'You have reached the question limit for now. Please try again later.', retry: false };
  if (code === 'session_changed' || code === 'signin_failed') return { text: 'Your session changed. Close Luna and reopen it after HALO reconnects.', retry: false };
  if (code === 'offline') return { text: 'Luna could not connect. Reconnect and retry your question.', retry: true };
  if (code === 'timeout') return { text: 'Luna took too long to respond. You can retry your question.', retry: true };
  return { text: 'Luna could not reach its sources. Please try again.', retry: true };
}
function citedAnswer(message: Message): ReactNode {
  const parts: ReactNode[] = []; let position = 0;
  for (const match of message.text.matchAll(/\[([^\]\r\n]*)\]/g)) {
    parts.push(message.text.slice(position, match.index));
    const number = /^\d+$/.test(match[1]) ? Number(match[1]) : null;
    const source = number === null ? null : message.citations?.find(citation => citation.n === number);
    if (source) {
      const target = `luna-source-${message.id}-${number}`;
      parts.push(<sup key={`${match.index}:${number}`}><a href={`#${target}`} aria-label={`Source ${number}: ${source.label}`} onClick={event => {
        event.preventDefault(); const element = document.getElementById(target); element?.focus({ preventScroll: true }); element?.scrollIntoView({ block: 'nearest' });
      }}>{number}</a></sup>);
    }
    position = match.index! + match[0].length;
  }
  parts.push(message.text.slice(position));
  return parts;
}

export default function LunaAssistant({ onClose, factorHref, factor, home, offline = false, missing = false, live, page, onNavigate }: {
  onClose: () => void; factorHref: FactorHref; factor?: FactorKey; home: boolean; offline?: boolean; missing?: boolean;
  live?: LunaTransport; page?: string;
  onNavigate?: (href: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const { motion } = useSceneExperience();
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [options, setOptions] = useState(false);
  const [about, setAbout] = useState(false);
  const [suggestions, setSuggestions] = useState(false);
  const [below, setBelow] = useState(false);
  const [metadata, setMetadata] = useState<LunaSuggestions | null>(null);
  const [suggestionStatus, setSuggestionStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [suggestionAttempt, setSuggestionAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const [sessionChanged, setSessionChanged] = useState(false);
  const request = useRef<{ controller: AbortController; question: string } | null>(null);
  const metadataRequest = useRef<AbortController | null>(null);
  const messageId = useRef(0);
  const requestPage = page ?? (home ? 'home' : 'today');
  const previewPrompts: Prompt[] = factor ? [
    { label: `Help me understand ${factorReadings[factor].title.toLowerCase()}`, factor },
    { label: 'What does my score mean?' },
  ] : home ? [
    { label: 'What does my PFAS result mean?', factor: 'pfas' },
    { label: 'What can a radon estimate tell me?', factor: 'radon' },
    { label: 'Help me understand my home score' },
  ] : [
    { label: 'What shapes my Today score?' },
    { label: 'Help me understand air quality', factor: 'air' },
    { label: 'What does the UV forecast mean?', factor: 'uv' },
  ];
  const prompts = live ? (metadata?.suggestions ?? []).filter(value => typeof value === 'string' && value.trim()).slice(0, 6).map(label => ({ label: displayText(label).slice(0, 1000) })) : previewPrompts;
  const privacy = metadata?.sends_household_context === false
    ? 'Your question and public source material are sent to HALO’s AI service. The service reports that household context is not included.'
    : metadata?.sends_household_context === true
      ? 'Your question and household context may be sent to HALO’s AI service to help explain your readings.'
      : 'Your question is sent to HALO’s AI service. Household context may also be included; the service has not confirmed its sharing setting.';

  useEffect(() => {
    if (!live || sessionChanged) return;
    const controller = new AbortController();
    metadataRequest.current = controller;
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setSuggestionStatus('loading');
      void live.getAssistant(requestPage, controller.signal).then(result => {
        if (controller.signal.aborted) return;
        setMetadata(result); setSuggestionStatus('ready');
      }).catch(() => { if (!controller.signal.aborted) setSuggestionStatus('error'); });
    });
    return () => { controller.abort(); };
  }, [live, requestPage, sessionChanged, suggestionAttempt]);

  useEffect(() => {
    if (!live) return;
    const resetIdentity = () => {
      request.current?.controller.abort(); request.current = null; metadataRequest.current?.abort();
      setPending(false); setMessages([]); setDraft(''); setMetadata(null); setSuggestions(false); setOptions(false); setAbout(false);
      setSessionChanged(true); setNotice('Your session changed. Close Luna and reopen it after HALO reconnects.');
    };
    window.addEventListener('halo:identity-changed', resetIdentity);
    return () => {
      request.current?.controller.abort(); request.current = null; metadataRequest.current?.abort();
      window.removeEventListener('halo:identity-changed', resetIdentity);
    };
  }, [live]);

  useEffect(() => {
    const element = dialog.current;
    const y = window.scrollY;
    const saved = { position: document.body.style.position, top: document.body.style.top, width: document.body.style.width };
    document.body.style.position = 'fixed'; document.body.style.top = `${-y}px`; document.body.style.width = '100%';
    element?.showModal();
    const viewport = window.visualViewport;
    const resize = () => {
      if (!element || !viewport) return;
      element.style.setProperty('--luna-height', `${viewport.height}px`);
      element.style.bottom = `calc(${Math.max(8, window.innerHeight - viewport.height - viewport.offsetTop + 8)}px + env(safe-area-inset-bottom))`;
    };
    resize(); viewport?.addEventListener('resize', resize); viewport?.addEventListener('scroll', resize);
    return () => {
      element?.close(); Object.assign(document.body.style, saved); window.scrollTo(0, y);
      viewport?.removeEventListener('resize', resize); viewport?.removeEventListener('scroll', resize);
      requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.halo-f-assistant')?.focus({ preventScroll: true }));
    };
  }, []);

  function scrollToLatest() {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: motion ? 'smooth' : 'instant' });
  }
  useEffect(() => {
    if (messages.length) log.current?.scrollTo({ top: log.current.scrollHeight, behavior: motion ? 'smooth' : 'instant' });
  }, [messages, motion, pending, notice]);

  async function sendLive(question: string, retryId?: number) {
    if (!live || offline || sessionChanged || request.current) return;
    const controller = new AbortController();
    request.current = { controller, question };
    setPending(true); setNotice(''); setSuggestions(false);
    const questionId = ++messageId.current;
    if (retryId === undefined) setDraft('');
    setMessages(current => retryId === undefined ? [...current, { role: 'user', text: question, id: questionId }] : current.filter(message => message.id !== retryId));
    try {
      const response = await live.askAssistant(question, requestPage, controller.signal);
      if (controller.signal.aborted) return;
      const unavailable = response.reason === 'unavailable';
      const unsupported = response.reason === 'no_source' || response.configured === false || response.grounded !== true;
      const answer = displayText(response.answer);
      const reply = response.declined
        ? displayText(response.message) || 'Luna cannot diagnose a condition or recommend treatment. Speak with a qualified health professional about health concerns.'
        : unavailable
          ? displayText(response.message) || 'Luna could not reach its sources. Please try again.'
          : response.configured === false
            ? 'Luna is not available yet. You can still explore your readings and their references.'
          : unsupported
            ? displayText(response.message) || 'Luna does not have a reliable source for that question.'
            : answer || 'Luna did not return an answer. Please try again.';
      const grounded = !response.declined && !unavailable && !unsupported && !!answer;
      const answerId = ++messageId.current;
      setMessages(current => [...current, {
        role: 'assistant', text: reply, id: answerId,
        kind: response.declined ? 'refused' : unavailable ? 'unavailable' : response.configured === false ? 'unconfigured' : unsupported ? 'no_source' : 'answer',
        factor: grounded ? factor : undefined,
        citations: grounded && Array.isArray(response.citations) ? response.citations.filter(citation => citation && typeof citation === 'object').map(safeCitation).filter((citation): citation is Citation => citation !== null) : [],
        disclaimer: displayText(response.disclaimer) || defaultDisclaimer,
        usesHousehold: grounded && response.uses_household_data === true,
        retryQuestion: !response.declined && (unavailable || (!unsupported && !answer)) ? question : undefined,
      }]);
    } catch (error) {
      if (controller.signal.aborted) return;
      const failure = failureText(error);
      const failureId = ++messageId.current;
      setMessages(current => [...current, { role: 'assistant', text: failure.text, id: failureId, retryQuestion: failure.retry ? question : undefined }]);
    } finally {
      if (request.current?.controller === controller) { request.current = null; setPending(false); }
    }
  }

  function cancelRequest(restoreDraft = true) {
    const active = request.current;
    if (!active) return;
    active.controller.abort(); request.current = null; setPending(false);
    if (restoreDraft) {
      setDraft(current => current || active.question);
      setNotice('Request cancelled. Your question is ready to edit or send again.');
      input.current?.focus();
    }
  }
  function closePanel() { cancelRequest(false); metadataRequest.current?.abort(); onClose(); }

  function send(text: string, selected?: Prompt) {
    const clean = displayText(text.trim()).slice(0, 1000);
    if (!clean || offline) return;
    if (live) { void sendLive(clean); return; }
    const reply = selected?.factor ? factorReadings[selected.factor].detail : selected
      ? home
        ? 'Homeguard brings together water and radon information. Lead is shown separately for awareness and is not included in the home score. Higher scores are better. These are sample values for reviewing the design.'
        : 'Today brings together air quality, UV, pollen, and mold conditions. Higher scores are better. The colored ring shows the share of available risk from each factor, not your personal chance of illness. These are sample values for reviewing the design.'
      : 'This preview does not generate live AI answers. Try one of the suggested questions to explore an example explanation, or open a factor page for its reading and references.';
    setMessages(current => [...current, { role: 'user', text: clean }, { role: 'assistant', text: `${missing ? 'Current readings are unavailable. This is general information. ' : ''}${reply}`, factor: selected?.factor }]);
    setDraft(''); setSuggestions(false);
  }
  function startOver() {
    cancelRequest(false); setNotice('');
    setMessages([]); setDraft(''); setOptions(false); setAbout(false); setSuggestions(false); setBelow(false);
    log.current?.scrollTo({ top: 0 }); input.current?.focus();
  }
  const promptButtons = <div className="halo-luna-prompts">{prompts.map((prompt, index) => <button key={`${index}:${prompt.label}`} disabled={offline || pending || sessionChanged} onClick={() => send(prompt.label, prompt)}><LunaMark size={22} /><span>{prompt.label}</span><ArrowUpRight size={17} aria-hidden="true" /></button>)}</div>;

  return <dialog ref={dialog} className="halo-luna-dialog" aria-labelledby="luna-title" aria-describedby="luna-subtitle" onCancel={event => { event.preventDefault(); closePanel(); }} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closePanel();
  }}>
    <header className="halo-luna-header"><LunaMark size={35} /><div className="halo-luna-identity"><div><h2 id="luna-title">Luna</h2>{!live && <span className="halo-luna-preview">Preview</span>}</div><p id="luna-subtitle">Your HALO assistant</p></div><button className="halo-luna-icon" aria-label="Luna options" aria-expanded={options} aria-controls="luna-options" onClick={() => setOptions(value => !value)}><Ellipsis size={22} aria-hidden="true" /></button><button className="halo-luna-icon" aria-label="Close Luna" onClick={closePanel} autoFocus><X size={22} aria-hidden="true" /></button></header>
    {options && <div id="luna-options" className="halo-luna-options"><button onClick={startOver}><RotateCcw size={17} aria-hidden="true" />Start a new conversation</button><button onClick={() => { setAbout(value => !value); setOptions(false); }}><Info size={17} aria-hidden="true" />{live ? 'About Luna' : 'About this preview'}</button></div>}
    {about && <aside className="halo-luna-about"><p>{live ? `${privacy} This panel keeps messages only while it is open. Each question is sent separately, without earlier messages. Closing or clearing this panel does not undo requests already sent. Avoid sharing personal or medical details.` : 'Example replies only. Messages stay in this open panel and are cleared when you close it. Nothing is sent to HALO’s AI backend. Avoid sharing personal or medical details.'}</p><button onClick={() => setAbout(false)} aria-label={live ? 'Close Luna information' : 'Close preview information'}><X size={18} aria-hidden="true" /></button></aside>}
    <div ref={log} className="halo-luna-scroll" onScroll={() => { const node = log.current; if (node) setBelow(node.scrollHeight - node.clientHeight - node.scrollTop > 100); }}>
      <p className="halo-luna-date">Today</p>
      <section className="halo-luna-welcome"><span className="halo-luna-welcome-mark"><LunaMark size={46} /></span><h3>A little clarity,<br />with Luna.</h3><p>I’m your HALO assistant. Let’s <strong>make sense of your surroundings</strong>, explore your readings, and find a useful next step.</p><p className="halo-luna-disclosure">{live ? `${displayText(metadata?.disclaimer) || defaultDisclaimer} ${privacy}` : 'Interactive design preview with example replies. General information, not medical advice.'} <button onClick={() => setAbout(true)}>How this works</button></p></section>
      <div className="halo-luna-opening"><LunaMark size={22} /><p>What would you like to understand today?</p></div>
      {!messages.length && promptButtons}
      {live && !messages.length && !sessionChanged && suggestionStatus === 'loading' && <p className="halo-luna-service-note" role="status">Loading suggested questions…</p>}
      {live && !messages.length && !sessionChanged && suggestionStatus === 'error' && <div className="halo-luna-service-note"><p>Suggested questions are unavailable. You can still type a question.</p><button className="halo-luna-text-action" disabled={offline} onClick={() => setSuggestionAttempt(value => value + 1)}>Retry suggestions</button></div>}
      <div className="halo-luna-messages" role="log" aria-label="Conversation with Luna" aria-live="polite" aria-relevant="additions">{messages.map((message, index) => <div className={`halo-luna-message halo-luna-message--${message.role}`} data-state={message.kind} key={message.id ?? index}>
        {message.role === 'assistant' && <LunaMark size={24} />}<div><span className="halo-luna-message-label">{message.role === 'user' ? 'You' : live ? message.kind === 'refused' ? 'Luna · Outside my scope' : 'Luna' : 'Luna · Example reply'}</span><p>{live && message.role === 'assistant' ? citedAnswer(message) : message.text}</p>{message.factor && <a href={factorHref(message.factor)} onClick={event => {
          if (!onNavigate || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault(); onNavigate(factorHref(message.factor!));
        }}>View {factorReadings[message.factor].title.toLowerCase()} and references <ArrowUpRight size={15} aria-hidden="true" /></a>}
          {!!message.citations?.length && <ol className="halo-luna-citations" aria-label="Answer sources">{message.citations.map((citation, sourceIndex) => <li id={`luna-source-${message.id}-${citation.n}`} tabIndex={-1} key={`${sourceIndex}:${citation.url}`}><a href={citation.url} target="_blank" rel="noopener noreferrer"><span>{Number.isInteger(citation.n) && citation.n > 0 ? `[${citation.n}] ` : ''}{citation.label}</span><ArrowUpRight size={15} aria-hidden="true" /></a>{citation.retrieved && <small>Retrieved {citation.retrieved}</small>}</li>)}</ol>}
          {message.usesHousehold && <p className="halo-luna-service-note">This answer refers to your household information.</p>}
          {message.disclaimer && <p className="halo-luna-service-note">{message.disclaimer}</p>}
          {message.retryQuestion && <button className="halo-luna-text-action" disabled={offline || pending || sessionChanged} onClick={() => { void sendLive(message.retryQuestion!, message.id); }}>Retry question</button>}
        </div>
      </div>)}</div>
      {pending && <div className="halo-luna-request" role="status"><p>Luna is checking its sources…</p><button className="halo-luna-text-action" onClick={() => cancelRequest()}>Cancel request</button></div>}
      {!!notice && <p className="halo-luna-service-note" role="status">{notice}</p>}
    </div>
    <footer className="halo-luna-footer">
      {below && <button className="halo-luna-latest" onClick={scrollToLatest} aria-label="Scroll to latest message"><ArrowDown size={20} aria-hidden="true" /></button>}
      {offline && <p className="halo-luna-offline" role="status">You’re offline. Reconnect before asking Luna. Your draft stays here while this panel is open.</p>}
      {suggestions && <div className="halo-luna-suggestions" id="luna-suggestions">{promptButtons}</div>}
      <form className="halo-luna-composer" onSubmit={event => { event.preventDefault(); send(draft); }}>
        <label className="halo-sr-only" htmlFor="luna-message">Message Luna</label><textarea ref={input} id="luna-message" placeholder="Ask Luna a question…" maxLength={1000} value={draft} rows={2} onChange={event => setDraft(event.target.value)} aria-describedby="luna-composer-note" onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(draft); } }} />
        <div className="halo-luna-compose-tools"><button type="button" className="halo-luna-icon" aria-label="Suggested questions" aria-expanded={suggestions} aria-controls="luna-suggestions" disabled={!!live && (!prompts.length || sessionChanged)} onClick={() => setSuggestions(value => !value)}><MessageSquarePlus size={21} aria-hidden="true" /></button><span>{draft.length > 800 ? `${draft.length}/1000` : 'A question is a good start.'}</span><button className="halo-luna-send" type="submit" aria-label="Send message" disabled={!draft.trim() || offline || pending || sessionChanged}><ArrowUp size={21} aria-hidden="true" /></button></div>
      </form><p id="luna-composer-note" className="halo-luna-footer-note">Luna can make mistakes. Check important information.</p>
    </footer>
  </dialog>;
}
