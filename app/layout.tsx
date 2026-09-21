import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Inline Contextual Autocorrect",
  description: "Live autocorrect while you type: typo fixes, context re-checks and better words, judged by Jev and proposed by Claude Haiku.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading the request headers makes the page render per request, so the CSP nonce set in proxy.ts is
  // attached to every inline script Next.js emits.
  await headers();
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
