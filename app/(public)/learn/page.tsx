import {ProductionLearnEntry} from '@/components/production/PublicFrontend';
import {Suspense} from 'react';
export const metadata={title:'Learn with HALO'};
export default function Page(){return <Suspense fallback={<p role="status">Opening public information…</p>}><ProductionLearnEntry/></Suspense>;}
