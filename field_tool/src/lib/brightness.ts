// Brightness override for Saha Modu.
// Saves current system brightness on lock, restores on unlock.
// Module-level singleton — app runs in single JS context, no race.

import * as Brightness from 'expo-brightness';

let savedBrightness: number | null = null;

export async function lockMaxBrightness(): Promise<void> {
  if (savedBrightness !== null) return;
  try {
    savedBrightness = await Brightness.getBrightnessAsync();
    await Brightness.setBrightnessAsync(1.0);
  } catch {
    // Older Android: write-only or unsupported. Silently skip.
  }
}

export async function restoreBrightness(): Promise<void> {
  if (savedBrightness === null) return;
  try {
    await Brightness.setBrightnessAsync(savedBrightness);
  } catch {
    // Best-effort restore.
  }
  savedBrightness = null;
}

export function isSahaBrightnessLocked(): boolean {
  return savedBrightness !== null;
}
