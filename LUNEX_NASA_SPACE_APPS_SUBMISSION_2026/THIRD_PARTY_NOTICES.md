# Third-party notices

This file records the third-party software, data services, and local assets identified in the Lunex source repository. It should be read together with the repository's root `LICENSE` and `package-lock.json`.

## Lunex source code

The project repository contains an Apache License, Version 2.0 (`LICENSE`). That license applies to the original project code as stated in the repository. It does not replace the separate terms or attribution requirements for NASA data, third-party assets, or dependencies.

## NASA and space-agency material

- **LOLA Product 78:** [NASA PGDA Product 78](https://pgda.gsfc.nasa.gov/products/78). Primary source for the prepared local south-pole elevation rasters used in Lunex.
- **JPL Horizons:** [NASA/JPL Horizons](https://ssd.jpl.nasa.gov/horizons/). Source of time-specific Sun and Earth observer ephemerides.
- **Moon Trek / LRO WAC:** [NASA Moon Trek](https://trek.nasa.gov/moon/). Source of the regional south-pole basemap imagery. Attribution: NASA / JPL / LRO Wide Angle Camera.
- **LROC South Pole NAC mosaic:** [LROC controlled South Pole mosaic](https://data.lroc.im-ldi.com/lroc/view_rdr/NAC_POLE_SOUTH_CM_AVG), accessed through [Lunaserv WMS](https://wms.im-ldi.com/). Attribution: NASA/GSFC/Arizona State University (ASU), Lunar Reconnaissance Orbiter Camera (LROC).

Detailed dataset descriptions, usage in Lunex, and scientific scope are provided in [DATA_SOURCES.md](DATA_SOURCES.md).

## Software dependencies

Versions below are taken from the repository's `package-lock.json`, not estimated from package names.

### Runtime dependencies

| Package | Locked version | License |
|---|---:|---|
| `@react-three/drei` | 10.7.9 | MIT |
| `@react-three/fiber` | 9.8.2 | MIT |
| `geotiff` | 3.0.5 | MIT |
| `lint` | 1.2.2 | Apache-2.0 |
| `next` | 16.4.5 | MIT |
| `ol` | 10.11.0 | BSD-2-Clause |
| `proj4` | 2.22.0 | MIT |
| `react` | 19.3.0 | MIT |
| `react-dom` | 19.3.0 | MIT |
| `three` | 0.187.0 | MIT |

### Development dependencies

| Package | Locked version | License |
|---|---:|---|
| `@tailwindcss/turbopack` | 4.3.5 | MIT |
| `@types/node` | 20.19.43 | MIT |
| `@types/react` | 19.3.0 | MIT |
| `@types/react-dom` | 19.3.0 | MIT |
| `@types/three` | 0.187.0 | MIT |
| `eslint` | 9.39.5 | MIT |
| `eslint-config-next` | 16.4.5 | MIT |
| `tailwindcss` | 4.3.5 | MIT |
| `typescript` | 5.9.3 | Apache-2.0 |

### Complete locked dependency inventory

The lockfile contains 558 installed package entries, including transitive and platform-specific optional packages. The license metadata recorded in those entries is:

| License identifier in lockfile | Package entries |
|---|---:|
| (MIT AND Zlib) | 1 |
| 0BSD | 2 |
| Apache-2.0 | 42 |
| Apache-2.0 AND LGPL-3.0-or-later | 3 |
| Apache-2.0 AND LGPL-3.0-or-later AND MIT | 1 |
| BlueOak-1.0.0 | 1 |
| BSD-2-Clause | 8 |
| BSD-3-Clause | 4 |
| CC-BY-4.0 | 1 |
| CC0-1.0 | 2 |
| ISC | 23 |
| LGPL-3.0-or-later | 10 |
| MIT | 444 |
| MIT AND BSD-3-Clause | 1 |
| MPL-2.0 | 13 |
| NOT DECLARED | 1 |
| Python-2.0 | 1 |

The lockfile does not declare a license for `webgl-constants@1.1.1`. Its [published package README](https://www.npmjs.com/package/webgl-constants) identifies the package as MIT-licensed.

The lockfile also includes dependencies under LGPL-3.0-or-later, MPL-2.0, CC-BY-4.0, Python-2.0, BlueOak-1.0.0, BSD, ISC, 0BSD, CC0, and combined license expressions. Those terms continue to apply to the relevant packages. The dependency lock records versions and declared license metadata; it is not a substitute for preserving upstream license texts and notices when redistributing package code.

## Visual assets

The following visual assets are credited to their original source pages. These credits and reuse terms are separate from the Apache License 2.0 that applies to Lunex's original project code.

## 3D models

### Moon 3D Model

- **Asset:** `Moon_NASA_LRO_8k_Topo_Small.glb` — **Color Map and Height Map** variant.
- **Source:** [NASA Goddard Scientific Visualization Studio — *Moon 3D Models for Web, AR, and Animation*](https://svs.gsfc.nasa.gov/14959/).
- **Direct download:** [Moon_NASA_LRO_8k_Topo_Small.glb](https://svs.gsfc.nasa.gov/vis/a010000/a014900/a014959/Moon_NASA_LRO_8k_Topo_Small.glb).
- **Model basis:** Lunar color imagery and topographic data from NASA's Lunar Reconnaissance Orbiter (LRO).
- **Required credit:** Courtesy of NASA's Goddard Space Flight Center.
- **Production credits:** Producer — Dan Gallagher (eMITS); data provider — Ernie Wright (USRA); data analysts — Tuomas Kankola and Josh Klint (Leadwerks Game Engine); technical support — Aaron E. Lepsch (ADNET Systems, Inc.).
- **License / usage:** NASA-originated content is generally not subject to U.S. copyright under NASA's media usage guidelines. Credit NASA's Goddard Space Flight Center. Use does not imply NASA endorsement.

### Earth Model — `earth.glb`

- **Source:** [Earth — Akshat (@shooter24994), Sketchfab](https://sketchfab.com/3d-models/earth-41fc80d85dfd480281f21b74b2de2faa)
- **Creator:** Akshat, Sketchfab username `@shooter24994`.
- **License:** [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/).
- **Attribution:** “Earth” by Akshat (@shooter24994), [Sketchfab source](https://skfb.ly/6T88I), licensed under CC BY 4.0.
- **Project use:** Distributed in Lunex as `/models/earth.glb`. The source file has been placed under the application filename/path; no additional mesh or texture edits are asserted here.

The CC BY 4.0 license requires attribution, a link to the license, and an indication of changes when changes are made. The creator and license must remain credited wherever the model is redistributed or displayed with an asset-credit section.

### Sun Model — `sun.glb`

- **Source:** [NASA Science / Heliophysics Education Activation Team (HEAT) — Sun 3D Model Interactive](https://science.nasa.gov/learn/heat/resource/sun-3d-model/)
- **Published resource:** NASA lists a downloadable “3D Model of the Sun (glTF File)” on this page (4.14 MB; September 9, 2023).
- **Credit:** NASA Science, Heliophysics Education Activation Team (HEAT).
- **Reuse:** NASA's general media guidance states that NASA-originated media, including files used to render 3D models, are generally not subject to U.S. copyright for educational or informational use. The HEAT download page does not display a separate model-specific license or individual creator credit. NASA's third-party-content exceptions still apply.

Lunex uses the Sun model as a visual asset. The Sun's apparent position and visibility calculations are based on the separately documented JPL Horizons data, not on this model.

## Image assets

### Earth surface texture — `earth_daymap.jpg`

- **File source used:** [Three.js r122 example texture mirrored by MIT Design Heritage](https://designheritage.mit.edu/_dh_debug/THREEjs_122/examples/textures/planets/earth_atmos_2048.jpg) (the hosted source filename is `earth_atmos_2048.jpg`).
- **Upstream example:** [Three.js repository](https://github.com/mrdoob/three.js/tree/r122/examples).
- **Underlying Earth-image source credit:** NASA's [Blue Marble / Visible Earth](https://science.nasa.gov/resource/blue-marble/) entry credits NASA Goddard Space Flight Center; image by Reto Stöckli; enhancements by Robert Simmon; and supporting MODIS and USGS data teams.
- **Reuse:** NASA's media guidance states that NASA-originated imagery is generally not subject to U.S. copyright, subject to third-party-content exceptions. The MIT-hosted URL is a mirror location, not the creator or a separate license grant.

**Credit:** NASA Goddard Space Flight Center; image by Reto Stöckli; enhancements by Robert Simmon; supporting data and technical teams as listed in NASA's Blue Marble / Visible Earth credit.

### Hubble Moon image — `quickmap-lroc.png`

- **Source:** [NASA Science — Moon (Hubble asset)](https://science.nasa.gov/asset/hubble/moon/).
- **Original release:** “Hubble Shoots the Moon,” April 16, 1999.
- **Credit listed on the NASA asset page:** Lick Observatory.
- **Image record:** [ESA/Hubble — Moon (opo9914d)](https://esahubble.org/images/opo9914d/), which identifies the same Moon image and provides its reuse terms.
- **License:** [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/) as stated by ESA/Hubble for its published image.
- **Attribution:** ESA/Hubble; image credit: Lick Observatory. Source: [NASA Science — Moon](https://science.nasa.gov/asset/hubble/moon/) and [ESA/Hubble image opo9914d](https://esahubble.org/images/opo9914d/).

### Permanently shadowed lunar crater image — `nasa-lunar-crater.webp`

- **Source:** [NASA — Inside Dark, Polar Moon Craters, Water Not as Invincible as Expected, Scientists Argue](https://www.nasa.gov/general/inside-dark-polar-moon-craters-water-not-as-invincible-as-expected-scientists-argue/).
- **Image caption on source page:** “A permanently shadowed lunar crater.”
- **Credit displayed by NASA:** NASA's Goddard Space Flight Center.
- **Reuse:** NASA's media guidance states that NASA-originated imagery is generally not subject to U.S. copyright for educational or informational use, subject to third-party-content exceptions.

**Credit:** NASA's Goddard Space Flight Center. Source: [NASA article on permanently shadowed lunar craters](https://www.nasa.gov/general/inside-dark-polar-moon-craters-water-not-as-invincible-as-expected-scientists-argue/).
