import {notFound,redirect} from 'next/navigation';
export default function Page(){
 if(process.env.NODE_ENV==='production'&&process.env.HALO_ENABLE_FRONTEND_PREVIEW!=='1')notFound();
 redirect('/foundation/preview/expanded/');
}
