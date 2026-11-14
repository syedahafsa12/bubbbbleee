# NASA celestial model assets

LunaPath uses the following NASA model resources for the distant bodies shown in the 360° lunar explorer.

## Earth

- Local asset: `public/models/earth.glb`
- Source: [NASA Earth with Clouds 3D Model](https://science.nasa.gov/resource/earth-with-clouds-3d-model/)
- Source credit: NASA Visualization Technology Applications and Development (VTAD)
- The NASA resource page lists the original glTF download as 18.05 MB.

The cloud layer and authored materials are retained by the model loader. Do not replace them with a generated Earth texture or a flat material.

## Sun

- Local asset: `public/models/sun.glb`
- Source: [NASA Sun 3D Model Interactive](https://science.nasa.gov/learn/heat/resource/sun-3d-model/)
- The NASA resource page lists the original glTF download as 4.14 MB.

The source model's own materials are preserved. The renderer must not apply a generic orange emissive override or a synthetic rotation.

## Simulation contract

- JPL Horizons remains authoritative for apparent azimuth, elevation, and angular diameter.
- The GLB assets control appearance only.
- The source model is normalized to the JPL-derived apparent diameter. No additional visual enlargement factor is applied.
- No synthetic spin animation is applied to either body.
- Existing terrain qualification and visibility handling remain unchanged in this model-only preview.

## Separate solar imagery

NASA's [SDO AIA 304 Å visualization](https://svs.gsfc.nasa.gov/3983/) is an archival extreme-ultraviolet observation, not a live visible-light photograph. It is not substituted for the Sun model's own material in this preview. Any later AIA 304 overlay must be separately attributed and clearly labelled as false-colour 304 Å imagery.
