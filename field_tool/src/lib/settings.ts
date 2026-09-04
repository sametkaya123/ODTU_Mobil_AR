import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AssetType } from '@/types/domain';

export interface AppSettings {
  defaultType: AssetType;
  nextIntersectionCounter: number;
  intersectionIdPrefix: string;
  projectId: string;
  // Per-type asset counters — each type has its own monotonic sequence so
  // `ODTU_K01_SG_03` and `ODTU_K01_PN_01` don't share numbers. Old stored
  // blobs (single `nextAssetCounter`) keep working: spread merges them as
  // orphans and the next update() drops them naturally.
  nextSgCounter: number;
  nextStopCounter: number;
  nextPnCounter: number;
}

const DEFAULT_SETTINGS: AppSettings = {
  defaultType: 'traffic_signal',
  nextIntersectionCounter: 1,
  intersectionIdPrefix: 'K',
  projectId: 'ODTU',
  nextSgCounter: 1,
  nextStopCounter: 1,
  nextPnCounter: 1,
};

const KEY = 'ft/settings';

export const settings = {
  async get(): Promise<AppSettings> {
    try {
      const v = await AsyncStorage.getItem(KEY);
      if (!v) return DEFAULT_SETTINGS;
      // ponytail: old blobs may carry legacy keys (nextAssetCounter) — kept
      // as runtime orphans until next update() rewrites. No migration.
      return { ...DEFAULT_SETTINGS, ...JSON.parse(v) };
    } catch {
      return DEFAULT_SETTINGS;
    }
  },
  async update(patch: Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.get();
    const next = { ...current, ...patch };
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
    return next;
  },
  async reset(): Promise<void> {
    await AsyncStorage.removeItem(KEY);
  },
};

/** Maps AssetType → settings counter field name. Single truth source. */
export function nextCounterKey(type: AssetType): 'nextSgCounter' | 'nextStopCounter' | 'nextPnCounter' {
  switch (type) {
    case 'traffic_signal': return 'nextSgCounter';
    case 'bus_stop': return 'nextStopCounter';
    case 'cabinet': return 'nextPnCounter';
  }
}

export function suggestAssetId(
  intersectionId: string,
  typeCode: string,
  counter: number,
): string {
  const nn = String(counter).padStart(2, '0');
  return `${intersectionId}_${typeCode}_${nn}`;
}

export function suggestIntersectionId(
  counter: number,
  prefix: string,
  projectId: string,
): string {
  const nn = String(counter).padStart(2, '0');
  return `${projectId}_${prefix}${nn}`;
}

export const ASSET_TYPE_CODE: Record<AssetType, string> = {
  traffic_signal: 'SG',
  cabinet: 'PN',
  bus_stop: 'STOP',
};

export const ASSET_TYPE_EMOJI: Record<AssetType, string> = {
  traffic_signal: '🚥',
  cabinet: '⚡',
  bus_stop: '🚏',
};

// Canonical lowercase codes. Display uses CABINET_SUBTYPE_LABEL for Turkish text.
// Ana Pano + Diğer collapsed into `diger` (single chip with combined label).
export const CABINET_SUBTYPES = ['kkc', 'ups', 'og', 'diger'] as const;
export type CabinetSubtype = typeof CABINET_SUBTYPES[number];

export const CABINET_SUBTYPE_LABEL: Record<CabinetSubtype, string> = {
  kkc: 'KKC',
  ups: 'UPS',
  og: 'OG',
  diger: 'Ana Pano / Diğer',
};
