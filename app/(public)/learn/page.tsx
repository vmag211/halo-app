import {ProductionLearnEntry} from '@/components/production/PublicFrontend';
import {Suspense} from 'react';
import HaloLoading from '@/components/ui/HaloLoading';
export const metadata={title:'Learn with HALO'};
export default function Page(){return <Suspense fallback={<div className="halo-app"><HaloLoading layout="screen" label="Opening public information" /></div>}><ProductionLearnEntry/></Suspense>;}
