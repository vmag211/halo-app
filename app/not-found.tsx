import Link from 'next/link';
export default function NotFound(){return <main style={{maxWidth:430,margin:'4rem auto',padding:24,fontFamily:'Arial,sans-serif'}}><h1>This page isn’t here</h1><p>The link may have changed or the item may no longer be available.</p><Link href="/plan">Open My Week</Link><p><Link href="/learn">Browse public information</Link></p></main>;}
