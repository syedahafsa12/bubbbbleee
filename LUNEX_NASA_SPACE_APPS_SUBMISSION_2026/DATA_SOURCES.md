# Data sources

Lunex explores lunar south-pole landing locations using local elevation data and time-specific Sun and Earth positions. The following sources provide the datasets and imagery used by the application.

## NASA and space-agency data

### NASA Lunar Orbiter Laser Altimeter (LOLA), Product 78

- **Product:** [High-Resolution LOLA Topography for Lunar South Pole Sites](https://pgda.gsfc.nasa.gov/products/78)
- **Data archive:** [South Pole Landing Site LOLA DEMs](https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/)
- **Use in Lunex:** Local elevation rasters power terrain rendering, map-position selection, elevation sampling, and sampled terrain-horizon calculations.
- **Prepared locations:** Site04 — Shackleton Rim; Site11 — de Gerlache Rim; Site23 — Malapert Massif.
- **Raster metadata:** South Polar Stereographic projection; MOON_ME reference frame; DE421 ephemeris; metre units; Float32 elevation values; 5 m grid spacing.

Product 78 provides surface-interpolated elevation maps on a 5 m-per-pixel grid. NASA explains that approximately 90% of the grid pixels are interpolated because LOLA laser tracks and measurement spots do not cover every pixel. In Lunex, 5 m describes the grid spacing, not an independent laser measurement at every 5 m cell.

**Attribution:** NASA Goddard Space Flight Center, Planetary Geology, Geophysics and Geochemistry Laboratory (PGDA), Lunar Orbiter Laser Altimeter (LOLA), Product 78.

### NASA/JPL Horizons

- **API:** [JPL Horizons API](https://ssd.jpl.nasa.gov/api/horizons.api)
- **Documentation:** [Horizons API documentation](https://ssd-api.jpl.nasa.gov/doc/horizons.html) · [Horizons system manual](https://ssd.jpl.nasa.gov/horizons/manual.html)
- **Use in Lunex:** Provides time-specific observer ephemerides for the Sun (target ID `10`) and Earth (target ID `399`) as seen from a selected lunar-surface location. Lunex uses their apparent sky positions and angular sizes in its time-series visibility analysis.

**Attribution:** NASA / Jet Propulsion Laboratory (JPL), Solar System Dynamics Group, Horizons System.

### NASA Moon Trek — LRO Wide Angle Camera South Pole mosaic

- **Service:** [NASA Moon Trek](https://trek.nasa.gov/moon/)
- **Tile layer:** [LRO WAC South Pole mosaic](https://trek.nasa.gov/tiles/Moon/SP/LRO_WAC_Mosaic_SPole60_100mp/1.0.0/)
- **Use in Lunex:** Provides regional lunar map context for navigating the south-pole area. The local elevation surface and terrain calculations come from the Product 78 rasters.
- **Attribution:** NASA / JPL / Lunar Reconnaissance Orbiter (LRO) Wide Angle Camera (WAC).

### LROC controlled South Pole NAC average mosaic

- **Product:** [Controlled South Pole NAC Average Mosaic](https://data.lroc.im-ldi.com/lroc/view_rdr/NAC_POLE_SOUTH_CM_AVG)
- **Service:** [Lunaserv WMS](https://wms.im-ldi.com/), layer `luna_nac_pole_control_south`.
- **Use in Lunex:** Supplies optional high-resolution image texture around a selected terrain location. It is an imagery layer; Product 78 remains the elevation source.
- **Product coverage:** 1 m/pixel stereographic mosaic covering 84°S–90°S, distributed in 40 tiles.
- **Suggested product citation:** B. Archinal, L. Weller, J. Richie, E. Lee, K. Bennett, E. Speyerer, and T. Tyburczy (2023), “Controlled High-Resolution LROC NAC Polar Mosaics,” Lunar and Planetary Science Conference, vol. 54, abstract 2333. [Abstract 2333](https://www.hou.usra.edu/meetings/lpsc2023/pdf/2333.pdf).
- **Attribution:** NASA/GSFC/Arizona State University (ASU), Lunar Reconnaissance Orbiter Camera (LROC).

### Additional regional terrain source

NASA LOLA [Product 90 — A New View of the Lunar South Pole](https://pgda.gsfc.nasa.gov/products/90) is available as a supplementary regional dataset in an optional selected-location analysis path. It is not the primary terrain source for Lunex's prepared landing-site maps.

## How to interpret Lunex results

Lunex's terrain-horizon calculations use the available local Product 78 elevation coverage and sampled terrain profiles. The calculations describe the terrain represented within that coverage; areas beyond the raster boundary or configured search distance are outside the analysis.

Sun and Earth visibility results are geometric terrain-screening estimates. They do not calculate solar-array power, thermal performance, or a communications link budget. Lunex is a planning and visualization prototype, not flight software or a landing-safety certification.
