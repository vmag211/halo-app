'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Pause, Play } from 'lucide-react';
import { useSceneExperience } from '@/components/foundation/SceneExperience';
import { landscapeCrop, landscapeWave, WEEK_SCENE_DISSOLVE_MS, WEEK_SCENE_DWELL_MS, weekAmbienceCopy as copy, weekLandscapes, type WeekLandscape } from '@/lib/frontend/week-ambience';
import './week-ambience.css';

type Connection = EventTarget & { saveData?: boolean };
type NetworkNavigator = Navigator & { connection?: Connection };

/** The photograph stays intact. Only a hand-masked water region is displaced. */
function WaterSurface({ image, scene, moving }: { image: HTMLImageElement | null; scene: WeekLandscape; moving: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phase = useRef(0);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    // Canvas is an enhancement. The independent image remains when it is unavailable.
    let context: CanvasRenderingContext2D | null;
    try { context = canvas.getContext('2d'); } catch { return; }
    if (!context) return;
    const source = document.createElement('canvas');
    let sourceContext: CanvasRenderingContext2D | null;
    try { sourceContext = source.getContext('2d'); } catch { return; }
    if (!sourceContext) return;
    let width = 0, height = 0, ratio = 1, frame = 0, previous = 0, failed = false;
    let crop = landscapeCrop(image.naturalWidth, image.naturalHeight, 1, 1);
    const paint = () => {
      if (!width || !height || failed) return;
      try {
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      context.save(); context.beginPath();
      scene.water.forEach(([x, y], index) => {
        const dx = crop.x + x * image.naturalWidth * crop.scale;
        const dy = crop.y + y * image.naturalHeight * crop.scale;
        if (index) context.lineTo(dx, dy); else context.moveTo(dx, dy);
      });
      context.closePath(); context.clip();
      const waterTop = Math.max(0, crop.y + scene.waterline * image.naturalHeight * crop.scale);
      // Bounded rows and pixel ratio keep this inexpensive on a mobile-size canvas.
      for (let y = waterTop; y < height; y += 3) {
        const strip = Math.min(3, height - y);
        const offset = landscapeWave(y - waterTop, height - waterTop, phase.current, scene.id === 'forest' ? .7 : 1);
        context.drawImage(source, 0, y * ratio, source.width, strip * ratio, offset, y, width, strip);
      }
      context.restore();
      } catch {
        // Drawing or memory failure must not affect the underlying image or app.
        failed = true; canvas.style.visibility = 'hidden';
      }
    };
    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = bounds.width; height = bounds.height;
      if (!width || !height) return;
      ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = source.width = Math.ceil(width * ratio);
      canvas.height = source.height = Math.ceil(height * ratio);
      crop = landscapeCrop(image.naturalWidth, image.naturalHeight, width, height);
      try {
        sourceContext.setTransform(ratio, 0, 0, ratio, 0, 0);
        sourceContext.clearRect(0, 0, width, height);
        sourceContext.drawImage(image, crop.x, crop.y, image.naturalWidth * crop.scale, image.naturalHeight * crop.scale);
        paint();
      } catch { failed = true; canvas.style.visibility = 'hidden'; }
    };
    const tick = (now: number) => {
      if (!previous) previous = now;
      const elapsed = now - previous;
      if (elapsed >= 1000 / 24) {
        phase.current += Math.min(elapsed, 100) / 1000;
        previous = now; paint();
      }
      if (!failed) frame = requestAnimationFrame(tick);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas); resize();
    if (moving) frame = requestAnimationFrame(tick);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [image, scene, moving]);
  return <canvas className="mw-ambience-water" ref={canvasRef} aria-hidden="true" data-running={moving && Boolean(image)} />;
}

function LandscapeLayer({ scene, pending, moving, dissolve, revealing, onReady, onError }: {
  scene: WeekLandscape; pending: boolean; moving: boolean; dissolve: boolean; revealing: boolean;
  onReady: (id: string) => void; onError: (id: string) => void;
}) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    // A very quick next action can revisit the still-mounted outgoing layer.
    if (pending && image && !failed) onReady(scene.id);
  }, [pending, image, failed, onReady, scene.id]);
  return <div className="mw-ambience-layer" data-landscape={scene.id} data-pending={pending} data-dissolve={dissolve} data-revealing={revealing} data-failed={failed} aria-hidden="true">
    {/* Decorative art is kept separate from the assistant, data and task models. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={scene.src} alt="" decoding="async" draggable={false} onLoad={event => { setImage(event.currentTarget); onReady(scene.id); }} onError={() => { setFailed(true); onError(scene.id); }} />
    {!failed && <WaterSurface image={image} scene={scene} moving={moving && !pending} />}
    <span className="mw-ambience-haze mw-ambience-haze-back" />
    <span className="mw-ambience-haze mw-ambience-haze-front" />
    <span className="mw-ambience-light" />
    <svg className="mw-ambience-reeds" viewBox="0 0 430 220" preserveAspectRatio="none">
      <g className="mw-ambience-reed-left"><path d="M4 220Q12 186 5 154M7 219Q22 191 28 170M8 211Q24 191 35 193M4 207Q-3 182 0 172" /></g>
      <g className="mw-ambience-reed-right"><path d="M423 220Q414 187 424 166M420 218Q407 185 402 179M418 207Q401 196 397 199M424 210Q432 191 430 181" /></g>
    </svg>
  </div>;
}

/** Optional scene rotation is measured only while visible and allowed to move. */
export default function WeekAmbience({ children, className = '' }: { children?: ReactNode; className?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const experience = useSceneExperience();
  const [visible, setVisible] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(true);
  const [restricted, setRestricted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [current, setCurrent] = useState(0);
  const [previous, setPrevious] = useState<number | null>(null);
  const [incoming, setIncoming] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [dissolve, setDissolve] = useState(false);
  const manual = useRef(false);
  const attempted = useRef(0);
  const remaining = useRef(WEEK_SCENE_DWELL_MS);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const allowed = experience.motion && !experience.deviceReduced && !restricted;
  const moving = allowed && visible && documentVisible && !paused;

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const app = element.closest('.halo-f-app');
    const forced = matchMedia('(forced-colors: active)');
    const contrast = matchMedia('(prefers-contrast: more)');
    const connection = (navigator as NetworkNavigator).connection;
    const update = () => setRestricted(Boolean(connection?.saveData || forced.matches || contrast.matches || app?.getAttribute('data-contrast') === 'high'));
    const visibility = () => setDocumentVisible(!document.hidden);
    const intersection = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)), { threshold: .05 });
    const changes = new MutationObserver(update);
    if (app) changes.observe(app, { attributes: true, attributeFilter: ['data-contrast'] });
    intersection.observe(element); update(); visibility();
    forced.addEventListener('change', update); contrast.addEventListener('change', update);
    connection?.addEventListener('change', update); document.addEventListener('visibilitychange', visibility);
    return () => {
      intersection.disconnect(); changes.disconnect();
      forced.removeEventListener('change', update); contrast.removeEventListener('change', update);
      connection?.removeEventListener('change', update); document.removeEventListener('visibilitychange', visibility);
    };
  }, []);

  useEffect(() => () => { if (fadeTimer.current) clearTimeout(fadeTimer.current); }, []);
  const advance = useCallback((fromUser: boolean) => {
    if (incoming !== null) return;
    manual.current = fromUser;
    setAnnouncement('');
    attempted.current = (attempted.current + 1) % weekLandscapes.length;
    if (attempted.current === current) attempted.current = (attempted.current + 1) % weekLandscapes.length;
    if (attempted.current === previous) setPrevious(null);
    setIncoming(attempted.current);
  }, [incoming, current, previous]);

  useEffect(() => {
    if (!moving || incoming !== null || previous !== null) return;
    const start = performance.now();
    const timer = window.setTimeout(() => advance(false), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (performance.now() - start));
    };
  }, [moving, incoming, previous, current, advance]);

  useEffect(() => {
    if (incoming === null) return;
    // A stalled asset cannot leave the only scene-navigation button busy forever.
    const timeout = setTimeout(() => {
      setIncoming(null); remaining.current = WEEK_SCENE_DWELL_MS;
      if (manual.current) setAnnouncement(copy.unavailable);
    }, 12_000);
    return () => clearTimeout(timeout);
  }, [incoming]);

  const ready = (id: string) => {
    if (incoming === null || weekLandscapes[incoming].id !== id) return;
    const animate = moving;
    if (fadeTimer.current) clearTimeout(fadeTimer.current);
    setPrevious(animate ? current : null); setDissolve(animate);
    setCurrent(incoming); setIncoming(null); remaining.current = WEEK_SCENE_DWELL_MS;
    if (manual.current) setAnnouncement(copy.changed(weekLandscapes[incoming].name));
    if (animate) fadeTimer.current = setTimeout(() => { setPrevious(null); setDissolve(false); }, WEEK_SCENE_DISSOLVE_MS);
  };
  const failed = (id: string) => {
    if (incoming !== null && weekLandscapes[incoming].id === id) {
      // Keep the usable scene; retry only after another deliberate next action/dwell.
      setIncoming(null); remaining.current = WEEK_SCENE_DWELL_MS;
      if (manual.current) setAnnouncement(copy.unavailable);
    }
  };
  const indices = [previous, current, incoming].filter((index): index is number => index !== null);
  return <div className={`mw-ambience ${className}`} ref={root} data-scene={weekLandscapes[current].id} data-moving={moving} data-rotation={moving && incoming === null && previous === null} data-dissolve={dissolve && moving}>
    <div className="mw-ambience-art" aria-hidden="true">
      {indices.map(index => <LandscapeLayer key={weekLandscapes[index].id} scene={weekLandscapes[index]} pending={index === incoming} moving={moving} dissolve={moving} revealing={index === current && previous !== null} onReady={ready} onError={failed} />)}
      <div className="mw-ambience-shade" />
    </div>
    <div className="mw-ambience-controls" role="group" aria-label={copy.controls} aria-busy={incoming !== null}>
      <span className="mw-ambience-name">{weekLandscapes[current].name}</span>
      {allowed && <button type="button" aria-label={paused ? copy.resume : copy.pause} aria-pressed={paused} onClick={() => setPaused(value => !value)}>{paused ? <Play size={15} fill="currentColor" /> : <Pause size={15} />}</button>}
      <button type="button" aria-label={copy.next} disabled={incoming !== null} onClick={() => advance(true)}><ArrowRight size={17} /></button>
    </div>
    {children && <div className="mw-ambience-content">{children}</div>}
    <span className="mw-ambience-sr" role="status" aria-live="polite" aria-atomic="true">{announcement}</span>
  </div>;
}
