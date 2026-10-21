import { notFound } from 'next/navigation';
import MapPreview from '@/components/map-preview/MapPreview';
export const metadata = { title: 'Map wireframe' };
export default function Page() {
  if (process.env.NODE_ENV === 'production' && process.env.HALO_ENABLE_FRONTEND_PREVIEW !== '1') notFound();
  return <MapPreview />;
}
