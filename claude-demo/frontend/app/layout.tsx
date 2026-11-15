import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Manrope } from "next/font/google";
import "./globals.css";

// next/font downloads the font once and serves it from our own site.
const bodyFont = Manrope({
  subsets: ["latin"],
  variable: "--font-body",
});

export const metadata: Metadata = {
  title: "SPHEREx Xplorer",
  description:
    "Explore the infrared sky with real observations from NASA's SPHEREx mission.",
};

// The root layout wraps every page on the site.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={bodyFont.variable}>
      <head>
        {/* Start connecting early to the servers the sky viewer needs */}
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://irsa.ipac.caltech.edu" crossOrigin="anonymous" />
      </head>
      <body className="min-h-dvh bg-black font-sans text-white antialiased">
        {children}
      </body>
    </html>
  );
}
