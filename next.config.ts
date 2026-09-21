import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_BUILD: Date.now().toString(36) },
  // Keep Hunspell and the dictionary packages out of the bundle so their .aff/.dic files are traced as-is.
  serverExternalPackages: ["nspell", "dictionary-en", "dictionary-da"],
  outputFileTracingIncludes: {
    "/api/**": ["./node_modules/dictionary-en/**", "./node_modules/dictionary-da/**"],
  },
};

export default nextConfig;
