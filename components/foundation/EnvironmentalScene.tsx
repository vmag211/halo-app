'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useSceneExperience } from './SceneExperience';
import './environmental-scene.css';

export type EnvironmentalVariant = 'landscape' | 'home' | 'air' | 'uv' | 'pollen' | 'mold' | 'pfas' | 'radon' | 'lead';
const photos: Record<EnvironmentalVariant, string> = { landscape: 'personal-hero-editorial', home: 'home-radon-editorial', air: 'air-editorial', uv: 'uv-editorial', pollen: 'pollen-editorial', mold: 'mold-editorial', pfas: 'pfas-editorial', radon: 'home-radon-editorial', lead: 'lead-editorial' };

/** Decorative atmosphere, never a visualization of measured contamination. */
export default function EnvironmentalScene({ variant = 'landscape', page = false }: { variant?: EnvironmentalVariant; page?: boolean }) {
  const { clock, motion } = useSceneExperience();
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  const [activeTab, setActiveTab] = useState(true);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => setVisible(entries.some(e => e.isIntersecting)));
    if (ref.current) observer.observe(ref.current);
    const visibility = () => setActiveTab(!document.hidden);
    visibility(); document.addEventListener('visibilitychange', visibility);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', visibility); };
  }, []);
  const style = { '--scene-image': `url('/preview-scenes/${photos[variant]}.webp')`, '--daylight': clock.daylight, '--night': 1 - clock.daylight, '--warmth': clock.warmth } as CSSProperties;
  const sky = ['landscape', 'air', 'uv', 'pollen', 'pfas'].includes(variant);
  return <div ref={ref} className={`halo-env halo-env--${variant}${page ? ' halo-env--page' : ''}`} data-phase={clock.phase} data-moving={motion && visible && activeTab} aria-hidden="true" style={style}>
    <div className="halo-env__photo" />
    {!page && <><div className="halo-env__night" /><div className="halo-env__warmth" />
      {sky && <><div className="halo-env__sun" /><div className="halo-env__moon" /><div className="halo-env__stars" />
        <div className="halo-env__cloud halo-env__cloud--near" /><div className="halo-env__cloud halo-env__cloud--far" /></>}
      {variant === 'uv' && <div className="halo-env__rays" />}
      {['air', 'landscape'].includes(variant) && <svg className="halo-env__birds" viewBox="0 0 180 50" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M8 28q7-9 14 0 7-9 14 0M62 14q5-7 11 0 5-7 11 0M108 35q5-7 10 0 6-7 12 0" /></svg>}
      {['landscape', 'pfas'].includes(variant) && <div className="halo-env__reflections" />}
      {['mold', 'air'].includes(variant) && <div className="halo-env__mist" />}
      {['home', 'lead', 'radon', 'uv'].includes(variant) && <div className="halo-env__window-light" />}
    </>}
    <div className="halo-env__particles">{Array.from({ length: page ? 9 : 18 }, (_, i) => <i key={i} style={{ '--x': `${(i * 47 + 7) % 100}%`, '--y': `${(i * 31 + 19) % 100}%`, '--duration': `${12 + i % 7 * 2}s`, '--delay': `${-i * 1.7}s`, '--size': `${1.5 + (i % 4) * .6}px` } as CSSProperties} />)}</div>
    {!page && <div className="halo-env__veil" />}
  </div>;
}
