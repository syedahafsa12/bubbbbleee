import {
  DEFAULT_PRODUCT78_SITE_ID,
  type Product78SiteId,
} from "./siteRegistry";

export interface ExplorerSiteOption {
  id: Product78SiteId;
  label: string;
}

export const EXPLORER_SITE_OPTIONS: ExplorerSiteOption[] = [
  {
    id: DEFAULT_PRODUCT78_SITE_ID,
    label: "Site04 — Shackleton Rim",
  },
  {
    id: "site11_de_gerlache_rim",
    label: "Site11 — de Gerlache Rim",
  },
  {
    id: "site23_malapert_massif",
    label: "Site23 — Malapert Massif",
  },
];