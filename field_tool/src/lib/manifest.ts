// Pure manifest builder. No side effects, no framework deps — testable in Node.
//
// Schema (Spec v1):
//   {
//     project_id: string,
//     intersection_name?: string,
//     intersection_id: string,
//     assets: [
//       {
//         asset_id, type, lat, lon,
//         signal_group_id | durak_kodu | cabinet_subtype:  (always for matching type, null if unknown),
//         description?, reference_images: ManifestReferenceImage[] (always present; [] if no shots)
//       }
//     ]
//   }
//
// Type-specific fields are EXCLUSIVE — only the field matching `type` appears
// in each asset. Unknown values are written as `null` (not omitted) so
// downstream consumers can rely on key presence. `reference_images` is always
// emitted (empty array when no shots exist) so feature-extraction scripts can
// index the field directly without `.get(...)` fallback.

import type { Asset, Intersection, PostureSlug, ReferenceImage } from '@/types/domain';

export interface ManifestReferenceImage {
  file: string;
  distance_m: number;
  angle: string;
  light: string;
  posture: PostureSlug;
  captured_at: string;
}

export interface ManifestAsset {
  asset_id: string;
  type: string;
  lat: number;
  lon: number;
  signal_group_id?: string | null;
  cabinet_subtype?: string | null;
  durak_kodu?: string | null;
  description?: string;
  backend_mapping?: string;
  /** Always present — empty array when no shots were captured. */
  reference_images: ManifestReferenceImage[];
}

export interface Manifest {
  project_id: string;
  intersection_name?: string;
  intersection_id: string;
  assets: ManifestAsset[];
}

export function buildManifest(
  intersection: Intersection,
  assets: readonly Asset[],
  shots: readonly ReferenceImage[],
  projectId: string,
): Manifest {
  const ixAssets = assets
    .filter((a) => a.intersection_id === intersection.intersection_id)
    .sort((a, b) => a.asset_id.localeCompare(b.asset_id));

  const shotsByAsset = new Map<string, ReferenceImage[]>();
  for (const s of shots) {
    const list = shotsByAsset.get(s.asset_id) ?? [];
    list.push(s);
    shotsByAsset.set(s.asset_id, list);
  }

  const outAssets: ManifestAsset[] = [];
  for (const a of ixAssets) {
    const aShots = (shotsByAsset.get(a.asset_id) ?? [])
      .slice()
      .sort((x, y) => x.file_index - y.file_index);

    const reference_images: ManifestReferenceImage[] = aShots.map((s) => ({
      file: `${a.asset_id}/${String(s.file_index).padStart(3, '0')}.jpg`,
      distance_m: s.distance_m,
      angle: s.angle,
      light: s.light,
      // Old shots without `posture` are treated as `ayakta` (back-compat).
      posture: (s.posture ?? 'ayakta') as PostureSlug,
      captured_at: s.captured_at,
    }));

    const m: ManifestAsset = {
      asset_id: a.asset_id,
      type: a.type,
      lat: a.lat,
      lon: a.lon,
      reference_images,
    };

    // Tip-bazlı alanlar. JSON.stringify undefined alanları atlar; null yazılırsa
    // alan korunur. Bu kombinasyon tip-özgü alanların SADECE ilgili tipte
    // görünmesini ve bilinmiyorsa null olmasını sağlar.
    if (a.type === 'traffic_signal') {
      m.signal_group_id = a.signal_group_id ?? null;
    }
    if (a.type === 'bus_stop') {
      m.durak_kodu = a.durak_kodu ?? null;
    }
    if (a.type === 'cabinet') {
      m.cabinet_subtype = a.cabinet_subtype ?? null;
    }

    if (a.description) m.description = a.description;
    if (a.backend_mapping) m.backend_mapping = a.backend_mapping;
    outAssets.push(m);
  }

  // Sıra: project_id → intersection_name? → intersection_id → assets.
  const out: Manifest = {
    project_id: projectId,
    ...(intersection.intersection_name
        ? { intersection_name: intersection.intersection_name }
        : {}),
    intersection_id: intersection.intersection_id,
    assets: outAssets,
  };
  return out;
}
