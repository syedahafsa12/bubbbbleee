import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,

  // The Horizons API reads its default Site04 raster with node:fs. Include
  // only the verified Site04 binary/metadata in server function traces.
  // Add further site files here only after asset validation and deployment
  // size review; do not blindly bundle every 5 m raster into the function.
  outputFileTracingIncludes: {
    "/api/horizons": [
      "./public/data/site04_shackleton_rim/metadata.json",
      "./public/data/site04_shackleton_rim/elevation.bin",
    ],
    "/api/product78/sites": [
      "./public/data/site04_shackleton_rim/metadata.json",
      "./public/data/site04_shackleton_rim/elevation.bin",
    ],
    "/api/test/multi-resolution": [
      "./public/data/site04_shackleton_rim/metadata.json",
      "./public/data/site04_shackleton_rim/elevation.bin",
    ],
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
