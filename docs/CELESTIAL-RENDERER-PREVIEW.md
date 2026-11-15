# Celestial renderer preview

This branch is an isolated visual preview. It is not merged into `main`.

## Visual changes in this preview

- The selected landing site remains rendered from the existing NASA LOLA / Product78 elevation raster: 5 m near-field geometry and the existing 30 m regional context mesh.
- The existing controlled LROC South Pole NAC mosaic remains the surface morphology/albedo layer. The camera starts with a more ground-facing landing-view composition, and lunar fill lighting is reduced to preserve sharper sunlit/shadowed relief.
- Earth and Sun retain their JPL-derived sky directions and angular-diameter calculations. Earth's 3D mesh uses a **3.5× presentation scale** and the Sun's uses **8.0×** so the solar disk is clearly visible; these are display-only exaggerations. JPL values, direction, occlusion calculations and lighting direction are unchanged. The UI labels this visual exaggeration.
- The Sun uses a NASA SDO 4500 Å visible-light photosphere reference (including sunspots) as its main disk, with NASA SDO/AIA 304 Å used only at the outer rim for prominence detail. Both reference frames are historical; the 304 Å false-colour image no longer covers the full solar disk.
- The API routes `/api/solar-imagery/photosphere` and `/api/solar-imagery/aia304` proxy NASA SVS reference frames with content-type and size checks.

## Asset provenance

The renderer loads `public/models/earth.glb` and `public/models/sun.glb`. This code update does **not** replace those binary files. Their byte-level provenance against the selected NASA download pages has not been verified in this workspace, so this preview does not claim that those two existing GLBs have been replaced with newly verified NASA downloads.

NASA source pages:
- [Earth with Clouds 3D Model](https://science.nasa.gov/resource/earth-with-clouds-3d-model/)
- [Earth 3D Model fallback](https://science.nasa.gov/learn/heat/resource/earth-3d-model/)
- [Sun 3D Model](https://science.nasa.gov/learn/heat/resource/sun-3d-model/)
- [NASA SDO 4500 Å visible-light photosphere](https://svs.gsfc.nasa.gov/3987/)
- [NASA SDO/AIA 304 Å prominence reference](https://svs.gsfc.nasa.gov/3983/)

## Preserved systems

No changes are made to JPL Horizons request/response logic, apparent positions, angular-diameter calculations, terrain-horizon classification, Product78/LOLA geometry generation, Product90 sampling, LROC image registration, observer pixel mapping, mission timeline or site registry.

## Terrain restoration

- The 360° Explorer's terrain rendering now matches the validated terrain layering at `0d4b0254b1d285ca37980d4c98ae2d760a461888`: a standalone LOLA shaded-relief base (5 m near-field and 30 m regional geometry) plus a separate translucent LROC morphology/albedo overlay.
- The local 5 m and regional 30 m geometry builders, Product78 decoder, site registry, site planner handoff, and prepared DEM assets are unchanged from that validated reference.
- The initial observer camera starts level with the local horizon so distant crater rims and ridges are visible; the existing drag/look interaction remains in place.
- The selected-location and Product78 science-sample API file-tracing entries are included for production output tracing.
