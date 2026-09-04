// GPS median-of-3 helper. Returns null if any reading fails.

import * as Location from 'expo-location';

export interface Reading {
  lat: number;
  lon: number;
}

export async function medianPosition(): Promise<Reading | null> {
  const samples: Reading[] = [];
  for (let i = 0; i < 3; i++) {
    try {
      const r = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      samples.push({ lat: r.coords.latitude, lon: r.coords.longitude });
    } catch {
      // one bad reading is allowed; keep going
    }
    if (i < 2) await new Promise((r) => setTimeout(r, 1000));
  }
  if (samples.length === 0) return null;
  const lats = samples.map((s) => s.lat).sort((a, b) => a - b);
  const lons = samples.map((s) => s.lon).sort((a, b) => a - b);
  const mid = Math.floor(lats.length / 2);
  return { lat: lats[mid], lon: lons[mid] };
}