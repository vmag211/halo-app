'use client';

import Image from 'next/image';
import { useState } from 'react';

const photos = {
  river: { src: '/explore/neuse-river.webp', width: 1400, height: 700 },
  trail: { src: '/explore/woodland-trail.webp', width: 1000, height: 1333 },
  garden: { src: '/explore/pollinator-garden.webp', width: 1000, height: 667 },
} as const;

// Context photography, not a picture of a fictional listing or a household's location.
// Prepared locally with recorded public-domain provenance. No remote image requests.
export function ExplorePhoto({ scene, className = '', eager = false }: { scene: keyof typeof photos; className?: string; eager?: boolean }) {
  const [failed, setFailed] = useState(false);
  return <span className={`ex-photo ex-photo-${scene} ${className}`} data-photo-state={failed ? 'unavailable' : 'available'} aria-hidden="true">
    {!failed && <Image {...photos[scene]} alt="" unoptimized loading={eager ? 'eager' : 'lazy'} onError={() => setFailed(true)} />}
    {failed && <span className="ex-photo-fallback">A moment to explore</span>}
  </span>;
}

export function ExploreSketch({ kind }: { kind: 'people' | 'letter' | 'notebook' }) {
  return <svg className={`ex-sketch ex-sketch-${kind}`} viewBox="0 0 120 100" fill="none" aria-hidden="true">
    {kind === 'people' ? <>
      <path className="ex-sketch-wash" d="M12 57C7 33 31 11 62 14c31 4 51 25 47 48-3 22-38 31-62 23C25 79 17 73 12 57Z" />
      <path d="M35 48c-13 2-17 18-12 32m58-32c13 2 18 18 13 32M48 45c-14 5-18 26-13 38m33-38c14 5 18 26 13 38M45 81h28" />
      <path d="M57 21c-8 0-12 7-10 15 2 8 14 11 20 3 6-8 2-18-10-18ZM28 28c-9 0-12 13-3 18 10 6 20-12 8-17m51 0c-9-4-17 9-10 16 8 9 23-3 15-13" />
      <path d="m14 24 3-7m78 5 6-3m-45-9 1-6" />
    </> : kind === 'letter' ? <>
      <path className="ex-sketch-wash" d="M18 20c17-13 52-14 75 3 25 18 15 49-8 60-25 12-58 9-73-9C0 59 4 33 18 20Z" />
      <path className="ex-sketch-paper" d="m35 16 53 9-10 61-54-10 11-60Z" />
      <path d="m45 32 27 5m-29 8 21 4m-23 8 29 5M19 60l39 31 39-24m-80-7 1 33 80 1-1-28" />
      <path d="m20 60 7-7m70 13-12-14M97 18l-1-9m8 16 8-3" />
    </> : <>
      <path className="ex-sketch-wash" d="M21 16c20-12 49-2 62 9 16 13 31 39 19 53-16 20-72 15-88-6C-2 50 4 29 21 16Z" />
      <path className="ex-sketch-paper" d="m29 17 54 3-4 70-54-4 4-69Z" />
      <path d="m41 17-4 68m9-51 26 2m-28 10 24 2m-25 11 17 1M26 28l9 1m-10 12 9 1m-10 12 9 1m-10 12 9 1m-10 12 9 1" />
      <path d="m78 62 20-28 6 4-20 28-8 5 2-9Zm21-29 3-4 6 4-3 4M17 16l-4-7m4 57-8 2" />
    </>}
  </svg>;
}

export function ExplorePhotoCredits() {
  return <details className="ex-photo-credits"><summary>About the photos</summary><p>Real nature photography, used for atmosphere. These are not photos of the sample events, organizations or your location.</p><ul>
    <li><a href="https://commons.wikimedia.org/wiki/File:Neuse_River-27527.jpg" target="_blank" rel="noreferrer">Neuse River</a>: Ken Thomas.</li>
    <li><a href="https://www.usgs.gov/media/images/trail-abrams-falls" target="_blank" rel="noreferrer">Woodland trail</a>: Cynthia L. Cunningham, USGS.</li>
    <li><a href="https://www.fws.gov/media/pollinator-garden-0" target="_blank" rel="noreferrer">Pollinator garden</a>: Courtney Celley, USFWS.</li>
  </ul><p>Public-domain photos, resized and compressed for this review.</p></details>;
}
