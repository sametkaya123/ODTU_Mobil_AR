// Pure-Node schema test for manifest builder. No RN/Expo deps — mirrors types by hand.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Inline copy of buildManifest, framework-free. Keep in sync with src/lib/manifest.ts.
function buildManifest(intersection, assets, shots, projectId) {
  const ixAssets = assets
    .filter((a) => a.intersection_id === intersection.intersection_id)
    .sort((a, b) => a.asset_id.localeCompare(b.asset_id));

  const shotsByAsset = new Map();
  for (const s of shots) {
    const list = shotsByAsset.get(s.asset_id) ?? [];
    list.push(s);
    shotsByAsset.set(s.asset_id, list);
  }

  const outAssets = [];
  for (const a of ixAssets) {
    const aShots = (shotsByAsset.get(a.asset_id) ?? [])
      .slice()
      .sort((x, y) => x.file_index - y.file_index);
    const reference_images = aShots.map((s) => ({
      file: `${a.asset_id}/${String(s.file_index).padStart(3, '0')}.jpg`,
      distance_m: s.distance_m,
      angle: s.angle,
      light: s.light,
      // Old shots without `posture` are treated as `ayakta` (back-compat).
      posture: s.posture ?? 'ayakta',
      captured_at: s.captured_at,
    }));
    const m = { asset_id: a.asset_id, type: a.type, lat: a.lat, lon: a.lon, reference_images };
    // Tip-bazlı alanlar: SADECE ilgili tip için yaz. JSON.stringify undefined'i atlar, null korur.
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
  const out = {
    project_id: projectId,
    ...(intersection.intersection_name
        ? { intersection_name: intersection.intersection_name }
        : {}),
    intersection_id: intersection.intersection_id,
    assets: outAssets,
  };
  return out;
}

// Fixture: ODTU_K01 — 1 signal, 1 stop, 1 cabinet; 30 combos on signal asset.
const PROJECT = 'ODTU';
const ix = { intersection_id: 'ODTU_K01', created_at: '2026-09-04T11:00:00.000Z' };
const assets = [
  { intersection_id: 'ODTU_K01', asset_id: 'ODTU_K01_SG_01', type: 'traffic_signal',
    lat: 39.891, lon: 32.781, signal_group_id: 'SG01', created_at: '2026-09-04T11:01:00.000Z' },
  { intersection_id: 'ODTU_K01', asset_id: 'ODTU_K01_PN_01', type: 'cabinet',
    lat: 39.892, lon: 32.782, description: 'KKC panosu', created_at: '2026-09-04T11:02:00.000Z' },
  { intersection_id: 'ODTU_K01', asset_id: 'ODTU_K01_STOP_01', type: 'bus_stop',
    lat: 39.893, lon: 32.783, created_at: '2026-09-04T11:03:00.000Z' },
];

const DISTANCES = [5, 10, 15, 20, 30];
const ANGLES = ['on', 'sag_capraz', 'sol_capraz', 'karsi_kaldirim', 'yaklasma', 'uzaklasma'];
const LIGHTS = ['gunesli', 'bulutlu', 'golge', 'gece'];
const POSTURES = ['ayakta', 'oturarak', 'yukari_egik', 'asagi_egik'];

const shots = [];
let idx = 1;
for (const d of DISTANCES) {
  for (const a of ANGLES) {
    const light = LIGHTS[(idx - 1) % LIGHTS.length];
    const posture = POSTURES[(idx - 1) % POSTURES.length];
    shots.push({
      asset_id: 'ODTU_K01_SG_01',
      file_index: idx++,
      distance_m: d,
      angle: a,
      light,
      posture,
      captured_at: new Date(2026, 8, 4, 11, idx).toISOString(),
    });
  }
}

test('asset list sorted alphabetically', () => {
  const m = buildManifest(ix, assets, shots, PROJECT);
  assert.equal(m.assets[0].asset_id, 'ODTU_K01_PN_01');
  assert.equal(m.assets[1].asset_id, 'ODTU_K01_SG_01');
  assert.equal(m.assets[2].asset_id, 'ODTU_K01_STOP_01');
});

test('signal asset has 30 reference_images with all combos', () => {
  const m = buildManifest(ix, assets, shots, PROJECT);
  const sg = m.assets.find((a) => a.asset_id === 'ODTU_K01_SG_01');
  assert.equal(sg.reference_images.length, 30);
  const keys = new Set(sg.reference_images.map((r) => `${r.distance_m}|${r.angle}`));
  for (const d of DISTANCES) {
    for (const a of ANGLES) {
      assert.ok(keys.has(`${d}|${a}`), `missing combo ${d}|${a}`);
    }
  }
});

test('file path uses padded 3-digit index', () => {
  const m = buildManifest(ix, assets, shots, PROJECT);
  const first = m.assets.find((a) => a.asset_id === 'ODTU_K01_SG_01').reference_images[0];
  assert.equal(first.file, 'ODTU_K01_SG_01/001.jpg');
});

test('shots sorted by file_index', () => {
  const m = buildManifest(ix, assets, shots, PROJECT);
  const refs = m.assets.find((a) => a.asset_id === 'ODTU_K01_SG_01').reference_images;
  for (let i = 1; i < refs.length; i++) {
    const prev = parseInt(refs[i - 1].file.slice(-7, -4), 10);
    const cur = parseInt(refs[i].file.slice(-7, -4), 10);
    assert.ok(cur > prev, `not sorted: ${refs[i - 1].file} then ${refs[i].file}`);
  }
});

test('asset with no shots has empty reference_images array', () => {
  const m = buildManifest(ix, assets, [], PROJECT); // no shots
  for (const a of m.assets) {
    assert.ok('reference_images' in a, `${a.asset_id} should carry reference_images key`);
    assert.ok(Array.isArray(a.reference_images), `${a.asset_id}.reference_images must be array`);
    assert.equal(a.reference_images.length, 0, `${a.asset_id} should have empty reference_images`);
  }
});

test('asset with description keeps it (cabinet "KKC panosu")', () => {
  const m = buildManifest(ix, assets, [], PROJECT);
  const cab = m.assets.find((a) => a.asset_id === 'ODTU_K01_PN_01');
  assert.equal(cab.description, 'KKC panosu');
});

test('asset without description omits the field', () => {
  const m = buildManifest(ix, assets, [], PROJECT);
  const sg = m.assets.find((a) => a.asset_id === 'ODTU_K01_SG_01');
  assert.equal('description' in sg, false);
});

test('light slug round-trip preserves all 4 values', () => {
  const m = buildManifest(ix, assets, shots, PROJECT);
  const lights = new Set(m.assets[1].reference_images.map((r) => r.light));
  assert.equal(lights.size, 4);
  for (const l of LIGHTS) assert.ok(lights.has(l));
});

test('intersection_id appears at top level', () => {
  const m = buildManifest(ix, assets, shots, PROJECT);
  assert.equal(m.intersection_id, 'ODTU_K01');
});

test('assets of other intersections excluded', () => {
  const ix2 = { intersection_id: 'ODTU_K02', created_at: '' };
  const otherAssets = [
    { intersection_id: 'ODTU_K02', asset_id: 'ODTU_K02_SG_01', type: 'traffic_signal',
      lat: 0, lon: 0, created_at: '' },
  ];
  const m = buildManifest(ix2, otherAssets, [], PROJECT);
  assert.equal(m.assets.length, 1);
  assert.equal(m.assets[0].asset_id, 'ODTU_K02_SG_01');
});

test('cabinet with cabinet_subtype: null when unknown', () => {
  const m = buildManifest(ix, assets, [], PROJECT);
  const cab = m.assets.find((a) => a.asset_id === 'ODTU_K01_PN_01');
  assert.equal(cab.cabinet_subtype, null);
});

test('cabinet with cabinet_subtype keeps its value', () => {
  const assets2 = [{ ...assets[1], cabinet_subtype: 'UPS' }];
  const m = buildManifest(ix, assets2, [], PROJECT);
  assert.equal(m.assets[0].cabinet_subtype, 'UPS');
});

test('cabinet asset has no signal_group_id or durak_kodu key', () => {
  const m = buildManifest(ix, assets, [], PROJECT);
  const cab = m.assets.find((a) => a.asset_id === 'ODTU_K01_PN_01');
  assert.equal('signal_group_id' in cab, false);
  assert.equal('durak_kodu' in cab, false);
});

test('traffic_signal with signal_group_id keeps it', () => {
  const m = buildManifest(ix, assets, [], PROJECT);
  const sg = m.assets.find((a) => a.asset_id === 'ODTU_K01_SG_01');
  assert.equal(sg.signal_group_id, 'SG01');
});

test('traffic_signal with no signal_group_id emits null', () => {
  const sgNoGroup = [{ ...assets[0], signal_group_id: undefined }];
  const m = buildManifest(ix, sgNoGroup, [], PROJECT);
  assert.equal(m.assets[0].signal_group_id, null);
});

test('traffic_signal asset has no durak_kodu or cabinet_subtype key', () => {
  const m = buildManifest(ix, assets, [], PROJECT);
  const sg = m.assets.find((a) => a.asset_id === 'ODTU_K01_SG_01');
  assert.equal('durak_kodu' in sg, false);
  assert.equal('cabinet_subtype' in sg, false);
});

test('bus_stop with no durak_kodu emits null', () => {
  const m = buildManifest(ix, assets, [], PROJECT);
  const stop = m.assets.find((a) => a.asset_id === 'ODTU_K01_STOP_01');
  assert.equal(stop.durak_kodu, null);
});

test('bus_stop with durak_kodu keeps its value', () => {
  const stopWithCode = [{ ...assets[2], durak_kodu: 'A12-007' }];
  const m = buildManifest(ix, stopWithCode, [], PROJECT);
  assert.equal(m.assets[0].durak_kodu, 'A12-007');
});

test('bus_stop asset has no signal_group_id or cabinet_subtype key', () => {
  const m = buildManifest(ix, assets, [], PROJECT);
  const stop = m.assets.find((a) => a.asset_id === 'ODTU_K01_STOP_01');
  assert.equal('signal_group_id' in stop, false);
  assert.equal('cabinet_subtype' in stop, false);
});

test('intersection with intersection_name keeps it at top level', () => {
  const ixNamed = { intersection_id: 'K03', intersection_name: 'Gelişyolu Kavşağı', created_at: '' };
  const m = buildManifest(ixNamed, [], [], PROJECT);
  assert.equal(m.intersection_name, 'Gelişyolu Kavşağı');
});

test('intersection without intersection_name omits the field', () => {
  const m = buildManifest(ix, [], [], PROJECT);
  assert.equal('intersection_name' in m, false);
});

test('project_id appears at top level', () => {
  const m = buildManifest(ix, [], [], 'TEST');
  assert.equal(m.project_id, 'TEST');
});

test('manifest field order: project_id → intersection_name → intersection_id → assets', () => {
  const ixNamed = { intersection_id: 'ODTU_K01', intersection_name: 'ODTÜ', created_at: '' };
  const m = buildManifest(ixNamed, [], [], PROJECT);
  const keys = Object.keys(m);
  assert.deepEqual(keys, ['project_id', 'intersection_name', 'intersection_id', 'assets']);
});

test('manifest without intersection_name: project_id → intersection_id → assets', () => {
  const m = buildManifest(ix, [], [], PROJECT);
  const keys = Object.keys(m);
  assert.deepEqual(keys, ['project_id', 'intersection_id', 'assets']);
});

test('asset_id prefix: traffic_signal=SG, cabinet=PN, bus_stop=STOP', () => {
  const m = buildManifest(ix, assets, [], PROJECT);
  const ids = new Set(m.assets.map((a) => a.asset_id));
  assert.ok(ids.has('ODTU_K01_SG_01'), 'traffic_signal id should end in SG_01');
  assert.ok(ids.has('ODTU_K01_PN_01'), 'cabinet id should end in PN_01');
  assert.ok(ids.has('ODTU_K01_STOP_01'), 'bus_stop id should end in STOP_01');
});

// ── posture (Spec v2) ────────────────────────────────────────────────

test('every reference_image carries a posture field', () => {
  const m = buildManifest(ix, assets, shots, PROJECT);
  const sg = m.assets.find((a) => a.asset_id === 'ODTU_K01_SG_01');
  for (const r of sg.reference_images) {
    assert.ok('posture' in r, `shot ${r.file} missing posture`);
    assert.ok(POSTURES.includes(r.posture), `invalid posture: ${r.posture}`);
  }
});

test('posture defaults to ayakta for legacy shots without the field', () => {
  const legacyShots = [{
    asset_id: 'ODTU_K01_SG_01',
    file_index: 1,
    distance_m: 5,
    angle: 'on',
    light: 'gunesli',
    captured_at: '2026-09-04T11:00:00.000Z',
    // no posture key — simulates pre-Spec v2 storage
  }];
  const m = buildManifest(ix, assets, legacyShots, PROJECT);
  const sg = m.assets.find((a) => a.asset_id === 'ODTU_K01_SG_01');
  assert.equal(sg.reference_images[0].posture, 'ayakta');
});

test('posture cycles through all 4 values across 30 fixture shots', () => {
  const m = buildManifest(ix, assets, shots, PROJECT);
  const sg = m.assets.find((a) => a.asset_id === 'ODTU_K01_SG_01');
  const got = new Set(sg.reference_images.map((r) => r.posture));
  assert.equal(got.size, 4);
  for (const p of POSTURES) assert.ok(got.has(p), `posture ${p} missing from fixture`);
});

test('shot without posture key still emits posture key in manifest (back-compat)', () => {
  const legacyShots = [{
    asset_id: 'ODTU_K01_SG_01',
    file_index: 1,
    distance_m: 5,
    angle: 'on',
    light: 'gunesli',
    captured_at: '2026-09-04T11:00:00.000Z',
  }];
  const m = buildManifest(ix, assets, legacyShots, PROJECT);
  const r = m.assets.find((a) => a.asset_id === 'ODTU_K01_SG_01').reference_images[0];
  assert.ok('posture' in r);
  assert.equal(r.posture, 'ayakta');
});
