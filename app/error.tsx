'use client';
import Link from 'next/link';
export default function ErrorPage({retry}:{error:Error&{digest?:string};retry:()=>void}){return <main className="halo-status-page"><h1>This page needs another try</h1><p>HALO could not open this screen. A failed screen does not confirm a save.</p><button type="button" onClick={retry}>Try again</button><p><Link href="/plan">Return to My Week</Link></p></main>;}
