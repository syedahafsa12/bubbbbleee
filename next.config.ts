import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  outputFileTracingIncludes: {
    "/api/horizons": [
      "./public/data/site04_shackleton_rim/metadata.json",
      "./public/data/site04_shackleton_rim/elevation.bin",
      "./public/data/site11_de_gerlache_rim/metadata.json",
      "./public/data/site11_de_gerlache_rim/elevation.bin",
      "./public/data/site23_malapert_massif/metadata.json",
      "./public/data/site23_malapert_massif/elevation.bin",
    ],
    "/api/horizons/selected-location": [
      "./public/data/site04_shackleton_rim/metadata.json",
      "./public/data/site04_shackleton_rim/elevation.bin",
      "./public/data/site11_de_gerlache_rim/metadata.json",
      "./public/data/site11_de_gerlache_rim/elevation.bin",
      "./public/data/site23_malapert_massif/metadata.json",
      "./public/data/site23_malapert_massif/elevation.bin",
    ],
    "/api/product78/science-sample": [
      "./public/data/site04_shackleton_rim/science-metadata.json",
      "./public/data/site04_shackleton_rim/elevation.bin",
      "./public/data/site04_shackleton_rim/slope.bin",
      "./public/data/site04_shackleton_rim/slope-uncertainty.bin",
      "./public/data/site04_shackleton_rim/elevation-uncertainty.bin",
      "./public/data/site04_shackleton_rim/observation-count.bin",
    ],
    "/api/product78/sites": [
      "./public/data/site04_shackleton_rim/metadata.json",
      "./public/data/site04_shackleton_rim/elevation.bin",
      "./public/data/site11_de_gerlache_rim/metadata.json",
      "./public/data/site11_de_gerlache_rim/elevation.bin",
      "./public/data/site23_malapert_massif/metadata.json",
      "./public/data/site23_malapert_massif/elevation.bin",
    ],
    "/api/product78/terrain-preview": [
      "./public/data/site04_shackleton_rim/metadata.json",
      "./public/data/site04_shackleton_rim/elevation.bin",
      "./public/data/site11_de_gerlache_rim/metadata.json",
      "./public/data/site11_de_gerlache_rim/elevation.bin",
      "./public/data/site23_malapert_massif/metadata.json",
      "./public/data/site23_malapert_massif/elevation.bin",
    ],
    "/api/lunar-imagery/nac-south-pole": [
      "./public/data/site04_shackleton_rim/metadata.json",
      "./public/data/site11_de_gerlache_rim/metadata.json",
      "./public/data/site23_malapert_massif/metadata.json",
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
