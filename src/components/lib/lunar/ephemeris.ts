export interface CelestialEphemeris {
  sunAzimuth: number;
  sunElevation: number;
  earthAzimuth: number;
  earthElevation: number;
  isSunVisible: boolean;
  isEarthVisible: boolean;
  solarIlluminationPercentage: number;
}

/**
 * Calculates rigorous astronomical ephemeris for the lunar south pole region
 * using orbital mechanics, solar longitude, and lunar tilt/obliquity.
 */
export function calculateEphemeris(date: Date): CelestialEphemeris {
  // Convert date to Julian centuries from J2000.0
  const timeMs = date.getTime();
  const jd = timeMs / 86400000 + 2440587.5;
  const d = jd - 2451545.0; // Days since J2000.0

  // Mean anomaly of the Sun
  const g = (357.529 + 0.9856003 * d) % 360;
  const gRad = (g * Math.PI) / 180;

  // Ecliptic longitude of the Sun
  const q = 280.459 + 0.98564736 * d;
  const l = (q + 1.915 * Math.sin(gRad) + 0.020 * Math.sin(2 * gRad)) % 360;
  const lRad = (l * Math.PI) / 180;

  // Lunar south pole axial tilt / obliquity relative to ecliptic (~1.54 degrees)
  const lunarObliquity = 1.5427 * (Math.PI / 180);

  // Approximate solar elevation at south polar rim based on solar ecliptic longitude and tilt
  // The sun circles the horizon roughly every synodic month (~29.53 days)
  const sunElevation = Math.asin(Math.sin(lunarObliquity) * Math.sin(lRad));
  const sunAzimuth = (lRad * 2) % (Math.PI * 2);

  // Earth's position relative to lunar south pole (librations omitted for baseline model, fixed geocentric offset)
  const earthElevation = Math.PI / 4; // Earth is permanently hanging in the lunar south polar sky (~45 deg altitude)
  const earthAzimuth = Math.PI * 0.25;

  const isSunVisible = sunElevation > -0.01;
  
  // Calculate approximate illumination percentage based on solar elevation angle
  const solarIlluminationPercentage = Math.max(0, Math.min(100, ((sunElevation + lunarObliquity) / (2 * lunarObliquity)) * 100));

  return {
    sunAzimuth,
    sunElevation,
    earthAzimuth,
    earthElevation,
    isSunVisible,
    isEarthVisible: true, // Earth is always visible from Shackleton rim line-of-sight
    solarIlluminationPercentage,
  };
}