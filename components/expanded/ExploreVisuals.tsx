'use client';

import Image from 'next/image';
import { useState } from 'react';
import { explorePhotos, photoForScene, type ExplorePhotoScene } from '@/lib/frontend/explore-photos';

// Context photography, not a picture of a fictional listing or a household's location.
// Prepared locally with recorded public-domain provenance. No remote image requests.
export function ExplorePhoto({ scene, className = '', eager = false }: { scene: ExplorePhotoScene; className?: string; eager?: boolean }) {
  const [failedScene, setFailedScene] = useState<ExplorePhotoScene | null>(null); const failed = failedScene === scene;
  const photo = photoForScene(scene);
  return <span className={`ex-photo ex-photo-${scene} ${className}`} data-photo-scene={scene} data-photo-state={failed ? 'unavailable' : 'available'} aria-hidden="true">
    {!failed && <Image key={scene} src={`/explore/${photo.file}`} width={photo.width} height={photo.height} alt="" unoptimized loading={eager ? 'eager' : 'lazy'} onError={() => setFailedScene(scene)} />}
    {failed && <span className="ex-photo-fallback">A moment to explore</span>}
  </span>;
}

export function ExplorePhotoCredits() {
  return <details className="ex-photo-credits"><summary>About the photos</summary><p>Real photography for context. These are not photos of the organizations, your chosen projects or your location. The solar cooker and bee nesting photos show examples, not the builds described in the guides.</p><ul>{explorePhotos.map(photo => <li key={photo.id}><a href={photo.source} target="_blank" rel="noreferrer">{photo.title}</a>: {photo.credit}. {'licenseUrl' in photo && photo.licenseUrl ? <a href={photo.licenseUrl} target="_blank" rel="noreferrer">{photo.license}</a> : photo.license}.</li>)}</ul><p>Resized, metadata removed and compressed to WebP. New photos have orientation normalized. Display crops use CSS. No image content was generated.</p></details>;
}
