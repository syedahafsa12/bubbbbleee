# Celestial renderer preview

This branch is an isolated visual preview. It is not merged into `main`.

## Visual changes in this preview

- The selected landing site remains rendered from the existing NASA LOLA / Product78 elevation raster: 5 m near-field geometry and the existing 30 m regional context mesh.
- The existing controlled LROC South Pole NAC mosaic remains the surface morphology/albedo layer. The camera starts with a more ground-facing landing-view composition, and lunar fill lighting is reduced to preserve sharper sunlit/shadowed relief.
- Earth and Sun retain their JPL-derived sky directions and angular-diameter calculations. Their 3D meshes use a separate **3.5× presentation scale** for legibility; the JPL values, direction, occlusion calculations and lighting direction are unchanged. The UI labels this visual exaggeration.
- The Sun receives a separate NASA SDO/AIA 304 Å historical reference-image overlay. AIA 304 Å is extreme-ultraviolet data shown in false colour; the selected frame is historical and is not represented as the current Sun or as live mission data.
- The API route `/api/solar-imagery/aia304` proxies the exact NASA SVS reference frame with content-type and size checks.

## Asset provenance

The renderer loads `public/models/earth.glb` and `public/models/sun.glb`. This code update does **not** replace those binary files. Their byte-level provenance against the selected NASA download pages has not been verified in this workspace, so this preview does not claim that those two existing GLBs have been replaced with newly verified NASA downloads.

NASA source pages:
- [Earth with Clouds 3D Model](https://science.nasa.gov/resource/earth-with-clouds-3d-model/)
- [Earth 3D Model fallback](https://science.nasa.gov/learn/heat/resource/earth-3d-model/)
- [Sun 3D Model](https://science.nasa.gov/learn/heat/resource/sun-3d-model/)
- [NASA SDO/AIA 304 Å reference frame](https://svs.gsfc.nasa.gov/3983/)

## Preserved systems

No changes are made to JPL Horizons request/response logic, apparent positions, angular-diameter calculations, terrain-horizon classification, Product78/LOLA geometry generation, Product90 sampling, LROC image registration, observer pixel mapping, mission timeline or site registry.
