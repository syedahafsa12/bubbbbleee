# Asset provenance and media register

This file separates verified NASA data/service sources from bundled media files whose exact creator, source page, or reuse permissions still need to be confirmed.

## Verified data/service inputs

| Asset/input | Source | Use in Lunex | Attribution |
|---|---|---|---|
| Product78 local elevation and ancillary metadata | NASA PGDA Product78 | Numerical terrain sampling and visualization | NASA LOLA Product78 |
| Product90 regional elevation source | NASA PGDA Product90 | Optional regional terrain sampling | NASA LOLA Product90 |
| Moon Trek LRO WAC South Pole tiles | NASA/JPL Moon Trek | Regional map imagery | NASA/JPL Moon Trek, LRO WAC |
| Controlled South Pole NAC average mosaic | LROC product; served through Lunaserv WMS | Optional image texture | LROC NAC controlled South Pole average mosaic; cite the product page and LPSC abstract |
| Sun/Earth ephemerides | NASA/JPL Horizons API | Apparent position and angular diameter | NASA/JPL Horizons |

See [NASA data sources](nasa-data-sources.md) for detailed URLs, resolution, coordinate conventions, and scientific caveats.

## Bundled media items that require a source/license check

The transport repository tree inspected for this task contains the following media filenames. Their presence and filename do **not** prove author, exact source, current use, or license.

| Repository path | What is known | What must be confirmed |
|---|---|---|
| `public/textures/earth_daymap.jpg` | Earth texture image is present in the repository tree | Exact download/source page, creator, license, and whether the final app imports it |
| `public/textures/nasa-lunar-crater.webp` | Lunar crater image is present | Exact NASA/product page or creator, license/terms, and final usage |
| `public/textures/quickmap-lroc.png` | Image filename references QuickMap/LROC | Original source page, screenshot/map-data terms, attribution, and whether the final app actually uses it |
| `public/models/earth.glb` | 3D Earth model file is present | Marketplace/source URL, creator, license, purchase details if paid, and final usage |
| `public/models/sun.glb` | 3D Sun model file is present | Marketplace/source URL, creator, license, purchase details if paid, and final usage |
| `/models/Moon_NASA_LRO_8k_Topo_Small.glb` | The homepage code references this local default path when no model URL override is supplied | Confirm that the file is actually included in the final release or set a working public model URL; confirm its exact NASA/source asset page and usage terms |

The code-reference scan did not establish a verified import/use for each of the five bundled Earth/Sun/texture files. Do not claim they are all used by the current user workflow based solely on their presence in the repository.

## Required asset owner confirmation

For each bundled image/model that remains in the final project, record:

1. Exact original source/product page URL (not just “NASA” or “Google”).
2. Creator, publisher, or marketplace seller.
3. Exact license or terms of use.
4. Purchase receipt/product page if purchased.
5. Whether the final submitted app actually uses the asset.
6. Required attribution wording.

If the source or permission cannot be established, replace the media with a verified asset or remove it from the final deployment. Keep the primary NASA source attribution separate from the provenance of decorative or third-party assets.

## Attribution statement

Lunex is an independent project. It uses or references NASA/JPL, LROC, and NASA-hosted data/services as described in the source register. This does not imply NASA endorsement or sponsorship.
