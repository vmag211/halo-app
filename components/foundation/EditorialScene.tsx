'use client';

import { useEffect, useRef, useState } from 'react';
import { useSceneExperience } from './SceneExperience';
import { useImageReadiness } from './useImageReadiness';
import './editorial-scene.css';

const scenes = {
  'care-playroom': { file: 'care-playroom', atmosphere: 'canopy' },
  'care-study': { file: 'care-study', atmosphere: 'light' },
  'care-rest': { file: 'care-rest', atmosphere: 'canopy' },
  'care-garden': { file: 'care-garden', atmosphere: 'canopy' },
  air: { file: 'air-editorial', atmosphere: 'air' },
  water: { file: 'pfas-editorial', atmosphere: 'water' },
  ground: { file: 'home-radon-editorial', atmosphere: 'light' },
  facilities: { file: 'community-facilities', atmosphere: 'light' },
  uv: { file: 'uv-editorial', atmosphere: 'light' },
  pollen: { file: 'pollen-editorial', atmosphere: 'canopy' },
  mold: { file: 'mold-editorial', atmosphere: 'canopy' },
} as const;

export type EditorialSceneKind = keyof typeof scenes;
type NetworkConnection = EventTarget & { saveData?: boolean };

/** Decorative setting, not a household portrait, source image or measured condition. */
export default function EditorialScene({ scene, className = '', eager = false }: {
  scene: EditorialSceneKind; className?: string; eager?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const experience = useSceneExperience();
  const [visible, setVisible] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(true);
  const [restricted, setRestricted] = useState(false);
  const artwork = scenes[scene];
  const source = `/preview-scenes/${artwork.file}.webp`;
  const {ref:imageRef,loaded,failed} = useImageReadiness(source);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const app = element.closest('.halo-f-app');
    const forced = matchMedia('(forced-colors: active)');
    const contrast = matchMedia('(prefers-contrast: more)');
    const connection = (navigator as Navigator & { connection?: NetworkConnection }).connection;
    const update = () => setRestricted(Boolean(connection?.saveData || forced.matches || contrast.matches || app?.getAttribute('data-contrast') === 'high'));
    const visibility = () => setDocumentVisible(!document.hidden);
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)), { threshold: .05 });
    const changes = new MutationObserver(update);
    if (app) changes.observe(app, { attributes: true, attributeFilter: ['data-contrast'] });
    observer.observe(element); update(); visibility();
    forced.addEventListener('change', update); contrast.addEventListener('change', update);
    connection?.addEventListener('change', update); document.addEventListener('visibilitychange', visibility);
    return () => {
      observer.disconnect(); changes.disconnect();
      forced.removeEventListener('change', update); contrast.removeEventListener('change', update);
      connection?.removeEventListener('change', update); document.removeEventListener('visibilitychange', visibility);
    };
  }, []);

  const moving = experience.motion && !experience.deviceReduced && visible && documentVisible && !restricted && loaded;
  return <div ref={root} className={`halo-editorial-scene ${className}`} data-editorial-scene={scene} data-atmosphere={artwork.atmosphere} data-moving={moving} data-failed={failed} aria-hidden="true">
    {/* Local, generated artwork needs no remote optimizer and reserves its space before loading. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img ref={imageRef} key={scene} src={source} alt="" width={1536} height={1024} loading={eager ? 'eager' : 'lazy'} decoding="async" draggable={false} />
    <span className="halo-editorial-scene-light" />
    <span className="halo-editorial-scene-haze" />
    <span className="halo-editorial-scene-reflection"><i /><i /><i /></span>
    <span className="halo-editorial-scene-shade" />
    <span className="halo-editorial-scene-edge" />
  </div>;
}
