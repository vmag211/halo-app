import type { Metadata } from "next";
import { Geist_Mono, Playfair_Display, Poppins } from "next/font/google";
import "./globals.css";
import AuthInitializer from "../components/AuthInitializer";

// Poppins carries body copy and labels; Playfair Display carries every
// numeral, score and page heading — the HALO design language leans on that
// serif/sans contrast throughout.
const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "HALO",
  description:
    "A home-environmental-health snapshot for your address: air quality, UV, pollen, mold risk, radon risk and drinking water.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${poppins.variable} ${playfair.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* Opens the anonymous session before any screen needs it. Renders nothing. */}
        <AuthInitializer />
        {children}
      </body>
    </html>
  );
}
