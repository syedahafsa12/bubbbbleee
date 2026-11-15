# Celestial renderer preview

This preview is based on the current `work/lunapath-mission-analysis-v1` branch.

## Scope

- The Earth and Sun continue to use the existing project files at `public/models/earth.glb` and `public/models/sun.glb`.
- Earth and Sun have separate renderer entry points.
- Authored materials and textures are preserved. The previous generic orange emissive override is removed.
- No synthetic body rotation is applied.
- JPL Horizons remains authoritative for azimuth, elevation and angular diameter.
- The additional 6x visual enlargement is removed.
- This change does not replace the GLB files with a newly verified NASA download. Asset provenance and photorealistic appearance still require independent verification.

## Preserved application systems

No changes are intended to the JPL endpoints, Product78 terrain and science layers, LROC imagery loader, mission timeline, map, site registry or Moon surface geometry.
