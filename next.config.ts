import type { NextConfig } from "next";

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_BUILD: Date.now().toString(36) },
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      // Download manifest and library are read by the apps: allow cross-origin reads of those two only.
      { source: "/api/(library|desktop-version)", headers: [{ key: "Cross-Origin-Resource-Policy", value: "cross-origin" }] },
    ];
  },
  // Keep Hunspell and the dictionary packages out of the bundle so their .aff/.dic files are traced as-is.
  serverExternalPackages: ["nspell", "dictionary-en", "dictionary-da"],
  outputFileTracingIncludes: {
    "/api/**": ["./node_modules/dictionary-en/**", "./node_modules/dictionary-da/**"],
  },
};

export default nextConfig;
