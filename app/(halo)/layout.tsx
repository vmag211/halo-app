import localFont from 'next/font/local';
import '../foundation/preview/preview.css';
import StageApp from '@/components/stage/StageApp';

const plex = localFont({ src: '../../public/fonts/ibm-plex-mono-latin.woff2', variable: '--font-plex', weight: '400', display: 'swap', fallback: ['Courier New'] });
const onest = localFont({ src: '../../public/fonts/onest-variable.ttf', variable: '--font-onest', weight: '100 900', display: 'swap', fallback: ['Arial'] });
export default function Layout({ children }: { children: React.ReactNode }) {
  return <div className={`${plex.variable} ${onest.variable}`}><StageApp>{children}</StageApp></div>;
}
