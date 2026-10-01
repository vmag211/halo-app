'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpRight, Ellipsis, Info, MessageSquarePlus, RotateCcw, X } from 'lucide-react';
import { factorReadings, type FactorKey } from '@/lib/frontend/factor-preview';
import { displayText } from '@/lib/frontend/onboarding';
import type { FactorHref } from './PersonalHero';
import { useSceneExperience } from './SceneExperience';
import LunaMark from './LunaMark';
import './luna-assistant.css';

type Prompt = { label: string; factor?: FactorKey };
type Message = { role: 'user' | 'assistant'; text: string; factor?: FactorKey };

export default function LunaAssistant({ onClose, factorHref, factor, home, offline = false, missing = false }: {
  onClose: () => void; factorHref: FactorHref; factor?: FactorKey; home: boolean; offline?: boolean; missing?: boolean;
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
  const prompts: Prompt[] = factor ? [
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
  }, [messages, motion]);

  function send(text: string, selected?: Prompt) {
    const clean = displayText(text.trim()).slice(0, 1000);
    if (!clean || offline) return;
    const reply = selected?.factor ? factorReadings[selected.factor].detail : selected
      ? home
        ? 'Homeguard brings together water and radon information. Lead is shown separately for awareness and is not included in the home score. Higher scores are better. These are sample values for reviewing the design.'
        : 'Today brings together air quality, UV, pollen, and mold conditions. Higher scores are better. The colored ring shows the share of available risk from each factor, not your personal chance of illness. These are sample values for reviewing the design.'
      : 'This preview does not generate live AI answers. Try one of the suggested questions to explore an example explanation, or open a factor page for its reading and references.';
    setMessages(current => [...current, { role: 'user', text: clean }, { role: 'assistant', text: `${missing ? 'Current readings are unavailable. This is general information. ' : ''}${reply}`, factor: selected?.factor }]);
    setDraft(''); setSuggestions(false);
  }
  function startOver() {
    setMessages([]); setDraft(''); setOptions(false); setAbout(false); setSuggestions(false); setBelow(false);
    log.current?.scrollTo({ top: 0 }); input.current?.focus();
  }
  const promptButtons = <div className="halo-luna-prompts">{prompts.map(prompt => <button key={prompt.label} disabled={offline} onClick={() => send(prompt.label, prompt)}><LunaMark size={22} /><span>{prompt.label}</span><ArrowUpRight size={17} aria-hidden="true" /></button>)}</div>;

  return <dialog ref={dialog} className="halo-luna-dialog" aria-labelledby="luna-title" aria-describedby="luna-subtitle" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
  }}>
    <header className="halo-luna-header"><LunaMark size={35} /><div className="halo-luna-identity"><div><h2 id="luna-title">Luna</h2><span className="halo-luna-preview">Preview</span></div><p id="luna-subtitle">Your HALO assistant</p></div><button className="halo-luna-icon" aria-label="Luna options" aria-expanded={options} aria-controls="luna-options" onClick={() => setOptions(value => !value)}><Ellipsis size={22} aria-hidden="true" /></button><button className="halo-luna-icon" aria-label="Close Luna" onClick={onClose} autoFocus><X size={22} aria-hidden="true" /></button></header>
    {options && <div id="luna-options" className="halo-luna-options"><button onClick={startOver}><RotateCcw size={17} aria-hidden="true" />Start a new conversation</button><button onClick={() => { setAbout(value => !value); setOptions(false); }}><Info size={17} aria-hidden="true" />About this preview</button></div>}
    {about && <aside className="halo-luna-about"><p>Example replies only. Messages stay in this open panel and are cleared when you close it. Nothing is sent to HALO’s AI backend. Avoid sharing personal or medical details.</p><button onClick={() => setAbout(false)} aria-label="Close preview information"><X size={18} aria-hidden="true" /></button></aside>}
    <div ref={log} className="halo-luna-scroll" onScroll={() => { const node = log.current; if (node) setBelow(node.scrollHeight - node.clientHeight - node.scrollTop > 100); }}>
      <p className="halo-luna-date">Today</p>
      <section className="halo-luna-welcome"><span className="halo-luna-welcome-mark"><LunaMark size={46} /></span><h3>A little clarity,<br />with Luna.</h3><p>I’m your HALO assistant. Let’s <strong>make sense of your surroundings</strong>, explore your readings, and find a useful next step.</p><p className="halo-luna-disclosure">Interactive design preview with example replies. General information, not medical advice. <button onClick={() => setAbout(true)}>How this works</button></p></section>
      <div className="halo-luna-opening"><LunaMark size={22} /><p>What would you like to understand today?</p></div>
      {!messages.length && promptButtons}
      <div className="halo-luna-messages" role="log" aria-label="Conversation with Luna" aria-live="polite" aria-relevant="additions">{messages.map((message, index) => <div className={`halo-luna-message halo-luna-message--${message.role}`} key={index}>
        {message.role === 'assistant' && <LunaMark size={24} />}<div><span className="halo-luna-message-label">{message.role === 'user' ? 'You' : 'Luna · Example reply'}</span><p>{message.text}</p>{message.factor && <a href={factorHref(message.factor)}>View {factorReadings[message.factor].title.toLowerCase()} and references <ArrowUpRight size={15} aria-hidden="true" /></a>}</div>
      </div>)}</div>
    </div>
    <footer className="halo-luna-footer">
      {below && <button className="halo-luna-latest" onClick={scrollToLatest} aria-label="Scroll to latest message"><ArrowDown size={20} aria-hidden="true" /></button>}
      {offline && <p className="halo-luna-offline" role="status">You’re offline. Reconnect before asking Luna. Your draft stays here while this panel is open.</p>}
      {suggestions && <div className="halo-luna-suggestions" id="luna-suggestions">{promptButtons}</div>}
      <form className="halo-luna-composer" onSubmit={event => { event.preventDefault(); send(draft); }}>
        <label className="halo-sr-only" htmlFor="luna-message">Message Luna</label><textarea ref={input} id="luna-message" placeholder="Ask Luna a question…" maxLength={1000} value={draft} rows={2} onChange={event => setDraft(event.target.value)} aria-describedby="luna-composer-note" onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(draft); } }} />
        <div className="halo-luna-compose-tools"><button type="button" className="halo-luna-icon" aria-label="Suggested questions" aria-expanded={suggestions} aria-controls="luna-suggestions" onClick={() => setSuggestions(value => !value)}><MessageSquarePlus size={21} aria-hidden="true" /></button><span>{draft.length > 800 ? `${draft.length}/1000` : 'A question is a good start.'}</span><button className="halo-luna-send" type="submit" aria-label="Send message" disabled={!draft.trim() || offline}><ArrowUp size={21} aria-hidden="true" /></button></div>
      </form><p id="luna-composer-note" className="halo-luna-footer-note">Luna can make mistakes. Check important information.</p>
    </footer>
  </dialog>;
}
