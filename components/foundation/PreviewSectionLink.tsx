'use client';

import type { ReactNode, MouseEvent } from 'react';
import { useSceneExperience } from './SceneExperience';

/** Real fragment links with explicit, header-aware scrolling and keyboard focus. */
export default function PreviewSectionLink({ target, children, className, label }: { target: string; children: ReactNode; className?: string; label?: string }) {
  const { motion } = useSceneExperience();
  function jump(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const destination = document.getElementById(target);
    if (!destination) return;
    event.preventDefault();
    const header = destination.closest('.halo-f-app')?.querySelector('.halo-f-header');
    destination.style.scrollMarginTop = `${(header?.getBoundingClientRect().height ?? 64) + 20}px`;
    destination.focus({ preventScroll: true });
    destination.scrollIntoView({ behavior: motion ? 'smooth' : 'instant', block: 'start' });
    const url = new URL(window.location.href);
    url.hash = target;
    window.history.replaceState(window.history.state, '', url);
  }
  return <a href={`#${target}`} className={className} aria-label={label} onClick={jump}>{children}</a>;
}
