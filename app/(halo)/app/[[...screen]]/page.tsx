import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {productRoute} from '@/lib/frontend/product-routes';

type Props={params:Promise<{screen?:string[]}>};
const titles:Record<string,string>={'/plan':'My Week','/today':'Today','/home':'Homeguard','/act':'Explore','/settings':'Settings'};
export async function generateMetadata({params}:Props):Promise<Metadata>{
 const {screen=[]}=await params;const path=`/app${screen.length?`/${screen.join('/')}`:''}`;const route=productRoute(path);
 return {title:route?.destination?route.destination[0].toUpperCase()+route.destination.slice(1):titles[route?.legacy??'']??'Page unavailable',robots:{index:false,follow:false}};
}
export default async function Page({params}:Props){
 const {screen=[]}=await params;if(!productRoute(`/app${screen.length?`/${screen.join('/')}`:''}`))notFound();return null;
}
