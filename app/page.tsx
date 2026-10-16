import Link from 'next/link';
import Image from 'next/image';
import {ArrowRight,House,Leaf,CalendarDays} from 'lucide-react';
import './landing.css';
export default function Home(){
 return <main className="halo-landing">
  <header><Link href="/" aria-label="HALO homepage"><span className="halo-landing-mark" aria-hidden="true"/><strong>HALO</strong></Link><Link className="halo-landing-open" href="/app">Open HALO <ArrowRight size={18} aria-hidden="true"/></Link></header>
  <section className="halo-landing-intro"><div><p className="halo-landing-kicker">Your environment. Your next step.</p><h1>Understand your surroundings.<br/>Care for your home.</h1><p>Bring local environmental information, household records and practical action together in one place.</p><div className="halo-landing-actions"><Link className="halo-landing-start" href="/onboarding?entry=1&next=%2Fapp">Get started <ArrowRight size={18} aria-hidden="true"/></Link><Link href="/learn">Explore the learning library</Link></div></div><div className="halo-landing-art"><Image src="/preview-scenes/week-meadow.webp" alt="" fill priority sizes="(max-width: 767px) 100vw, 50vw"/></div></section>
  <section className="halo-landing-paths" aria-label="What you can do with HALO"><article><Leaf size={23} aria-hidden="true"/><h2>Understand the evidence</h2><p>Read environmental conditions with their dates, sources and limits.</p></article><article><House size={23} aria-hidden="true"/><h2>Follow up at home</h2><p>Keep tests, results and home care connected to the next useful action.</p></article><article><CalendarDays size={23} aria-hidden="true"/><h2>Make room for action</h2><p>Organize projects, volunteering and household follow-ups in My Week.</p></article></section>
  <footer><span>HALO</span><Link href="/map">Browse the public map</Link><Link href="/learn">Learn</Link></footer>
 </main>;
}
