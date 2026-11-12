export const PRODUCT78_SITE_REGISTRY = {
  site01_connecting_ridge: {
    id: "site01_connecting_ridge",
    archiveSite: "Site01",
    displayName: "Connecting Ridge",
    dataDirectory: "site01_connecting_ridge",
  },

  site04_shackleton_rim: {
    id: "site04_shackleton_rim",
    archiveSite: "Site04",
    displayName: "Shackleton Rim",
    dataDirectory: "site04_shackleton_rim",
  },

  site07_peak_near_shackleton: {
    id: "site07_peak_near_shackleton",
    archiveSite: "Site07",
    displayName: "Peak near Shackleton",
    dataDirectory: "site07_peak_near_shackleton",
  },

  site11_de_gerlache_rim: {
    id: "site11_de_gerlache_rim",
    archiveSite: "Site11",
    displayName: "de Gerlache Rim",
    dataDirectory: "site11_de_gerlache_rim",
  },
} as const;

export type Product78SiteId =
  keyof typeof PRODUCT78_SITE_REGISTRY;

export type Product78Site =
  (typeof PRODUCT78_SITE_REGISTRY)[Product78SiteId];

export const DEFAULT_PRODUCT78_SITE_ID: Product78SiteId =
  "site04_shackleton_rim";

export function getProduct78Site(
  siteId: string
): Product78Site {
  if (
    !Object.prototype.hasOwnProperty.call(
      PRODUCT78_SITE_REGISTRY,
      siteId
    )
  ) {
    throw new Error(`Unknown Product78 site: ${siteId}`);
  }

  return PRODUCT78_SITE_REGISTRY[
    siteId as Product78SiteId
  ];
}
