// AsyncStorage helpers.
// Source of truth for metadata; filesystem holds photo bytes separately.
//
// Intersections, assets, and shots are each stored as one array PER GROUP
// KEY (ft/<kind>/<groupId>) instead of one giant array for the whole app:
//   - shots grouped by asset_id
//   - assets grouped by intersection_id
//   - intersections grouped by their own intersection_id (group of one)
// Every access pattern in the app is already scoped this way (a capture
// session only touches its own asset's shots, editing a kavşak only touches
// that kavşak), so this bounds each read/write to that group's size instead
// of the total count across the whole app. With the old single-blob layout,
// one new photo re-parsed and re-serialized the entire app's shot history —
// cost grew with every photo ever taken, not just the current asset's — and
// the same shape of cost existed for assets/intersections, just with a
// smaller multiplier.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Intersection, Asset, ReferenceImage } from '@/types/domain';

async function getArray<T>(key: string): Promise<T[]> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    // Corrupt blob — surface empty rather than crash. User can clear app data.
    return [];
  }
}

async function setArray<T>(key: string, value: T[]): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

/**
 * A collection stored as one array per group key, plus a small index of
 * which group keys exist. Handles the one-time migration from an older
 * single-blob key holding every item across every group.
 */
function makeKeyedCollection<T>(opts: {
  prefix: string; // e.g. 'ft/shots' — index lives at `${prefix}/index`, groups at `${prefix}/<id>`
  legacyKey: string; // old single-blob key holding every item, migrated once then removed
  groupOf: (item: T) => string;
}) {
  const indexKey = `${opts.prefix}/index`;
  const groupKey = (id: string) => `${opts.prefix}/${id}`;

  async function getIndex(): Promise<string[]> {
    return getArray<string>(indexKey);
  }

  async function setGroup(id: string, items: T[]): Promise<void> {
    const idx = await getIndex();
    const has = idx.includes(id);
    if (items.length === 0) {
      await AsyncStorage.removeItem(groupKey(id));
      if (has) await setArray(indexKey, idx.filter((x) => x !== id));
      return;
    }
    await setArray(groupKey(id), items);
    if (!has) await setArray(indexKey, [...idx, id]);
  }

  let migration: Promise<void> | null = null;
  function ensureMigrated(): Promise<void> {
    if (!migration) {
      migration = (async () => {
        const legacyRaw = await AsyncStorage.getItem(opts.legacyKey);
        if (legacyRaw == null) return;
        let legacy: T[] = [];
        try {
          const parsed = JSON.parse(legacyRaw);
          if (Array.isArray(parsed)) legacy = parsed;
        } catch {
          /* corrupt legacy blob — nothing to migrate */
        }
        const byGroup = new Map<string, T[]>();
        for (const item of legacy) {
          const id = opts.groupOf(item);
          const list = byGroup.get(id);
          if (list) list.push(item);
          else byGroup.set(id, [item]);
        }
        for (const [id, items] of byGroup) {
          await setGroup(id, items);
        }
        await AsyncStorage.removeItem(opts.legacyKey);
      })();
    }
    return migration;
  }

  return {
    async getAll(): Promise<T[]> {
      await ensureMigrated();
      const idx = await getIndex();
      if (idx.length === 0) return [];
      const pairs = await AsyncStorage.multiGet(idx.map(groupKey));
      const out: T[] = [];
      for (const [, raw] of pairs) {
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) out.push(...parsed);
        } catch {
          /* skip corrupt entry */
        }
      }
      return out;
    },
    async getGroup(id: string): Promise<T[]> {
      await ensureMigrated();
      return getArray<T>(groupKey(id));
    },
    async replaceGroup(id: string, items: T[]): Promise<void> {
      await ensureMigrated();
      await setGroup(id, items);
    },
    /** Full replace across (possibly several) groups — rare; prefer replaceGroup. */
    async setAll(items: T[]): Promise<void> {
      await ensureMigrated();
      const byGroup = new Map<string, T[]>();
      for (const item of items) {
        const id = opts.groupOf(item);
        const list = byGroup.get(id);
        if (list) list.push(item);
        else byGroup.set(id, [item]);
      }
      const idx = await getIndex();
      for (const id of idx) {
        if (!byGroup.has(id)) await setGroup(id, []);
      }
      for (const [id, groupItems] of byGroup) {
        await setGroup(id, groupItems);
      }
    },
  };
}

const intersections = makeKeyedCollection<Intersection>({
  prefix: 'ft/intersections',
  legacyKey: 'ft/intersections',
  groupOf: (i) => i.intersection_id,
});

const assets = makeKeyedCollection<Asset>({
  prefix: 'ft/assets',
  legacyKey: 'ft/assets',
  groupOf: (a) => a.intersection_id,
});

const shots = makeKeyedCollection<ReferenceImage>({
  prefix: 'ft/shots',
  legacyKey: 'ft/shots',
  groupOf: (s) => s.asset_id,
});

export const storage = {
  async getIntersections(): Promise<Intersection[]> {
    return intersections.getAll();
  },
  async getIntersection(intersectionId: string): Promise<Intersection | null> {
    const group = await intersections.getGroup(intersectionId);
    return group[0] ?? null;
  },
  async setIntersections(v: Intersection[]): Promise<void> {
    return intersections.setAll(v);
  },
  async addIntersection(i: Intersection): Promise<void> {
    const existing = await intersections.getGroup(i.intersection_id);
    if (existing.length > 0) return;
    await intersections.replaceGroup(i.intersection_id, [i]);
  },
  async updateIntersection(i: Intersection): Promise<void> {
    await intersections.replaceGroup(i.intersection_id, [i]);
  },
  async removeIntersection(intersectionId: string): Promise<void> {
    await intersections.replaceGroup(intersectionId, []);
  },
  async getAssets(): Promise<Asset[]> {
    return assets.getAll();
  },
  async getAssetsByIntersection(intersectionId: string): Promise<Asset[]> {
    return assets.getGroup(intersectionId);
  },
  async setAssets(v: Asset[]): Promise<void> {
    return assets.setAll(v);
  },
  async addAsset(a: Asset): Promise<void> {
    const all = await assets.getGroup(a.intersection_id);
    if (all.some((x) => x.asset_id === a.asset_id)) return;
    all.push(a);
    await assets.replaceGroup(a.intersection_id, all);
  },
  async updateAsset(a: Asset): Promise<void> {
    const all = await assets.getGroup(a.intersection_id);
    const idx = all.findIndex((x) => x.asset_id === a.asset_id);
    if (idx >= 0) all[idx] = a;
    await assets.replaceGroup(a.intersection_id, all);
  },
  async removeAsset(a: Asset): Promise<void> {
    const all = await assets.getGroup(a.intersection_id);
    await assets.replaceGroup(a.intersection_id, all.filter((x) => x.asset_id !== a.asset_id));
    await storage.removeShotsForAsset(a.asset_id);
  },
  async getShots(): Promise<ReferenceImage[]> {
    return shots.getAll();
  },
  async getShotsByAsset(assetId: string): Promise<ReferenceImage[]> {
    return shots.getGroup(assetId);
  },
  async setShots(v: ReferenceImage[]): Promise<void> {
    return shots.setAll(v);
  },
  async appendShot(s: ReferenceImage): Promise<void> {
    const all = await shots.getGroup(s.asset_id);
    all.push(s);
    await shots.replaceGroup(s.asset_id, all);
  },
  async removeLastShotForAsset(assetId: string): Promise<ReferenceImage | null> {
    const all = await shots.getGroup(assetId);
    if (all.length === 0) return null;
    const removed = all.pop()!;
    await shots.replaceGroup(assetId, all);
    return removed;
  },
  async removeShot(assetId: string, fileIndex: number): Promise<boolean> {
    const all = await shots.getGroup(assetId);
    const next = all.filter((s) => s.file_index !== fileIndex);
    if (next.length === all.length) return false;
    await shots.replaceGroup(assetId, next);
    return true;
  },
  async removeShotsForAsset(assetId: string): Promise<void> {
    await shots.replaceGroup(assetId, []);
  },
};
