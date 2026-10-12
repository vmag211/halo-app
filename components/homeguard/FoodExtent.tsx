'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { MapPin } from 'lucide-react';

/** Deliberately diagrammatic fixture geography, never a substitute for a reviewed polygon. */
export function FoodExtent({ kind, extent }: { kind: 'lake' | 'river' | 'statewide'; extent: string }) {
  const [open, setOpen] = useState(false);
  const diagramId = useId();
  const search = useSearchParams();
  const params = new URLSearchParams({ edition: 'expanded', layer: 'water' });
  for (const key of ['appearance', 'scale', 'motion', 'time', 'contrast']) {
    const value = search.get(key); if (value) params.set(key, value);
  }
  return <section className="hg-extent">
    <button type="button" className="hg-button-secondary hg-extent-toggle" aria-expanded={open} aria-controls={diagramId} onClick={() => setOpen(!open)}><MapPin size={18} aria-hidden="true" /><span>{open ? 'Hide extent diagram' : 'View extent diagram'}</span></button>
    {open && <figure id={diagramId}><figcaption><strong>How advisory boundaries work</strong><p>{extent}</p></figcaption>
      {kind === 'lake' ? <svg viewBox="0 0 320 210" role="img" aria-label="Boundary diagram: a lake's northern basin is highlighted, with the southern basin outside the highlighted area."><defs><clipPath id="hg-lake-shape"><path d="M80 22C143 10 164 52 222 37S289 87 265 119S242 194 177 193S150 160 101 162S28 116 56 91S39 40 80 22Z" /></clipPath></defs><path className="hg-extent-water" d="M80 22C143 10 164 52 222 37S289 87 265 119S242 194 177 193S150 160 101 162S28 116 56 91S39 40 80 22Z" /><g clipPath="url(#hg-lake-shape)"><rect className="hg-extent-highlight" x="20" y="0" width="280" height="103" /><path d="M32 103H290" stroke="currentColor" strokeDasharray="6 5" /></g><text x="160" y="79">Northern basin</text><text x="164" y="147">Outside the boundary</text></svg> : kind === 'river' ? <svg viewBox="0 0 320 210" role="img" aria-label="Boundary diagram: a river reach between two bridges is highlighted, excluding the upstream and downstream areas."><path className="hg-river-line" d="M-10 38C70 5 80 77 150 84S235 104 228 144S278 188 330 179" /><path className="hg-river-highlight" d="M85 53C109 73 123 81 150 84S222 97 228 118" /><path d="M66 65L95 37M210 125L246 110" stroke="currentColor" strokeWidth="3" /><text x="64" y="99">Bridge A</text><text x="263" y="91">Bridge B</text><text x="154" y="175">Defined river reach</text></svg> : <p className="hg-notice">Statewide guidance and local advisories are checked separately.</p>}
      <p className="hg-meta">Concept diagram, not to scale. The official advisory defines the actual boundary.</p>
      <Link className="hg-source-link" href={`/foundation/preview/map?${params}`}>Open the environmental map</Link><p className="hg-meta">Fish boundaries are not available on the map. Your selection is kept when you return.</p>
    </figure>}
  </section>;
}
