
export interface LocalDirection {
  east: number;
  north: number;
  up: number;
}

export interface CelestialEphemeris {
  sunAzimuth: number;
  sunElevation: number;
  earthAzimuth: number;
  earthElevation: number;
  isSunVisible: boolean;
  isEarthVisible: boolean;
  solarIlluminationPercentage: number;
  sunDirection: LocalDirection;
  earthDirection: LocalDirection;
  sunDistanceKm: number;
  earthDistanceKm: number;
  earthAngularRadius: number;
  geometricHorizonDepression: number;
}

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const JD_J2000 = 2451545.0;

const MOON_RADIUS_KM = 1737.4;
const EARTH_RADIUS_KM = 6378.137;
const AU_KM = 149597870.7;

// IAU 2015 / NAIF BODY301 lunar orientation arguments.
const E_CONST = [
  125.045, 250.089, 260.008, 176.625, 357.529,
  311.589, 134.963, 276.617, 34.226, 15.134,
  119.743, 239.961, 25.053,
];

const E_RATE = [
  -1935.5364525,
  -3871.072905,
  475263.3328725,
  487269.629985,
  35999.0509575,
  964468.49931,
  477198.869325,
  12006.300765,
  63863.5132425,
  -5806.6093575,
  131.84064,
  6003.1503825,
  473327.79642,
];

const RA_AMP = [
  -3.8787, -0.1204, 0.0700, -0.0172, 0,
  0.0072, 0, 0, 0, -0.0052, 0, 0, 0.0043,
];

const DEC_AMP = [
  1.5419, 0.0239, -0.0278, 0.0068, 0,
  -0.0029, 0.0009, 0, 0, 0.0008, 0, 0, -0.0009,
];

const PM_AMP = [
  3.5610, 0.1208, -0.0642, 0.0158, 0.0252,
  -0.0066, -0.0047, -0.0046, 0.0028, 0.0052,
  0.0040, 0.0019, -0.0044,
];

type Vec3 = [number, number, number];
type Mat3 = [Vec3, Vec3, Vec3];

function wrapDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);

  if (length === 0) {
    throw new Error("Cannot normalize a zero-length vector.");
  }

  return [v[0] / length, v[1] / length, v[2] / length];
}

function matrixMultiply(a: Mat3, b: Mat3): Mat3 {
  const result: Mat3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];

  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      result[row][column] =
        a[row][0] * b[0][column] +
        a[row][1] * b[1][column] +
        a[row][2] * b[2][column];
    }
  }

  return result;
}

function matrixVector(matrix: Mat3, vector: Vec3): Vec3 {
  return [
    dot(matrix[0], vector),
    dot(matrix[1], vector),
    dot(matrix[2], vector),
  ];
}

function transpose(matrix: Mat3): Mat3 {
  return [
    [matrix[0][0], matrix[1][0], matrix[2][0]],
    [matrix[0][1], matrix[1][1], matrix[2][1]],
    [matrix[0][2], matrix[1][2], matrix[2][2]],
  ];
}

function rotationZ(angle: number): Mat3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);

  return [
    [c, s, 0],
    [-s, c, 0],
    [0, 0, 1],
  ];
}

function rotationX(angle: number): Mat3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);

  return [
    [1, 0, 0],
    [0, c, s],
    [0, -s, c],
  ];
}

function julianDate(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}

/**
 * IAU 2015 lunar pole and prime-meridian orientation.
 * Returns the ICRF/J2000 -> lunar Mean-Earth body-fixed matrix.
 */
function lunarInertialToBodyFixed(jd: number): Mat3 {
  const d = jd - JD_J2000;
  const t = d / 36525;

  let ra = 269.9949 + 0.0031 * t;
  let dec = 66.5392 + 0.0130 * t;
  let w = 38.3213 + 13.17635815 * d - 1.4e-12 * d * d;

  for (let i = 0; i < 13; i++) {
    const argument = (E_CONST[i] + E_RATE[i] * t) * DEG;

    ra += RA_AMP[i] * Math.sin(argument);
    dec += DEC_AMP[i] * Math.cos(argument);
    w += PM_AMP[i] * Math.sin(argument);
  }

  return matrixMultiply(
    matrixMultiply(
      rotationZ(w * DEG),
      rotationX((90 - dec) * DEG)
    ),
    rotationZ((90 + ra) * DEG)
  );
}

/**
 * IAU 1976 precession transformation.
 * This transforms a J2000 equatorial vector into the mean equator
 * and equinox of the requested date.
 */
function precessJ2000ToDate(vector: Vec3, t: number): Vec3 {
  const zeta =
    (2306.2181 * t +
      0.30188 * t * t +
      0.017998 * t * t * t) /
    3600 *
    DEG;

  const z =
    (2306.2181 * t +
      1.09468 * t * t +
      0.018203 * t * t * t) /
    3600 *
    DEG;

  const theta =
    (2004.3109 * t -
      0.42665 * t * t -
      0.041833 * t * t * t) /
    3600 *
    DEG;

  const [x, y, zc] = normalize(vector);
  const ra = Math.atan2(y, x);
  const dec = Math.asin(Math.max(-1, Math.min(1, zc)));

  const a = Math.cos(dec) * Math.sin(ra + zeta);
  const b =
    Math.cos(theta) * Math.cos(dec) * Math.cos(ra + zeta) -
    Math.sin(theta) * Math.sin(dec);
  const c =
    Math.sin(theta) * Math.cos(dec) * Math.cos(ra + zeta) +
    Math.cos(theta) * Math.sin(dec);

  const raDate = Math.atan2(a, b) + z;
  const decDate = Math.asin(Math.max(-1, Math.min(1, c)));

  return [
    Math.cos(decDate) * Math.cos(raDate),
    Math.cos(decDate) * Math.sin(raDate),
    Math.sin(decDate),
  ];
}

function precessDateToJ2000(vector: Vec3, t: number): Vec3 {
  // The inverse of an orthogonal rotation is its transpose.
  const x = precessJ2000ToDate([1, 0, 0], t);
  const y = precessJ2000ToDate([0, 1, 0], t);
  const z = precessJ2000ToDate([0, 0, 1], t);

  const forward: Mat3 = [
    [x[0], y[0], z[0]],
    [x[1], y[1], z[1]],
    [x[2], y[2], z[2]],
  ];

  return normalize(matrixVector(transpose(forward), vector));
}

function eclipticToEquatorialDate(
  longitude: number,
  latitude: number
): Vec3 {
  const jd = longitude;
  void jd;

  const T = 0;
  void T;

  // Mean obliquity is supplied by the caller through the
  // date-aware conversion below.
  return [Math.cos(latitude) * Math.cos(longitude),
    Math.cos(latitude) * Math.sin(longitude),
    Math.sin(latitude)];
}

function meanObliquity(t: number): number {
  const arcseconds =
    84381.448 -
    46.8150 * t -
    0.00059 * t * t +
    0.001813 * t * t * t;

  return (arcseconds / 3600) * DEG;
}

function eclipticDateToEquatorialDate(
  longitude: number,
  latitude: number,
  t: number
): Vec3 {
  const ecliptic = eclipticToEquatorialDate(longitude, latitude);
  const obliquity = meanObliquity(t);

  return normalize([
    ecliptic[0],
    ecliptic[1] * Math.cos(obliquity) -
      ecliptic[2] * Math.sin(obliquity),
    ecliptic[1] * Math.sin(obliquity) +
      ecliptic[2] * Math.cos(obliquity),
  ]);
}

/**
 * Approximate geocentric solar vector in J2000 equatorial coordinates.
 */
function calculateSunVector(jd: number): {
  vector: Vec3;
  distanceKm: number;
} {
  const d = jd - JD_J2000;
  const t = d / 36525;

  const meanAnomaly = wrapDegrees(357.52911 + 0.98560028 * d) * DEG;
  const meanLongitude = wrapDegrees(280.46646 + 0.98564736 * d) * DEG;

  const longitude =
    meanLongitude +
    (1.914602 - 0.004817 * t - 0.000014 * t * t) *
      DEG *
      Math.sin(meanAnomaly) +
    (0.019993 - 0.000101 * t) *
      DEG *
      Math.sin(2 * meanAnomaly) +
    0.000289 * DEG * Math.sin(3 * meanAnomaly);

  const eccentricity = 0.016708634 - 0.000042037 * t;
  const distanceAU =
    1.000001018 * (1 - eccentricity * eccentricity) /
    (1 + eccentricity * Math.cos(meanAnomaly));

  const equatorialDate = eclipticDateToEquatorialDate(
    longitude,
    0,
    t
  );

  return {
    vector: precessDateToJ2000(equatorialDate, t),
    distanceKm: distanceAU * AU_KM,
  };
}

/**
 * Approximate geocentric lunar position using a compact orbital-elements
 * model. The output is in J2000 equatorial coordinates, in kilometres.
 */
function calculateMoonVector(jd: number): Vec3 {
  const d = jd - JD_J2000;
  const t = d / 36525;

  const ascendingNode =
    wrapDegrees(125.1228 - 0.0529538083 * d) * DEG;

  const inclination = 5.1454 * DEG;

  const argumentOfPerigee =
    wrapDegrees(318.0634 + 0.1643573223 * d) * DEG;

  const eccentricity = 0.0549;

  const meanAnomaly =
    wrapDegrees(115.3654 + 13.0649929509 * d) * DEG;

  let eccentricAnomaly = meanAnomaly;

  for (let i = 0; i < 8; i++) {
    eccentricAnomaly -=
      (eccentricAnomaly -
        eccentricity * Math.sin(eccentricAnomaly) -
        meanAnomaly) /
      (1 - eccentricity * Math.cos(eccentricAnomaly));
  }

  const xv = 60.2666 * (Math.cos(eccentricAnomaly) - eccentricity);
  const yv =
    60.2666 *
    Math.sqrt(1 - eccentricity * eccentricity) *
    Math.sin(eccentricAnomaly);

  const trueAnomaly = Math.atan2(yv, xv);
  const distanceEarthRadii = Math.hypot(xv, yv);

  const argument = trueAnomaly + argumentOfPerigee;

  const x =
    distanceEarthRadii *
    (Math.cos(ascendingNode) * Math.cos(argument) -
      Math.sin(ascendingNode) *
        Math.sin(argument) *
        Math.cos(inclination));

  const y =
    distanceEarthRadii *
    (Math.sin(ascendingNode) * Math.cos(argument) +
      Math.cos(ascendingNode) *
        Math.sin(argument) *
        Math.cos(inclination));

  const z =
    distanceEarthRadii *
    Math.sin(argument) *
    Math.sin(inclination);

  const eclipticDate = normalize([x, y, z]);

  const equatorialDate = eclipticDateToEquatorialDate(
    Math.atan2(eclipticDate[1], eclipticDate[0]),
    Math.asin(eclipticDate[2]),
    t
  );

  const equatorialJ2000 = precessDateToJ2000(equatorialDate, t);

  const distanceKm = distanceEarthRadii * 6378.14;

  return [
    equatorialJ2000[0] * distanceKm,
    equatorialJ2000[1] * distanceKm,
    equatorialJ2000[2] * distanceKm,
  ];
}

function localDirection(
  bodyFixedVector: Vec3,
  latitudeDeg: number,
  longitudeEastDeg: number
): LocalDirection {
  const latitude = latitudeDeg * DEG;
  const longitude = longitudeEastDeg * DEG;

  const up: Vec3 = [
    Math.cos(latitude) * Math.cos(longitude),
    Math.cos(latitude) * Math.sin(longitude),
    Math.sin(latitude),
  ];

  const east: Vec3 = [
    -Math.sin(longitude),
    Math.cos(longitude),
    0,
  ];

  const north: Vec3 = [
    -Math.sin(latitude) * Math.cos(longitude),
    -Math.sin(latitude) * Math.sin(longitude),
    Math.cos(latitude),
  ];

  const direction = normalize(bodyFixedVector);

  return {
    east: dot(direction, east),
    north: dot(direction, north),
    up: dot(direction, up),
  };
}

function azimuthElevation(direction: LocalDirection): {
  azimuth: number;
  elevation: number;
} {
  return {
    // Azimuth is clockwise from lunar north, in radians.
    azimuth: Math.atan2(direction.east, direction.north),
    elevation: Math.asin(
      Math.max(-1, Math.min(1, direction.up))
    ),
  };
}

/**
 * Calculate the local Sun and Earth directions at a lunar surface site.
 *
 * Inputs:
 * - date: JavaScript Date representing the mission timestamp in UTC.
 * - latitudeDeg: selenocentric latitude, north positive.
 * - longitudeEastDeg: east-positive lunar longitude in [0, 360).
 * - observerHeightMeters: height above the reference lunar radius.
 *
 * Angles are returned in radians.
 */
export function calculateEphemeris(
  date: Date,
  latitudeDeg: number,
  longitudeEastDeg: number,
  observerHeightMeters = 1.7
): CelestialEphemeris {
  if (!Number.isFinite(date.getTime())) {
    throw new Error("Invalid mission date supplied to ephemeris.");
  }

  if (
    !Number.isFinite(latitudeDeg) ||
    latitudeDeg < -90 ||
    latitudeDeg > 90
  ) {
    throw new Error("Invalid lunar latitude.");
  }

  if (
    !Number.isFinite(longitudeEastDeg) ||
    longitudeEastDeg < 0 ||
    longitudeEastDeg >= 360
  ) {
    throw new Error("Invalid east longitude.");
  }

  const jd = julianDate(date);
  const t = (jd - JD_J2000) / 36525;

  const inertialToBody = lunarInertialToBodyFixed(jd);

  const sun = calculateSunVector(jd);
  const moon = calculateMoonVector(jd);

  const sunBody = normalize(
    matrixVector(inertialToBody, sun.vector)
  );

  // The Earth direction is opposite the geocentric Moon vector.
  const earthFromMoon: Vec3 = [
    -moon[0],
    -moon[1],
    -moon[2],
  ];

  const earthCenterBody = matrixVector(
    inertialToBody,
    earthFromMoon
  );

  const latitude = latitudeDeg * DEG;
  const longitude = longitudeEastDeg * DEG;

  const observerRadiusKm =
    MOON_RADIUS_KM + observerHeightMeters / 1000;

  const observerPosition: Vec3 = [
    observerRadiusKm * Math.cos(latitude) * Math.cos(longitude),
    observerRadiusKm * Math.cos(latitude) * Math.sin(longitude),
    observerRadiusKm * Math.sin(latitude),
  ];

  // Correct Earth direction for the observer's displacement from
  // the Moon centre. This matters more for Earth than for the Sun.
  const earthFromObserver: Vec3 = [
    earthCenterBody[0] - observerPosition[0],
    earthCenterBody[1] - observerPosition[1],
    earthCenterBody[2] - observerPosition[2],
  ];

  const sunDirection = localDirection(
    sunBody,
    latitudeDeg,
    longitudeEastDeg
  );

  const earthDirection = localDirection(
    earthFromObserver,
    latitudeDeg,
    longitudeEastDeg
  );

  const sunAngles = azimuthElevation(sunDirection);
  const earthAngles = azimuthElevation(earthDirection);

  const earthDistanceKm = Math.hypot(
    earthFromObserver[0],
    earthFromObserver[1],
    earthFromObserver[2]
  );

  const earthAngularRadius = Math.asin(
    Math.min(1, EARTH_RADIUS_KM / earthDistanceKm)
  );

  const geometricHorizonDepression = Math.acos(
    MOON_RADIUS_KM / observerRadiusKm
  );

  const sunAngularRadius = 0.2666 * DEG;

  // Geometric horizon only. Local ridges and crater walls can still
  // obstruct either body; the LOLA horizon profile is a later step.
  const isSunVisible =
    sunAngles.elevation + sunAngularRadius >
    -geometricHorizonDepression;

  const isEarthVisible =
    earthAngles.elevation + earthAngularRadius >
    -geometricHorizonDepression;

  const solarIlluminationPercentage =
    Math.max(0, Math.sin(sunAngles.elevation)) * 100;

  return {
    sunAzimuth: wrapRadians(sunAngles.azimuth),
    sunElevation: sunAngles.elevation,
    earthAzimuth: wrapRadians(earthAngles.azimuth),
    earthElevation: earthAngles.elevation,
    isSunVisible,
    isEarthVisible,
    solarIlluminationPercentage,
    sunDirection,
    earthDirection,
    sunDistanceKm: sun.distanceKm,
    earthDistanceKm,
    earthAngularRadius,
    geometricHorizonDepression,
  };
}

function wrapRadians(value: number): number {
  const fullTurn = Math.PI * 2;
  return ((value % fullTurn) + fullTurn) % fullTurn;
}
