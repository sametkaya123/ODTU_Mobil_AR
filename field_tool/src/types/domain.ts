// Core domain types — kept framework-free so manifest builder and schema test can import directly.

export type AngleSlug =
  | 'on'
  | 'sag_capraz'
  | 'sol_capraz'
  | 'karsi_kaldirim'
  | 'yaklasma'
  | 'uzaklasma';

export type LightSlug = 'gunesli' | 'bulutlu' | 'golge' | 'gece';

/**
 * Phone hold-height / angle during capture. `ayakta` is the reference posture;
 * the others capture real-world variation (sitting, held high, tilted down).
 */
export type PostureSlug = 'ayakta' | 'oturarak' | 'yukari_egik' | 'asagi_egik';

export type AssetType = 'traffic_signal' | 'cabinet' | 'bus_stop';

export type DistanceM = 5 | 10 | 15 | 20 | 30;

export const DISTANCES: readonly DistanceM[] = [5, 10, 15, 20, 30] as const;

export interface Intersection {
  intersection_id: string;
  intersection_name?: string; // human-readable: "Gelişyolu Kavşağı"
  created_at: string; // ISO 8601 UTC
}

export interface Asset {
  intersection_id: string;
  asset_id: string;
  type: AssetType;
  lat: number;
  lon: number;
  // Type-specific fields. Always present (possibly null) for the matching type,
  // always absent for other types — the manifest serializer enforces this.
  signal_group_id?: string | null; // traffic_signal: SCADA/kontrolör group no, null if unknown
  cabinet_subtype?: string | null; // cabinet: "UPS", "KKC", etc.
  durak_kodu?: string | null;      // bus_stop: external AVL stop code, null if unknown
  description?: string; // free-text: "sağa dönüş", "kapalı durak", etc.
  backend_mapping?: string;
  created_at: string;
}

export interface ReferenceImage {
  asset_id: string;
  file_index: number; // 1..N per asset
  distance_m: DistanceM;
  angle: AngleSlug;
  light: LightSlug;
  posture: PostureSlug;
  captured_at: string; // ISO 8601 UTC
}

// Derived (never persisted): which distance×angle×light×posture combos are
// done for an asset. Old shots without `posture` are treated as `ayakta`
// (back-compat) so the checklist still reflects existing captures.
export function doneKeys(shots: readonly ReferenceImage[], assetId: string): Set<string> {
  const set = new Set<string>();
  for (const s of shots) {
    if (s.asset_id === assetId) {
      const p = s.posture ?? 'ayakta';
      set.add(`${s.distance_m}|${s.angle}|${s.light}|${p}`);
    }
  }
  return set;
}