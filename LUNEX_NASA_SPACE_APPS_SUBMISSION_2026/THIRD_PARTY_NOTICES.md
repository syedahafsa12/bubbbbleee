# Third-party notices

This file records the third-party software, data services, and local assets identified in the Lunex source repository. It should be read together with the repository's root `LICENSE` and `package-lock.json`.

## Lunex source code

The project repository contains an Apache License, Version 2.0 (`LICENSE`). That license applies to the original project code as stated in the repository. It does not replace the separate terms or attribution requirements for NASA data, third-party assets, or dependencies.

## NASA and space-agency material

NASA states that NASA-originated imagery and media are generally not subject to U.S. copyright, but that third-party content appearing on NASA sites can carry separate rights. NASA must be identified as the source, and its insignia/logotype and other NASA identifiers are subject to separate rules. See [NASA Images and Media Usage Guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/).

The NASA / JPL / LRO WAC basemap is attributed in the application as “Imagery: NASA / JPL / LRO Wide Angle Camera.” The Product 78 and Product 90 datasets are credited to NASA's Planetary Geology, Geophysics and Geochemistry Laboratory / LOLA product pages. The optional LROC controlled South Pole NAC average mosaic is separately credited to the LROC product page and the 2023 Archinal et al. citation listed in [DATA_SOURCES.md](DATA_SOURCES.md). Do not treat the project's Apache license as a license for these datasets.

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

One package entry, `webgl-constants@1.1.1`, has no license value in the lockfile/npm metadata. Its [published package README](https://www.npmjs.com/package/webgl-constants) states that the author's work is released under the MIT License. Preserve that attribution and verify the package contents before redistribution.

The lockfile also includes dependencies under LGPL-3.0-or-later, MPL-2.0, CC-BY-4.0, Python-2.0, BlueOak-1.0.0, BSD, ISC, 0BSD, CC0, and combined license expressions. Those terms continue to apply to the relevant packages. The dependency lock records versions and declared license metadata; it is not a substitute for preserving upstream license texts and notices when redistributing package code.

## 3D models and local textures

### Moon model — NASA source identified by exact filename

The application code references `/models/Moon_NASA_LRO_8k_Topo_Small.glb` as its default Moon model path, with an optional external URL configured through `NEXT_PUBLIC_LUNEX_MOON_MODEL_URL`.

NASA's Goddard Scientific Visualization Studio publishes a model with this exact filename:

- Source page: [Moon 3D Models for Web, AR, and Animation — NASA SVS 14959](https://svs.gsfc.nasa.gov/14959/)
- Direct download: [Moon_NASA_LRO_8k_Topo_Small.glb](https://svs.gsfc.nasa.gov/vis/a010000/a014900/a014959/Moon_NASA_LRO_8k_Topo_Small.glb)
- Model basis: imagery and topographic data from NASA's Lunar Reconnaissance Orbiter (LRO).
- Credit: NASA's Goddard Space Flight Center.
- Producer: Dan Gallagher (eMITS).
- Data provider: Ernie Wright (USRA).
- Data analysts: Tuomas Kankola and Josh Klint (Leadwerks Game Engine).
- Technical support: Aaron E. Lepsch (ADNET Systems, Inc.).

The exact filename in the source code matches NASA's published filename. However, the GLB itself is not present in the audited Git repository. Before submission, confirm that the deployed app is actually serving this NASA file (or a copy of it), rather than a different file placed at the same path or supplied through the environment variable.

### Earth and Sun models — source not established

The 3D scene code references `/models/earth.glb` and `/models/sun.glb`. Neither file is present in the audited Git tree, and the source code does not identify their original download pages, creators, or licenses. The filenames alone do not establish that NASA created them.

Do not credit these two models to NASA without checking the actual GLB files or their download URLs. Add the original source page, creator, and license for each model before submission. If their origin cannot be established, replace them with models from a documented source or remove them from the submitted build.

### Loose texture files — not referenced by the audited app code

These files are present in `public/textures/`:

- `earth_daymap.jpg`
- `nasa-lunar-crater.webp`
- `quickmap-lroc.png`

A search of the application source files did not find code references to these filenames. Their original source, creator, and license are not recorded in the repository. I could not verify an exact matching original source for these specific files, so this notice does not guess one based on a suggestive filename.

For context only:

- [Solar System Scope texture pack](https://edu.solarsystemscope.com/textures/) distributes its own planetary textures under CC BY 4.0. This is a possible lead for an Earth day texture, **not confirmation** that the repository's `earth_daymap.jpg` came from that pack.
- [LROC terms and citation policy](https://www.lroc.im-ldi.com/about/terms) state that PDS-delivered LROC data are public domain, while curated products, downloads, and non-PDS interfaces on the LROC website may be copyrighted. Educational use is permitted with appropriate citation. This is relevant only if `quickmap-lroc.png` is confirmed to be an image or screenshot from LROC QuickMap; the filename alone does not prove its source or image rights.
- No verified source has been identified for `nasa-lunar-crater.webp`.

Since these three files are not referenced by the audited application code, remove them from the submission repository if they are not intentionally used. If any is retained or displayed, identify its exact original source, author/creator, and license or permission before submitting. Do not describe them as NASA imagery solely because a filename contains “nasa” or “lroc”.

## NASA Space Apps source and license requirements

The 2026 [NASA Space Apps Terms and Conditions](https://www.spaceappschallenge.org/legal/) require teams to cite every source used, including open-source and freely available material, and to identify applicable licenses for third-party materials in the submitted documentation. NASA also requires original project content to be freely available or released under an OSI-compliant open-source license.

