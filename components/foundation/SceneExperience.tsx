'use client';

import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { sceneClockAt, type MotionMode, type SceneClock, type SceneTime } from '@/lib/frontend/scene-clock';

type Experience = { clock: SceneClock; enabled: boolean; motion: boolean; paused: boolean; togglePaused: () => void; deviceReduced: boolean; ready: boolean };
const initialClock: SceneClock = { phase: 'day', daylight: 1, warmth: 0, progress: .5, label: 'Local time' };
const SceneContext = createContext<Experience>({ clock: initialClock, enabled: false, motion: false, paused: false, togglePaused: () => {}, deviceReduced: false, ready: false });
export function SceneProvider({ children, mode, time }: { children: ReactNode; mode: MotionMode; time: SceneTime }) {
  const [clock, setClock] = useState(initialClock);
  const [deviceReduced, setDeviceReduced] = useState(false);
  const [paused, setPaused] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = () => setDeviceReduced(media.matches);
    const updateClock = () => setClock(sceneClockAt(new Date(), time));
    // Hydration stays deterministic. Subscribe to the browser on its first frame.
    const firstFrame = requestAnimationFrame(() => { updatePreference(); updateClock(); setReady(true); });
    const timer = window.setInterval(updateClock, 30_000);
    const visible = () => { if (!document.hidden) updateClock(); };
    document.addEventListener('visibilitychange', visible); media.addEventListener('change', updatePreference);
    return () => { cancelAnimationFrame(firstFrame); clearInterval(timer); media.removeEventListener('change', updatePreference); document.removeEventListener('visibilitychange', visible); };
  }, [time]);
  const enabled = ready && mode !== 'reduce' && (mode === 'full' || !deviceReduced);
  const motion = enabled && !paused;
  return <SceneContext.Provider value={{ clock, enabled, motion, paused, togglePaused: () => setPaused(p => !p), deviceReduced, ready }}>{children}</SceneContext.Provider>;
}
export function useSceneExperience() { return useContext(SceneContext); }

/** One entrance per mount, triggered near the viewport. Content remains visible without JS. */
export function Reveal({ children, delay = 0, className = '' }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const { enabled: motion, ready } = useSceneExperience();
  useEffect(() => {
    if (!ref.current) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { threshold: .08 });
    observer.observe(ref.current); return () => observer.disconnect();
  }, []);
  return <div ref={ref} className={`halo-reveal ${className}`} data-reveal={visible ? 'visible' : 'waiting'} data-animate={ready && motion} style={{ '--reveal-delay': `${delay}ms` } as CSSProperties}>{children}</div>;
}

/** Accessible final value stays stable while the decorative digits count upward. */
export function AnimatedNumber({ value, delay = 0 }: { value: number; delay?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(value);
  const { enabled: motion, ready } = useSceneExperience();
  useEffect(() => {
    const target = ref.current;
    if (!ready || !target) return;
    if (!motion) return;
    let frame = 0; let timer = 0;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(e => e.isIntersecting)) return;
      observer.disconnect(); setDisplay(0);
      timer = window.setTimeout(() => {
        const start = performance.now();
        const tick = (now: number) => {
          const progress = Math.min(1, (now - start) / 1050);
          setDisplay(Math.round(value * (1 - Math.pow(1 - progress, 3))));
          if (progress < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      }, delay);
    }, { threshold: .3 });
    observer.observe(target);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [value, delay, motion, ready]);
  return <span ref={ref} className="halo-number" aria-label={String(value)}><span aria-hidden="true">{motion ? display : value}</span></span>;
}
