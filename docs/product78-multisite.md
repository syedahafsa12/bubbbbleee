# LunaPath Product78 terrain contract

## Data sources and site registry

LunaPath uses NASA PGDA Product78 local 5 m/pixel south-polar DEMs as the primary terrain source. The registry includes the 27 regions listed by NASA PGDA:

| Site ID | Display name |
|---|---|
| `site01_connecting_ridge` | Connecting Ridge |
| `site04_shackleton_rim` | Shackleton Rim |
| `site06_nobile_rim_1` | Nobile Rim 1 |
| `site07_peak_near_shackleton` | Peak near Shackleton |
| `site11_de_gerlache_rim` | de Gerlache Rim 1 |
| `site20_leibnitz_beta_plateau` | Leibnitz Beta Plateau |
| `site20v2_leibnitz_beta_plateau_extended` | Leibnitz Beta Plateau (extended) |
| `site23_malapert_massif` | Malapert Massif |
| `site42_de_gerlache_kocher_massif` | de Gerlache-Kocher Massif |
| `haworth` | Haworth |
| `shoemaker` | Shoemaker |
| `dm1_amundsen_rim` | Amundsen Rim |
| `dm2_nobile_rim_2` | Nobile Rim 2 |
| `sl2_de_gerlache_rim_2` | de Gerlache Rim 2 |
| `sl3_connecting_ridge_extension` | Connecting Ridge Extension |
| `npa_cabeus_exterior_wall_1` | Cabeus Exterior Wall 1 |
| `npb_amundsen_1` | Amundsen 1 |
| `npc_idelson_l_crater_1` | Idel'son L Crater 1 |
| `npd_malapert_crater_1` | Malapert Crater 1 |
| `lm1_shackleton_rim_b` | Shackleton Rim B |
| `lm2_shoemaker_rim_a` | Shoemaker Rim A |
| `lm3_shoemaker_rim_b` | Shoemaker Rim B |
| `lm4_shoemaker_rim_c` | Shoemaker Rim C |
| `lm5_shoemaker_rim_d` | Shoemaker Rim D |
| `lm6_shoemaker_rim_e` | Shoemaker Rim E |
| `lm7_faustini_rim_a` | Faustini Rim A |
| `lm8_shoemaker_rim_f` | Shoemaker Rim F |

The observer coordinates are selenographic latitude and east-positive longitude. Coordinates are sourced from NASA's Lunar Surface Data Book feature-centre table. Site04 remains the default.

## Site discovery endpoint

`GET /api/product78/sites`

The response lists every registered site, its observer coordinates, and an asset status:

- `ready`: metadata and elevation binary exist and the binary byte count matches the declared dimensions.
- `not_prepared`: local `metadata.json` or `elevation.bin` is missing.
- `invalid_metadata`: metadata cannot be read or fails basic structural checks.
- `invalid_binary_size`: binary byte count does not match width × height × 4.

This endpoint checks asset presence and declared file size. The Horizons API performs the full terrain metadata and raster validation before using a site.

## Horizons endpoint

`GET /api/horizons?date=YYYY-MM-DD&siteId=site04_shackleton_rim`

- `siteId` is optional; the default is `site04_shackleton_rim`.
- Sun and Earth JPL Horizons observations are fetched independently of the terrain calculation.
- Product78 is the only enabled terrain source on this MVP path.
- Product90 is disabled by default. The calculation layer supports an opt-in Product90 enhancement, but a failure in that enhancement cannot discard the completed Product78-only profile.

### Partial horizon profile

Each `terrainModel.horizonProfile[]` entry exposes:

- `azimuthDeg`
- `maxTerrainElevationAngleDeg` (also exposed as the compatibility field `horizonElevationDeg`)
- `lastKnownSampleDistanceM`
- `sampleCount`
- `source` (`product78` or `null`)
- `coverageStatus` (`partial` or `no_data`)
- `terminationReason` (`raster_boundary`, `nodata`, or `search_limit` for Product78-only mode)
- `terrainBeyondKnownCoverageUnknown` (always `true`)

When a direction has no valid samples, its maximum terrain angle, source, and last known distance are `null`. Do not substitute zero.

The API normalizes internal reasons: `product78_boundary` becomes `raster_boundary`, and `product78_nodata` becomes `nodata`. `search_limit` stays a distinct termination reason and is never re-labelled as a raster boundary.

The profile always returns `completeHorizonVerified: false`. A ray that reaches a raster edge or the configured search limit cannot prove what lies beyond its known samples.

When an observation's azimuth cannot be supported by valid neighboring terrain directions, its `terrainVisibility` is `null`. Visibility windows break at these unknown observations instead of treating them as visible or blocked.

## Preparing additional local site assets

The preparation script downloads each NASA source TIFF into the operating system's temporary directory, validates its TIFF layout and georeferencing, then writes only:

- `public/data/<site-data-directory>/metadata.json`
- `public/data/<site-data-directory>/elevation.bin`

The raw source TIFF is removed from the temporary directory after the run.

Commands:

```bash
# Prepare the six core additional standard numbered sites.
npm run prepare:product78

# Prepare only selected archive sites.
npm run prepare:product78 -- Site11 Site23

# Prepare every registered non-default Product78 site.
npm run prepare:product78 -- --all
```

The all-sites operation is a large download and produces a substantial amount of local binary data. Do not add all raw TIFFs to Git, and do not assume all 27 site binaries should be bundled into a Vercel deployment. Deployment storage and static-asset hosting should be planned separately from the application code.

## Scientific and implementation boundaries

- Product78 is the source of actual local elevation samples. The display mesh may be decimated for performance, but scientific calculations use the original raster.
- NoData is accepted only when it is declared in metadata and the decoded count agrees with the raster.
- A Product78 boundary or NoData sample terminates that direction. The code does not bridge the gap with guessed elevations.
- Product90 cannot be required to produce a valid Product78-only response.
- No full 360-degree lunar horizon, complete line of sight, or fully verified visibility claim is made by this local-coverage calculation.
