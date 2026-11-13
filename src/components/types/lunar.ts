// src/types/lunar.ts

export interface LandingSite {
  id: string;
  name: string;
  latitude: number; // Selenographic latitude (-90 to 90)
  longitude: number; // Selenographic longitude (0 to 360 or -180 to 180)
  description: string;
  elevationDataset: {
    name: string;
    resolutionMeters: number;
    sourceUrl: string;
    fileName: string;
  };
}

export interface CelestialEphemeris {
  sunAzimuth: number;    // Radians relative to local North
  sunElevation: number;  // Radians above/below horizon
  earthAzimuth: number;  // Radians relative to local North
  earthElevation: number;// Radians above/below horizon
  isSunVisible: boolean;
  isEarthVisible: boolean;
}

export interface TerrainMetadata {
  width: number;
  height: number;
  minElevation: number;
  maxElevation: number;
  resolutionMeters: number;
  crs: string; // e.g., "Moon South Polar Stereographic"
  centerLat: number;
  centerLon: number;
}

export interface IlluminationMetrics {
  solarElevationDeg: number;
  sunlitPercentage: number;
  shadowedPercentage: number;
  lineOfSightToEarth: boolean;
}