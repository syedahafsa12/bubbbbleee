export interface Product78Site {
  id: string;
  archiveSite: string;
  displayName: string;
  dataDirectory: string;
  observer: {
    latitudeDeg: number;
    longitudeEastDeg: number;
  };
  sourceUrl: string;
}

/**
 * Twenty-seven Product78 south-polar regions and candidate site footprints listed by NASA PGDA.
 * LunaPath implementation. Coordinates are selenographic and east-positive.
 */
export const PRODUCT78_SITE_REGISTRY = {
  site01_connecting_ridge: {
    id: "site01_connecting_ridge",
    archiveSite: "Site01",
    displayName: "Connecting Ridge",
    dataDirectory: "site01_connecting_ridge",
    observer: { latitudeDeg: -89.4632, longitudeEastDeg: 222.51 },
    sourceUrl: "https://pgda.gsfc.nasa.gov/products/78",
  },
  site04_shackleton_rim: {
    id: "site04_shackleton_rim",
    archiveSite: "Site04",
    displayName: "Shackleton Rim",
    dataDirectory: "site04_shackleton_rim",
    observer: { latitudeDeg: -89.7668, longitudeEastDeg: 188.13 },
    sourceUrl: "https://pgda.gsfc.nasa.gov/products/78",
  },
  site06_nobile_rim_1: {
    id: "site06_nobile_rim_1",
    archiveSite: "Site06",
    displayName: "Nobile Rim 1",
    dataDirectory: "site06_nobile_rim_1",
    observer: { latitudeDeg: -85.4381, longitudeEastDeg: 37.36667 },
    sourceUrl: "https://pgda.gsfc.nasa.gov/products/78",
  },
  site07_peak_near_shackleton: {
    id: "site07_peak_near_shackleton",
    archiveSite: "Site07",
    displayName: "Peak near Shackleton",
    dataDirectory: "site07_peak_near_shackleton",
    observer: { latitudeDeg: -88.811, longitudeEastDeg: 123.6901 },
    sourceUrl: "https://pgda.gsfc.nasa.gov/products/78",
  },
  site11_de_gerlache_rim: {
    id: "site11_de_gerlache_rim",
    archiveSite: "Site11",
    displayName: "de Gerlache Rim",
    dataDirectory: "site11_de_gerlache_rim",
    observer: { latitudeDeg: -88.6834, longitudeEastDeg: 292.0679 },
    sourceUrl: "https://pgda.gsfc.nasa.gov/products/78",
  },
  site20_leibnitz_beta_plateau: {
    id: "site20_leibnitz_beta_plateau",
    archiveSite: "Site20",
    displayName: "Leibnitz Beta Plateau",
    dataDirectory: "site20_leibnitz_beta_plateau",
    observer: { latitudeDeg: -85.4266, longitudeEastDeg: 31.74276 },
    sourceUrl: "https://pgda.gsfc.nasa.gov/products/78",
  },
  site23_malapert_massif: {
    id: "site23_malapert_massif",
    archiveSite: "Site23",
    displayName: "Malapert Massif",
    dataDirectory: "site23_malapert_massif",
    observer: { latitudeDeg: -85.9948, longitudeEastDeg: 359.76422 },
    sourceUrl: "https://pgda.gsfc.nasa.gov/products/78",
  },
  site20v2_leibnitz_beta_plateau_extended: {
    id: "site20v2_leibnitz_beta_plateau_extended",
    archiveSite: "Site20v2",
    displayName: "Leibnitz Beta Plateau (extended)",
    dataDirectory: "site20v2_leibnitz_beta_plateau_extended",
    observer: { latitudeDeg: -85.4266, longitudeEastDeg: 31.74276 },
    sourceUrl: "https://pgda.gsfc.nasa.gov/products/78",
  },
  site42_de_gerlache_kocher_massif: {
    id: "site42_de_gerlache_kocher_massif",
    archiveSite: "Site42",
    displayName: "de Gerlache-Kocher Massif",
    dataDirectory: "site42_de_gerlache_kocher_massif",
    observer: { latitudeDeg: -85.8296, longitudeEastDeg: 243.678 },
    sourceUrl: "https://pgda.gsfc.nasa.gov/products/78",
  },
  haworth: {
    id: "haworth",
    archiveSite: "Haworth",
    displayName: "Haworth",
    dataDirectory: "haworth",
    observer: { latitudeDeg: -86.7639, longitudeEastDeg: 337.223 },
    sourceUrl: "https://pgda.gsfc.nasa.gov/products/78",
  },
  shoemaker: {
    id: "shoemaker",
    archiveSite: "Shoemaker",
    displayName: "Shoemaker",
    dataDirectory: "shoemaker",
    observer: { latitudeDeg: -87.1835, longitudeEastDeg: 62.83502 },
    sourceUrl: "https://pgda.gsfc.nasa.gov/products/78",
  },
  dm1_amundsen_rim: {
    id: "dm1_amundsen_rim",
    archiveSite: "DM1",
    displayName: "Amundsen Rim",
    dataDirectory: "dm1_amundsen_rim",
    observer: { latitudeDeg: -84.2287, longitudeEastDeg: 69.44396 },
    sourceUrl: "https://pgda.gsfc.nasa.gov/products/78",
  },
  dm2_nobile_rim_2: {
    id: "dm2_nobile_rim_2",
    archiveSite: "DM2",
    displayName: "Nobile Rim 2",
    dataDirectory: "dm2_nobile_rim_2",
    observer: { latitudeDeg: -83.954, longitudeEastDeg: 58.82206 },
    sourceUrl: "https://pgda.gsfc.nasa.gov/products/78",
  },
  sl2_de_gerlache_rim_2: {
    id: "sl2_de_gerlache_rim_2",
    archiveSite: "SL2",
    displayName: "de Gerlache Rim 2",
    dataDirectory: "sl2_de_gerlache_rim_2",
    observer: { latitudeDeg: -88.23, longitudeEastDeg: 295.3716 },
    sourceUrl: "https://pgda.gsfc.nasa.gov/products/78",
  },
  sl3_connecting_ridge_extension: {
    id: "sl3_connecting_ridge_extension",
    archiveSite: "SL3",
    displayName: "Connecting Ridge Extension",
    dataDirectory: "sl3_connecting_ridge_extension",
    observer: { latitudeDeg: -89.0324, longitudeEastDeg: 258.001 },
    sourceUrl: "https://pgda.gsfc.nasa.gov/products/78",
  },
  npa_cabeus_exterior_wall_1: {
    id: "npa_cabeus_exterior_wall_1",
    archiveSite: "NPA",
    displayName: "Cabeus Exterior Wall 1",
    dataDirectory: "npa_cabeus_exterior_wall_1",
    observer: { latitudeDeg: -86.9243, longitudeEastDeg: 288.4349 },
    sourceUrl: "https://pgda.gsfc.nasa.gov/products/78",
  },
  npb_amundsen_1: {
    id: "npb_amundsen_1",
    archiveSite: "NPB",
    displayName: "Amundsen 1",
    dataDirectory: "npb_amundsen_1",
    observer: { latitudeDeg: -83.9046, longitudeEastDeg: 89.53545 },
    sourceUrl: "https://pgda.gsfc.nasa.gov/products/78",
  },
  npc_idelson_l_crater_1: {
    id: "npc_idelson_l_crater_1",
    archiveSite: "NPC",
    displayName: "Idel'son L Crater 1",
    dataDirectory: "npc_idelson_l_crater_1",
    observer: { latitudeDeg: -84.5397, longitudeEastDeg: 126.9045 },
    sourceUrl: "https://pgda.gsfc.nasa.gov/products/78",
  },
  npd_malapert_crater_1: {
    id: "npd_malapert_crater_1",
    archiveSite: "NPD",
    displayName: "Malapert Crater 1",
    dataDirectory: "npd_malapert_crater_1",
    observer: { latitudeDeg: -84.8034, longitudeEastDeg: 8.387032 },
    sourceUrl: "https://pgda.gsfc.nasa.gov/products/78",
  },
  lm1_shackleton_rim_b: {
    id: "lm1_shackleton_rim_b",
    archiveSite: "LM1",
    displayName: "Shackleton Rim B",
    dataDirectory: "lm1_shackleton_rim_b",
    observer: { latitudeDeg: -89.5244, longitudeEastDeg: 56.30993 },
    sourceUrl: "https://pgda.gsfc.nasa.gov/products/78",
  },
  lm2_shoemaker_rim_a: {
    id: "lm2_shoemaker_rim_a",
    archiveSite: "LM2",
    displayName: "Shoemaker Rim A",
    dataDirectory: "lm2_shoemaker_rim_a",
    observer: { latitudeDeg: -88.0792, longitudeEastDeg: 11.88866 },
    sourceUrl: "https://pgda.gsfc.nasa.gov/products/78",
  },
  lm3_shoemaker_rim_b: {
    id: "lm3_shoemaker_rim_b",
    archiveSite: "LM3",
    displayName: "Shoemaker Rim B",
    dataDirectory: "lm3_shoemaker_rim_b",
    observer: { latitudeDeg: -88.3828, longitudeEastDeg: 16.58734 },
    sourceUrl: "https://pgda.gsfc.nasa.gov/products/78",
  },
  lm4_shoemaker_rim_c: {
    id: "lm4_shoemaker_rim_c",
    archiveSite: "LM4",
    displayName: "Shoemaker Rim C",
    dataDirectory: "lm4_shoemaker_rim_c",
    observer: { latitudeDeg: -88.9645, longitudeEastDeg: 37.23483 },
    sourceUrl: "https://pgda.gsfc.nasa.gov/products/78",
  },
  lm5_shoemaker_rim_d: {
    id: "lm5_shoemaker_rim_d",
    archiveSite: "LM5",
    displayName: "Shoemaker Rim D",
    dataDirectory: "lm5_shoemaker_rim_d",
    observer: { latitudeDeg: -88.632, longitudeEastDeg: 74.62375 },
    sourceUrl: "https://pgda.gsfc.nasa.gov/products/78",
  },
  lm6_shoemaker_rim_e: {
    id: "lm6_shoemaker_rim_e",
    archiveSite: "LM6",
    displayName: "Shoemaker Rim E",
    dataDirectory: "lm6_shoemaker_rim_e",
    observer: { latitudeDeg: -87.9458, longitudeEastDeg: 71.27421 },
    sourceUrl: "https://pgda.gsfc.nasa.gov/products/78",
  },
  lm7_faustini_rim_a: {
    id: "lm7_faustini_rim_a",
    archiveSite: "LM7",
    displayName: "Faustini Rim A",
    dataDirectory: "lm7_faustini_rim_a",
    observer: { latitudeDeg: -87.8897, longitudeEastDeg: 90 },
    sourceUrl: "https://pgda.gsfc.nasa.gov/products/78",
  },
  lm8_shoemaker_rim_f: {
    id: "lm8_shoemaker_rim_f",
    archiveSite: "LM8",
    displayName: "Shoemaker Rim F",
    dataDirectory: "lm8_shoemaker_rim_f",
    observer: { latitudeDeg: -87.3417, longitudeEastDeg: 60.25512 },
    sourceUrl: "https://pgda.gsfc.nasa.gov/products/78",
  },
} as const;

export type Product78SiteId = keyof typeof PRODUCT78_SITE_REGISTRY;
export type RegisteredProduct78Site =
  (typeof PRODUCT78_SITE_REGISTRY)[Product78SiteId];

export const DEFAULT_PRODUCT78_SITE_ID: Product78SiteId =
  "site04_shackleton_rim";

export function getProduct78Site(siteId: string): RegisteredProduct78Site {
  if (!Object.prototype.hasOwnProperty.call(PRODUCT78_SITE_REGISTRY, siteId)) {
    throw new Error(
      `Unknown Product78 site "${siteId}". Available sites: ${Object.keys(PRODUCT78_SITE_REGISTRY).join(", ")}.`
    );
  }

  return PRODUCT78_SITE_REGISTRY[siteId as Product78SiteId];
}

