
from pyproj import CRS, Transformer

# Site04 geographic observation point
latitude = -89.7668
longitude_east = 188.13

# NASA LOLA spherical lunar radius
lunar_radius = 1737400

# Geographic coordinates on a spherical Moon
geographic_crs = CRS.from_proj4(
    f"+proj=longlat +R={lunar_radius} +no_defs +type=crs"
)

# Conventional south-polar stereographic projection
projected_crs = CRS.from_proj4(
    f"+proj=stere +lat_0=-90 +lon_0=0 "
    f"+k_0=1 +R={lunar_radius} +units=m +no_defs +type=crs"
)

transformer = Transformer.from_crs(
    geographic_crs,
    projected_crs,
    always_xy=True
)

proj_x, proj_y = transformer.transform(
    longitude_east,
    latitude
)

# Our JavaScript implementation
rho = 2 * lunar_radius * __import__("math").tan(
    (90 + latitude) * __import__("math").pi / 360
)

import math

our_x = rho * math.sin(math.radians(longitude_east))
our_y = rho * math.cos(math.radians(longitude_east))

# NASA raster bounds
min_x, min_y, max_x, max_y = -9000, -15000, 7000, 1000

def inside_raster(x, y):
    return min_x <= x <= max_x and min_y <= y <= max_y

print("\n=== INDEPENDENT PROJ VALIDATION ===")

print("\nPROJ standard south-polar result:")
print({
    "x": proj_x,
    "y": proj_y,
    "insideRaster": inside_raster(proj_x, proj_y)
})

print("\nPROJ result with Y-axis reversed:")
print({
    "x": proj_x,
    "y": -proj_y,
    "insideRaster": inside_raster(proj_x, -proj_y)
})

print("\nOur JavaScript projection:")
print({
    "x": our_x,
    "y": our_y,
    "insideRaster": inside_raster(our_x, our_y)
})

print("\n=== DIFFERENCES ===")

print({
    "xDifference": abs(proj_x - our_x),
    "yDifferenceStandard": abs(proj_y - our_y),
    "yDifferenceReversed": abs(-proj_y - our_y)
})
