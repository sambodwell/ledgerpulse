import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // pdf-parse loads pdfjs workers at runtime; keep it out of the server bundle.
  serverExternalPackages: ["pdf-parse"],
  partialPrefetching: true,
  // There is no /login page: sign-in lives on /signup. Catch bookmarks, old links, and Supabase redirect URLs
  // pointing at /login (incoming ?next= is carried over) instead of 404ing.
  async redirects() {
    return [
      { source: "/login", destination: "/signup?mode=signin", permanent: false },
      { source: "/signin", destination: "/signup?mode=signin", permanent: false },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
