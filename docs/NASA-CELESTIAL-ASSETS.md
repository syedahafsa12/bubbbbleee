# NASA celestial model assets

LunaPath uses the following NASA model resources for the distant bodies shown in the 360° lunar explorer.

## Earth

- Local asset: `public/models/earth.glb`
- Source: [NASA Earth with Clouds 3D Model](https://science.nasa.gov/resource/earth-with-clouds-3d-model/)
- Source credit: NASA Visualization Technology Applications and Development (VTAD)
- NASA lists the original glTF download as 18.05 MB.
- The project preview uses a smaller local GLB copy. Its bytes have not been independently hash-compared with the NASA download in this review, so retain this source citation but verify the asset package metadata before public release.

The cloud layer and authored materials are retained by the model loader. Do not replace them with a generated Earth texture or a flat material.

## Sun

- Local asset: `public/models/sun.glb`
- Source: [NASA Sun 3D Model Interactive](https://science.nasa.gov/learn/heat/resource/sun-3d-model/)
- NASA's resource page links to its interactive Sun model and downloadable 3D model resources.
- The project preview uses the local `public/models/sun.glb` asset. Its bytes have not been independently hash-compared with NASA's downloadable source in this review.

The source model's own materials are preserved. The renderer must not apply a generic orange emissive override or a synthetic rotation.

## Simulation contract

- JPL Horizons remains authoritative for apparent azimuth, elevation, and angular diameter.
- The GLB assets control appearance only.
- The source model is normalized to the JPL-derived apparent diameter. No additional visual enlargement factor is applied.
- No synthetic spin animation is applied to either body.
- Existing terrain qualification and visibility handling remain unchanged in this model-only preview.

## Separate solar imagery

NASA's [SDO AIA 304 Å visualization](https://svs.gsfc.nasa.gov/3983/) is an archival extreme-ultraviolet observation, not a live visible-light photograph. It is not bundled or rendered in this preview. NASA lists the selected AIA 304 reference frame as a 4096 × 4096 image (5.5 MB), dated to the 2011-09-25/26 observation period. Any later AIA 304 overlay must be separately attributed and clearly labelled as archival false-colour 304 Å imagery.
