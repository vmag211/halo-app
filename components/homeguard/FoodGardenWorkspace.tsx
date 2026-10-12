'use client';

import { Droplets, Fish, Flower2, Leaf, Sprout } from 'lucide-react';
import { type FoodFollow, type GardenSite, initialGardens } from '../../lib/frontend/home-food-preview';
import { useHomeCollection, useHomeDraft } from './HomeWorkspaceState';
import { PageIntro, WorkspaceLink, type WorkspaceProps } from './HomeWorkspaceUI';
import { FoodDetails, FoodPreviewNote } from './FoodShared';
import { FoodFish } from './FoodFish';
import { FoodGarden } from './FoodGarden';
import { FoodEvidence } from './FoodEvidence';
import { FoodGrower } from './FoodGrower';
import { FoodWater } from './FoodWater';
import { FoodPantry } from './FoodPantry';
import './food-polish.css';
import { type WorkspaceArtworkKind } from './WorkspaceArtwork';

const destinations = [
  { view: 'fish', title: 'Fish advisories', detail: 'Find advice for a waterbody and species.', icon: Fish },
  { view: 'gardens', title: 'My garden', detail: 'Connect your soil, water and test records.', icon: Sprout },
  { view: 'evidence', title: 'Food notices & studies', detail: 'Check PFAS evidence, product notices and their limits.', icon: Leaf },
  { view: 'growers', title: 'Testing & grower support', detail: 'Find a service and prepare your questions.', icon: Flower2 },
  { view: 'water', title: 'Water & conservation', detail: 'Understand local notices and track water use.', icon: Droplets },
];
const destinationArtwork: Record<string, WorkspaceArtworkKind> = { fish: 'fish', gardens: 'garden', evidence: 'evidence', growers: 'grower', water: 'water' };
export default function FoodGardenWorkspace(props: WorkspaceProps) {
  if (props.view.startsWith('pantry')) return <FoodPantry {...props} />;
  if (props.view.startsWith('fish')) return <FoodFish {...props} />;
  if (props.view.startsWith('garden')) return <FoodGarden {...props} />;
  if (props.view.startsWith('evidence')) return <FoodEvidence {...props} />;
  if (props.view.startsWith('grower')) return <FoodGrower {...props} />;
  if (props.view === 'water' || props.view.startsWith('usage')) return <FoodWater {...props} />;
  return <FoodOverview {...props} />;
}
function FoodOverview({ navigate }: WorkspaceProps) {
  const [interests, setInterests] = useHomeDraft<string[]>('food-interests', []);
  const follows = useHomeCollection<FoodFollow>('foodFollows', []);
  const gardens = useHomeCollection<GardenSite>('gardens', initialGardens);
  const saved = follows.records.filter(item => item.saved || item.following);
  return <div className="hg-stack"><PageIntro eyebrow="FOOD & GARDEN" title="Food, water & what you grow" description="Explore PFAS information, keep useful records and choose a practical next step." icon={<Sprout />} /><FoodPreviewNote />
    <section className="hg-kitchen-entry"><span className="hg-kicker">START IN YOUR KITCHEN</span><WorkspaceLink title="Food at home" detail="Your foods, PFAS and lead information, and follow-up questions." artwork="pantry" onClick={() => navigate('pantry')} /><p className="hg-meta">A food name alone cannot tell us its PFAS or lead content.</p></section>
    <section className="hg-stack"><h2>Explore food & garden</h2><div className="hg-food-destinations">{[...destinations].sort((a, b) => Number(interests.includes(b.view)) - Number(interests.includes(a.view))).map(item => <WorkspaceLink key={item.view} title={item.title} detail={item.detail} artwork={destinationArtwork[item.view]} onClick={() => navigate(item.view)} />)}</div></section>
    {(saved.length > 0 || gardens.records.length > 0) && <section className="hg-card"><h2>Your saved places & references</h2><div className="hg-stack">{gardens.records.map(site => <WorkspaceLink key={site.id} deletion={{ remove: () => gardens.remove(site.id), description: 'This removes this growing site and its notes. Test records, saved My Week actions and grower inquiries are kept.' }} title={site.title} detail={`${site.setup} · Irrigation: ${site.irrigation}`} icon={<Sprout />} onClick={() => navigate('garden-detail', site.id)} />)}{saved.map(item => <WorkspaceLink key={item.id} title={item.title} detail={`${item.saved ? 'Saved' : ''}${item.saved && item.following ? ' · ' : ''}${item.following ? 'Following in preview' : ''} · Version ${item.sourceRevision}`} onClick={() => navigate(item.kind === 'fish' ? 'fish-detail' : item.kind === 'food' ? 'evidence-detail' : item.kind === 'resource' ? 'grower-detail' : 'water', item.targetId)} />)}</div></section>}
    <FoodDetails title="Arrange your topics"><p>Move your interests to the top. All topics remain available.</p><div className="hg-actions">{destinations.map(({ view, title }) => <button key={view} className="hg-button-secondary" aria-pressed={interests.includes(view)} onClick={() => setInterests(interests.includes(view) ? interests.filter(value => value !== view) : [...interests, view])}>{title}</button>)}</div></FoodDetails>
    <FoodDetails title="How food information works"><p>Notices apply to named products or places. Studies apply to the samples they tested. Neither tells us the contents of an untested food, crop or garden.</p><p>Missing coverage means unknown, not free of PFAS. Following a reference in this preview saves your interest but does not monitor a source or send notifications.</p></FoodDetails>
  </div>;
}
