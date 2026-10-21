import {Suspense} from 'react';
import {ProductionMapEntry} from '@/components/production/PublicFrontend';
export const metadata={title:'Environmental map'};
export default function Page(){return <Suspense fallback={<p role="status">Opening the map…</p>}><ProductionMapEntry/></Suspense>;}
