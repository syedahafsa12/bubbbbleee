
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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

    "/api/product78/sites": [
      "./public/data/site04_shackleton_rim/metadata.json",
      "./public/data/site04_shackleton_rim/elevation.bin",
      "./public/data/site11_de_gerlache_rim/metadata.json",
      "./public/data/site11_de_gerlache_rim/elevation.bin",
      "./public/data/site23_malapert_massif/metadata.json",
      "./public/data/site23_malapert_massif/elevation.bin",
    ],

    "/api/test/multi-resolution": [
      "./public/data/site04_shackleton_rim/metadata.json",
      "./public/data/site04_shackleton_rim/elevation.bin",
    ],
  },
};

export default nextConfig;
