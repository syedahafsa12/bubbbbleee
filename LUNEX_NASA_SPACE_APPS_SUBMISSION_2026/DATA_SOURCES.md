# Data sources

Lunex is a prototype for exploring lunar south-pole landing positions and comparing local terrain with the apparent positions of the Sun and Earth. The following are the sources used by the application.

## NASA and space-agency data

### NASA Lunar Orbiter Laser Altimeter (LOLA), Product 78

- Product: [High-Resolution LOLA Topography for Lunar South Pole Sites](https://pgda.gsfc.nasa.gov/products/78)
- Data archive: [LOLA 5 m/pixel site products](https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/)
- Use in Lunex: elevation rasters for local terrain rendering, map-pixel selection, elevation sampling, and sampled terrain-horizon calculations.
- Prepared site rasters in the repository: Site04 (Shackleton Rim), Site11 (de Gerlache Rim), and Site23 (Malapert Massif). The site registry contains additional catalogue entries, but a registry entry does not mean a local raster is available.
- Raster metadata in the repository identifies a south-polar stereographic projection, MOON_ME reference frame, DE421 ephemeris, metre units, Float32 values, and 5 m grid spacing.

**Resolution note:** 5 m is the raster pixel spacing, not a claim that every pixel is an independent 5 m laser measurement. NASA's Product 78 description says approximately 90% of the 5 m pixels are interpolated because of LOLA's track and spot spacing. Lunex therefore describes this as a 5 m/pixel terrain grid, not 5 m raw measurement resolution.

The Product 78 catalogue also lists slope, slope-uncertainty, elevation-uncertainty, and LOLA observation-count products. The checked-in Site04 science metadata references these layers, but the corresponding four `.bin` layer files are not present in the repository tree audited for this document. Do not describe those layers as available in the submitted build unless the files are included and the endpoint has been checked.

### NASA/JPL Horizons

- API: [JPL Horizons API](https://ssd.jpl.nasa.gov/api/horizons.api)
- Documentation: [Horizons API documentation](https://ssd-api.jpl.nasa.gov/doc/horizons.html) and [Horizons system manual](https://ssd.jpl.nasa.gov/horizons/manual.html)
- Use in Lunex: server-side observer ephemerides for the Sun (target ID `10`) and Earth (target ID `399`) from the selected lunar surface observer. The application uses the returned time series and apparent sky-position information in its visibility analysis.

Horizons provides geometric/observer ephemeris information. Lunex compares the apparent target directions and angular sizes against its sampled local terrain profile. This is not a radio-frequency link budget, solar-array power model, thermal model, or landing-safety certification.

### NASA Moon Trek — LRO WAC South Pole mosaic

- Service: [NASA Moon Trek](https://trek.nasa.gov/moon/)
- Tile layer used in code: [LRO_WAC_Mosaic_SPole60_100mp](https://trek.nasa.gov/tiles/Moon/SP/LRO_WAC_Mosaic_SPole60_100mp/1.0.0/)
- Use in Lunex: regional lunar map context and map interaction. This mosaic is not used as the local elevation source; Product 78 supplies the local elevation raster.
- In-app attribution: NASA / JPL / LRO Wide Angle Camera.

### LROC controlled South Pole NAC average mosaic

- Product: [Controlled 1 m/pixel South Pole Average Mosaic](https://data.lroc.im-ldi.com/lroc/view_rdr/NAC_POLE_SOUTH_CM_AVG)
- Service used by the code: [Lunaserv WMS](https://wms.im-ldi.com/) with the layer `luna_nac_pole_control_south`.
- Use in Lunex: optional high-resolution image texture around a selected terrain position. It is an image overlay, not a terrain-elevation or live illumination data source.
- Product description: 1 m/pixel stereographic mosaic covering 84°S–90°S, distributed as 40 tiles.
- Suggested product citation from the LROC product page: B. Archinal, L. Weller, J. Richie, E. Lee, K. Bennett, E. Speyerer, and T. Tyburczy (2023), “Controlled High-Resolution LROC NAC Polar Mosaics,” Lunar and Planetary Science Conference, vol. 54, abstract 2333. [Abstract](https://www.hou.usra.edu/meetings/lpsc2023/pdf/2333.pdf).

### NASA LOLA Product 90 — optional regional terrain

- Product: [A New View of the Lunar South Pole from LOLA](https://pgda.gsfc.nasa.gov/products/90)
- Use in Lunex: optional regional terrain enhancement in the selected-location analysis when explicitly requested by the `includeProduct90=true` query parameter. It is not the default Product 78-only terrain path.
- Product 90 includes large-area south-polar DEM products at multiple pixel scales, including 20 m/pixel coverage.

## Sources not represented as a live integration

LROC QuickMap is a useful external mapping resource, but the audited application code does not make a direct QuickMap runtime request. It is not described here as an integrated Lunex data service.

## Technical and scientific limits

- The Product 78 5 m grid contains interpolated pixels, as described above.
- Terrain-horizon results apply to the available, sampled raster coverage. Terrain outside the raster boundary or beyond the configured search distance is not verified as clear.
- A target above the sampled terrain profile is not proof of complete global visibility.
- Earth visibility is geometric screening only; no communications link budget is calculated.
- Sun visibility is not a solar-power or thermal analysis.
- Lunex is a planning and visualization prototype, not flight software or a landing-safety certification.
