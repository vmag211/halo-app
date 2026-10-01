import localFont from 'next/font/local';
import { notFound } from 'next/navigation';
import './preview.css';
import { PreviewHouseholdProvider } from '@/components/foundation/PreviewHousehold';

const plex = localFont({ src: '../../../public/fonts/ibm-plex-mono-latin.woff2', variable: '--font-plex', weight: '400', display: 'swap', fallback: ['Courier New'] });
const onest = localFont({ src: '../../../public/fonts/onest-variable.ttf', variable: '--font-onest', weight: '100 900', display: 'swap', fallback: ['Arial'] });

export default function PreviewLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === 'production' && process.env.HALO_ENABLE_FRONTEND_PREVIEW !== '1') notFound();
  return <div className={`${plex.variable} ${onest.variable}`}><PreviewHouseholdProvider>{children}</PreviewHouseholdProvider></div>;
}
