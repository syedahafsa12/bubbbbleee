# NASA data sources, actual use, and attribution

This document distinguishes (1) datasets and services directly integrated into Lunex, (2) optional code paths, and (3) resources supplied by the challenge that are useful references but are not verified runtime dependencies. A source appearing in the challenge resource list does not, by itself, prove that the app uses it.

## Source summary

| Source | Product/resolution | How Lunex uses it | Status in the reviewed code |
|---|---|---|---|
| NASA LOLA Product 78 | Site-focused south-polar DEMs; 5 m pixel spacing | Local elevation, terrain display, coordinate-to-raster sampling, and terrain-horizon calculations | Primary local terrain source |
| NASA/JPL Horizons | Observer ephemerides at requested time steps | Sun/Earth apparent azimuth, elevation, angular diameter, and time series from a lunar surface observer | Core, called server-side |
| NASA LOLA Product 90 | Large-area south-polar DEM; optional 20 m/pixel product | Optional regional terrain enhancement in selected-location analysis | Optional and off by default on the standard route |
| NASA Moon Trek / LRO WAC | South-pole LRO WAC map mosaic tiles | Regional lunar map context and map interaction | Direct tile integration |
| LROC controlled South Pole NAC average mosaic | 1 m/pixel; 84°S–90°S coverage | Optional image texture around a selected point, proxied through Lunaserv WMS | Direct optional imagery integration |
| LROC QuickMap | Interactive mapping tool | External reference supplied in the challenge resource list | No direct QuickMap runtime call verified |

---

## 1. NASA LOLA Product 78 — primary local elevation

**Product page:** https://pgda.gsfc.nasa.gov/products/78  
**Data directory:** https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/

Product 78 provides high-resolution LOLA digital elevation models for lunar south-pole candidate regions. Associated products include an elevation surface (LDEM), LOLA observation-count map (LDEC), slope, total elevation uncertainty, and slope uncertainty.

### Coordinate and raster specification

The prepared local rasters in the reviewed code declare:

- Projection: South Polar Stereographic
- Reference frame: MOON_ME
- Ephemeris: DE421
- Horizontal units: metres
- Pixel registration: pixel area
- Elevation type: Float32
- Byte order: little-endian
- Nominal pixel spacing: 5 m

The site registry stores selenographic latitude and east-positive longitude for candidate reference coordinates. The application transforms selected geographic coordinates into the Product78 projected raster before sampling elevation.

### Local elevation files present in the reviewed snapshot

| Archive site | Candidate region | Raster dimensions | Pixel spacing | Elevation binary |
|---|---|---:|---:|---:|
| Site04 | Shackleton Rim | 3,200 × 3,200 | 5 m | 40,960,000 bytes |
| Site11 | de Gerlache Rim | 3,200 × 3,200 | 5 m | 40,960,000 bytes |
| Site23 | Malapert Massif | 4,200 × 4,200 | 5 m | 70,560,000 bytes |

The code registry contains 27 candidate entries. Only the three listed elevation rasters were present in the code snapshot inspected for this documentation. A registry entry does not prove that a local raster has been downloaded or is deployable. Check `GET /api/product78/sites` at runtime for actual readiness.

### Ancillary science layers

Product 78 also publishes per-pixel information such as:

| Layer | Meaning | Unit |
|---|---|---|
| LDEC / observation count | Number of LOLA observations contributing to a pixel | count |
| Slope | Local slope | degrees |
| Total elevation uncertainty | RMS elevation uncertainty | metres |
| Slope uncertainty | RMS slope uncertainty | degrees |

The reviewed Site04 `science-metadata.json` describes four local Float32 binary layers: slope, slope uncertainty, elevation uncertainty, and observation count. However, the four corresponding `.bin` files were **not present in the reviewed repository tree**. The science-sample API requires those binaries to return a valid complete sample. Do not describe these layers as working in production until the files are included and the deployed endpoint has passed its test.

### Critical interpretation of “5 m”

NASA's Product 78 page explains that approximately 90% of 5 m pixels in these polar DEMs are interpolated because of LOLA's cross-track and inter-spot sampling pattern. Therefore **5 m/pixel is the output grid spacing; it is not a claim that every pixel is an independent 5 m measurement**. Effective resolution, sampling density, slope, and uncertainty matter when interpreting fine-scale hazards.

**Suggested attribution:**  
“Lunar topography: NASA Lunar Reconnaissance Orbiter Lunar Orbiter Laser Altimeter (LOLA), Planetary Geology, Geophysics and Geochemistry Laboratory, Product 78 — High-Resolution LOLA Topography for Lunar South Pole Sites. https://pgda.gsfc.nasa.gov/products/78”

---

## 2. NASA LOLA Product 90 — optional regional terrain

**Product page:** https://pgda.gsfc.nasa.gov/products/90  
**20 m/pixel south-polar DEM:** https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_20MPP_ADJ.TIF

Product 90 provides larger-area south-polar LOLA products as cloud-optimized GeoTIFFs. The 80°S–90°S 20 m/pixel DEM is referenced by the optional Product90 terrain loader.

Lunex contains Product90 sampling code, but it is **not the default terrain source**:
- The standard `GET /api/horizons` route disables Product90.
- The mission-analysis route uses the Product78 terrain baseline.
- The selected-location route can request the optional enhancement with `includeProduct90=true`.

Product90 is not required to produce the normal Product78-only result. Its effective resolution should not be equated automatically with its nominal pixel spacing; NASA also publishes effective-resolution and related products.

**Suggested attribution:**  
“Regional lunar topography: NASA LOLA Product 90 — A New View of the Lunar South Pole from LOLA. https://pgda.gsfc.nasa.gov/products/90”

---

## 3. NASA/JPL Horizons — Sun and Earth ephemerides

**Horizons system:** https://ssd.jpl.nasa.gov/horizons/  
**User manual:** https://ssd.jpl.nasa.gov/horizons/manual.html  
**API documentation:** https://ssd-api.jpl.nasa.gov/doc/horizons.html  
**API endpoint used by the application:** `https://ssd.jpl.nasa.gov/api/horizons.api`

Lunex requests observer ephemerides from a selected lunar surface coordinate. The principal target identifiers are:

- `10`: Sun
- `399`: Earth
- `coord@301`: observer coordinates relative to the Moon

The application requests observer-table data including:
- Quantity 4: apparent azimuth and elevation
- Quantity 13: apparent angular diameter

The routes use UT/UTC-formatted times. The standard daily and selected-location views sample at 10-minute intervals. The mission-analysis route uses 1-minute samples for its more detailed time-window calculations and checks that paired Sun/Earth epochs are aligned within its configured tolerance.

The selected map coordinate is first sampled against the local Product78 raster. The resulting terrain elevation supplies the observer altitude passed to the Horizons request.

**Suggested attribution:**  
“Celestial ephemerides: NASA/JPL Solar System Dynamics, Horizons System, observer-table output for the Sun and Earth as seen from the selected lunar surface coordinate. https://ssd.jpl.nasa.gov/horizons/”

---

## 4. NASA Moon Trek — regional south-pole map

**NASA tool:** https://trek.nasa.gov/moon/  
**Tile service referenced in the map component:**

```text
https://trek.nasa.gov/tiles/Moon/SP/
LRO_WAC_Mosaic_SPole60_100mp/1.0.0/
default/default028mm/{z}/{y}/{x}.png
```

The map component consumes NASA Moon Trek south-pole LRO Wide Angle Camera mosaic tiles. It registers a south-polar stereographic projection using a lunar radius of 1,737,400 metres.

This layer provides **regional imagery and map context**. It is not the high-resolution elevation raster and does not replace Product78 in numerical terrain sampling.

**Suggested attribution:**  
“Regional lunar imagery: NASA/JPL Moon Trek, Lunar Reconnaissance Orbiter Wide Angle Camera (LRO WAC) south-pole mosaic. https://trek.nasa.gov/moon/”

---

## 5. LROC controlled South Pole NAC average mosaic — optional imagery

**LROC product description:** https://data.lroc.im-ldi.com/lroc/view_rdr/NAC_POLE_SOUTH_CM_AVG  
**WMS host used by the API route:** https://wms.im-ldi.com/  
**Layer:** `luna_nac_pole_control_south`  
**Projection identifier:** `IAU2000:30120`

The LROC product page describes a controlled 1 m/pixel average mosaic covering 84°S to 90°S, arranged as 40 polar stereographic tiles. Lunex requests a 2,048 × 2,048 PNG around the selected location through Lunaserv WMS.

The app treats this as an **optional visual morphology texture**. It is not used as elevation, a calibrated albedo layer, or live illumination. If the external image service fails, the terrain visualization should retain the LOLA-based representation.

The LROC page supplies this citation:

Archinal, B., Weller, L., Richie, J., Lee, E., Bennett, K., Speyerer, E., & Tyburczy, T. (2023). “Controlled High-Resolution LROC NAC Polar Mosaics.” Lunar and Planetary Science Conference, 54, abstract 2333. https://www.hou.usra.edu/meetings/lpsc2023/pdf/2333.pdf

---

## 6. QuickMap — challenge reference, not a confirmed runtime source

**LROC QuickMap:** https://quickmap.lroc.asu.edu/

QuickMap is listed as a resource in the NASA Space Apps challenge and is valuable for independent lunar imagery/topography inspection. No direct QuickMap API or tile-service call was verified in the reviewed Lunex runtime code. The presence of a file named `quickmap-lroc.png` does not prove that it was obtained from QuickMap or that its usage rights are established.

Describe QuickMap as an external reference unless the final code or data-provenance records demonstrate a direct integration.

---

## Coordinate, time, and uncertainty policy

- Product78 site rasters use south-polar stereographic projected coordinates in metres; candidate observers are represented with selenographic latitude and east-positive longitude.
- The local metadata identifies MOON_ME / DE421 and pixel-area registration. Code validates the supported raster metadata before using terrain.
- Horizons provides apparent positions as seen by an observer. Lunex uses airless azimuth/elevation and does not model an Earth atmosphere around a lunar observer.
- Unknown terrain directions remain unknown. The code does not replace missing terrain with a zero-degree horizon.
- A terrain ray terminates at its valid data boundary, NoData, or configured search limit. Terrain beyond that point is not inferred.
- Visibility windows are built from discrete observations; their start/end values are sample timestamps, not exact interpolated crossing times.
- The target-disk limb check is first-order: it compares target angular radius with the terrain horizon at the target-centre azimuth. It is not a complete two-dimensional disk/terrain occultation calculation.

## Challenge resource alignment

The 2026 Lunar Landing Site Navigator challenge resources include QuickMap, Moon Trek, and Horizons. Lunex directly integrates Moon Trek tiles and Horizons observer ephemerides. QuickMap is documented here as a useful external reference, not as a runtime dependency.

Lunex is an independent participant project. NASA/JPL source acknowledgement does not imply NASA endorsement.
