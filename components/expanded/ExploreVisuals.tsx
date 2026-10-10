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

export function ExplorePhotoCredits() {
  return <details className="ex-photo-credits"><summary>About the photos</summary><p>Real nature photography, used for atmosphere. These are not photos of the organizations, projects or your location. They do not indicate current conditions.</p><ul>
    <li><a href="https://commons.wikimedia.org/wiki/File:Neuse_River-27527.jpg" target="_blank" rel="noreferrer">Neuse River</a>: Ken Thomas.</li>
    <li><a href="https://www.usgs.gov/media/images/trail-abrams-falls" target="_blank" rel="noreferrer">Woodland trail</a>: Cynthia L. Cunningham, USGS.</li>
    <li><a href="https://www.fws.gov/media/pollinator-garden-0" target="_blank" rel="noreferrer">Pollinator garden</a>: Courtney Celley, USFWS.</li>
  </ul><p>Public-domain photos, resized and compressed for this review.</p></details>;
}
