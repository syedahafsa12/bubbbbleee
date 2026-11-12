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
 * Six standard Product78 south-polar candidate regions selected for the current
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

