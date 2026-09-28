import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "./onboarding.css";
import AuthInitializer from "../components/AuthInitializer";

const instrument = localFont({src: '../public/fonts/instrument-sans-latin.woff2', variable:'--font-instrument', display:'swap', weight:'400 700', fallback:['Arial']});
const fraunces = localFont({src: '../public/fonts/fraunces-latin.woff2', variable:'--font-fraunces', display:'swap', weight:'100 900', fallback:['Georgia']});

export const metadata: Metadata = {
  title: {default: "HALO", template: "HALO | %s"},
  description:
    "See what's in the air, water, and ground around your home, and what to do about it.",
  icons: { icon: '/halo-icon.png', apple: '/halo-icon.png' },
};
export const viewport: Viewport = { width:'device-width', initialScale:1, viewportFit:'cover', themeColor:[{media:'(prefers-color-scheme: light)',color:'#0e5e6f'},{media:'(prefers-color-scheme: dark)',color:'#2cc4bd'}] };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${instrument.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* Opens the anonymous session before any screen needs it. Renders nothing. */}
        <AuthInitializer />
        {children}
      </body>
    </html>
  );
}
