// Pure-Node tests for the keyed-collection storage scheme (shots grouped by
// asset_id, assets grouped by intersection_id, intersections grouped by
// their own id). Inline copy of the logic from src/lib/storage.ts against a
// fake AsyncStorage (no native module available under plain Node).
// Keep in sync with src/lib/storage.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';

function makeFakeAsyncStorage() {
  const map = new Map();
  return {
    map,
    async getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    async setItem(key, value) {
      map.set(key, value);
    },
    async removeItem(key) {
      map.delete(key);
    },
    async multiGet(keys) {
      return keys.map((k) => [k, map.has(k) ? map.get(k) : null]);
    },
  };
}

function makeKeyedCollection(AsyncStorage, opts) {
  const indexKey = `${opts.prefix}/index`;
  const groupKey = (id) => `${opts.prefix}/${id}`;

  async function getArray(key) {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  async function setArray(key, value) {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  }
  async function getIndex() {
    return getArray(indexKey);
  }
  async function setGroup(id, items) {
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

  let migration = null;
  function ensureMigrated() {
    if (!migration) {
      migration = (async () => {
        const legacyRaw = await AsyncStorage.getItem(opts.legacyKey);
        if (legacyRaw == null) return;
        let legacy = [];
        try {
          const parsed = JSON.parse(legacyRaw);
          if (Array.isArray(parsed)) legacy = parsed;
        } catch {
          /* corrupt legacy blob */
        }
        const byGroup = new Map();
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
    async getAll() {
      await ensureMigrated();
      const idx = await getIndex();
      if (idx.length === 0) return [];
      const pairs = await AsyncStorage.multiGet(idx.map(groupKey));
      const out = [];
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
    async getGroup(id) {
      await ensureMigrated();
      return getArray(groupKey(id));
    },
    async replaceGroup(id, items) {
      await ensureMigrated();
      await setGroup(id, items);
    },
  };
}

test('per-asset shots: appendShot only touches its own asset key, not a global blob', async () => {
  const AsyncStorage = makeFakeAsyncStorage();
  const shots = makeKeyedCollection(AsyncStorage, {
    prefix: 'ft/shots',
    legacyKey: 'ft/shots',
    groupOf: (s) => s.asset_id,
  });

  async function appendShot(s) {
    const all = await shots.getGroup(s.asset_id);
    all.push(s);
    await shots.replaceGroup(s.asset_id, all);
  }

  await appendShot({ asset_id: 'A1', file_index: 1 });
  await appendShot({ asset_id: 'A2', file_index: 1 });
  await appendShot({ asset_id: 'A1', file_index: 2 });

  assert.deepEqual(await shots.getGroup('A1'), [
    { asset_id: 'A1', file_index: 1 },
    { asset_id: 'A1', file_index: 2 },
  ]);
  assert.deepEqual(await shots.getGroup('A2'), [{ asset_id: 'A2', file_index: 1 }]);
  assert.equal(AsyncStorage.map.has('ft/shots/A1'), true);
  assert.equal(AsyncStorage.map.has('ft/shots/A2'), true);
  assert.equal(AsyncStorage.map.has('ft/shots'), false); // no single ever-growing key

  const all = await shots.getAll();
  assert.equal(all.length, 3);
});

test('per-intersection assets: addAsset only touches its own intersection key', async () => {
  const AsyncStorage = makeFakeAsyncStorage();
  const assets = makeKeyedCollection(AsyncStorage, {
    prefix: 'ft/assets',
    legacyKey: 'ft/assets',
    groupOf: (a) => a.intersection_id,
  });

  async function addAsset(a) {
    const all = await assets.getGroup(a.intersection_id);
    if (all.some((x) => x.asset_id === a.asset_id)) return;
    all.push(a);
    await assets.replaceGroup(a.intersection_id, all);
  }
  async function removeAsset(a) {
    const all = await assets.getGroup(a.intersection_id);
    await assets.replaceGroup(a.intersection_id, all.filter((x) => x.asset_id !== a.asset_id));
  }

  await addAsset({ intersection_id: 'IX1', asset_id: 'A1' });
  await addAsset({ intersection_id: 'IX1', asset_id: 'A2' });
  await addAsset({ intersection_id: 'IX2', asset_id: 'B1' });

  assert.equal((await assets.getGroup('IX1')).length, 2);
  assert.equal((await assets.getGroup('IX2')).length, 1);
  assert.equal((await assets.getAll()).length, 3);

  await removeAsset({ intersection_id: 'IX1', asset_id: 'A1' });
  assert.deepEqual(await assets.getGroup('IX1'), [{ intersection_id: 'IX1', asset_id: 'A2' }]);
  assert.equal(AsyncStorage.map.has('ft/assets'), false);
});

test('intersections: each kavşak lives at its own key (group of one)', async () => {
  const AsyncStorage = makeFakeAsyncStorage();
  const intersections = makeKeyedCollection(AsyncStorage, {
    prefix: 'ft/intersections',
    legacyKey: 'ft/intersections',
    groupOf: (i) => i.intersection_id,
  });

  await intersections.replaceGroup('IX1', [{ intersection_id: 'IX1', intersection_name: 'A' }]);
  await intersections.replaceGroup('IX2', [{ intersection_id: 'IX2', intersection_name: 'B' }]);
  await intersections.replaceGroup('IX1', [{ intersection_id: 'IX1', intersection_name: 'Renamed' }]);

  const [ix1] = await intersections.getGroup('IX1');
  assert.equal(ix1.intersection_name, 'Renamed');
  assert.equal((await intersections.getAll()).length, 2);

  await intersections.replaceGroup('IX1', []); // delete
  assert.equal((await intersections.getAll()).length, 1);
  assert.equal(AsyncStorage.map.has('ft/intersections/IX1'), false);
});

test('legacy single-blob key is migrated into per-group keys once, then removed', async () => {
  const AsyncStorage = makeFakeAsyncStorage();
  await AsyncStorage.setItem(
    'ft/shots',
    JSON.stringify([
      { asset_id: 'A1', file_index: 1 },
      { asset_id: 'A1', file_index: 2 },
      { asset_id: 'A2', file_index: 1 },
    ]),
  );
  const shots = makeKeyedCollection(AsyncStorage, {
    prefix: 'ft/shots',
    legacyKey: 'ft/shots',
    groupOf: (s) => s.asset_id,
  });

  const byAsset1 = await shots.getGroup('A1');
  assert.deepEqual(byAsset1, [
    { asset_id: 'A1', file_index: 1 },
    { asset_id: 'A1', file_index: 2 },
  ]);
  assert.equal(AsyncStorage.map.has('ft/shots'), false); // legacy key consumed
  assert.equal((await shots.getAll()).length, 3);
});
