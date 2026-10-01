'use client';

import { useId } from 'react';
import { useSceneExperience } from './SceneExperience';
import './rising-sun.css';

/** Decorative sunrise, independent of the forecast and the device's local time. */
export default function RisingSun() {
  const id = useId();
  const { enabled, motion } = useSceneExperience();
  return <svg className="halo-rising-sun" viewBox="0 0 360 148" aria-hidden="true" focusable="false" data-animate={enabled} data-moving={motion}>
    <defs>
      <linearGradient id={`${id}-warmth`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="var(--sun-light)" /><stop offset="1" stopColor="var(--sun-warm)" /></linearGradient>
      <linearGradient id={`${id}-horizon`}><stop stopColor="var(--sun-line)" stopOpacity="0" /><stop offset=".5" stopColor="var(--sun-line)" stopOpacity=".7" /><stop offset="1" stopColor="var(--sun-line)" stopOpacity="0" /></linearGradient>
      <clipPath id={`${id}-sky`}><path d="M0 0H360V124H0Z" /></clipPath>
    </defs>
    <g clipPath={`url(#${id}-sky)`}>
      <g className="halo-rising-sun-rays" stroke="var(--sun-line)" strokeWidth="2" strokeLinecap="round">{[10, 30, 50, 70, 90, 110, 130, 150, 170].map(angle => {
        const radians = angle * Math.PI / 180;
        return <line key={angle} x1={180 + Math.cos(radians) * 84} y1={124 - Math.sin(radians) * 84} x2={180 + Math.cos(radians) * 102} y2={124 - Math.sin(radians) * 102} />;
      })}</g>
      <circle className="halo-rising-sun-disc" cx="180" cy="124" r="65" fill={`url(#${id}-warmth)`} />
      <path d="M122 116a59 59 0 0 1 116 0" fill="none" stroke="var(--sun-light)" strokeWidth="1" opacity=".65" />
    </g>
    <path d="M24 124H336" stroke={`url(#${id}-horizon)`} strokeWidth="1.5" />
    <path d="M142 134H218M158 141H202" stroke="var(--sun-line)" strokeWidth="1.5" strokeLinecap="round" opacity=".25" />
  </svg>;
}
