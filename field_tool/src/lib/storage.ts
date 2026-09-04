// AsyncStorage helpers — three keys, each holding a JSON-serialized array.
// Source of truth for metadata; filesystem holds photo bytes separately.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Intersection, Asset, ReferenceImage } from '@/types/domain';

const K_INTERSECTIONS = 'ft/intersections';
const K_ASSETS = 'ft/assets';
const K_SHOTS = 'ft/shots';

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

export const storage = {
  async getIntersections(): Promise<Intersection[]> {
    return getArray<Intersection>(K_INTERSECTIONS);
  },
  async setIntersections(v: Intersection[]): Promise<void> {
    return setArray(K_INTERSECTIONS, v);
  },
  async addIntersection(i: Intersection): Promise<void> {
    const all = await storage.getIntersections();
    if (all.some((x) => x.intersection_id === i.intersection_id)) return;
    all.push(i);
    await storage.setIntersections(all);
  },
  async getAssets(): Promise<Asset[]> {
    return getArray<Asset>(K_ASSETS);
  },
  async getAssetsByIntersection(intersectionId: string): Promise<Asset[]> {
    const all = await storage.getAssets();
    return all.filter((a) => a.intersection_id === intersectionId);
  },
  async setAssets(v: Asset[]): Promise<void> {
    return setArray(K_ASSETS, v);
  },
  async addAsset(a: Asset): Promise<void> {
    const all = await storage.getAssets();
    if (all.some((x) => x.asset_id === a.asset_id)) return;
    all.push(a);
    await storage.setAssets(all);
  },
  async updateAsset(a: Asset): Promise<void> {
    const all = await storage.getAssets();
    const idx = all.findIndex((x) => x.asset_id === a.asset_id);
    if (idx >= 0) all[idx] = a;
    await storage.setAssets(all);
  },
  async removeAsset(assetId: string): Promise<void> {
    const all = await storage.getAssets();
    await storage.setAssets(all.filter((x) => x.asset_id !== assetId));
    await storage.removeShotsForAsset(assetId);
  },
  async getShots(): Promise<ReferenceImage[]> {
    return getArray<ReferenceImage>(K_SHOTS);
  },
  async getShotsByAsset(assetId: string): Promise<ReferenceImage[]> {
    const all = await storage.getShots();
    return all.filter((s) => s.asset_id === assetId);
  },
  async setShots(v: ReferenceImage[]): Promise<void> {
    return setArray(K_SHOTS, v);
  },
  async appendShot(s: ReferenceImage): Promise<void> {
    const all = await storage.getShots();
    all.push(s);
    await storage.setShots(all);
  },
  async removeLastShotForAsset(assetId: string): Promise<ReferenceImage | null> {
    const all = await storage.getShots();
    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i].asset_id === assetId) {
        const removed = all[i];
        all.splice(i, 1);
        await storage.setShots(all);
        return removed;
      }
    }
    return null;
  },
  async removeShot(assetId: string, fileIndex: number): Promise<boolean> {
    const all = await storage.getShots();
    const next = all.filter((s) => !(s.asset_id === assetId && s.file_index === fileIndex));
    if (next.length === all.length) return false;
    await storage.setShots(next);
    return true;
  },
  async removeShotsForAsset(assetId: string): Promise<void> {
    const all = await storage.getShots();
    await storage.setShots(all.filter((s) => s.asset_id !== assetId));
  },
};