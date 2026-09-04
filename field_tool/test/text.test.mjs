// Pure-Node tests for text helpers. Inline copy of slugify/slugifyAssetId,
// framework-free. Keep in sync with src/lib/text.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const TR_MAP = {
  'ç': 'c', 'Ç': 'C', 'ğ': 'g', 'Ğ': 'G',
  'ı': 'i', 'İ': 'I', 'ö': 'o', 'Ö': 'O',
  'ş': 's', 'Ş': 'S', 'ü': 'u', 'Ü': 'U',
};

function slugify(input, opts) {
  const collapse = opts?.collapse ?? true;
  const caseMode = opts?.case ?? 'keep';
  const maxLen = opts?.maxLen;
  let s = input.replace(/[çÇğĞıİöÖşŞüÜ]/g, (c) => TR_MAP[c] ?? c);
  if (collapse) {
    s = s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  } else {
    s = s.replace(/[^\w\s.-]/g, '');
  }
  if (caseMode === 'upper') s = s.toUpperCase();
  else if (caseMode === 'lower') s = s.toLowerCase();
  if (maxLen !== undefined && maxLen >= 0 && s.length > maxLen) {
    s = s.slice(0, maxLen);
    if (collapse) s = s.replace(/-+$/, '');
  }
  return s;
}

function slugifyAssetId(input) {
  return slugify(input, { collapse: true, case: 'upper' });
}

test('TR transliteration (lowercase)', () => {
  assert.equal(slugify('Gelişyolu Kavşağı'), 'Gelisyolu-Kavsagi');
  assert.equal(slugify('çğışöü'), 'cgisou');
});

test('TR transliteration (uppercase preserved)', () => {
  assert.equal(slugify('ÇĞİŞÖÜ'), 'CGISOU');
});

test('mixed TR + ASCII', () => {
  assert.equal(slugify('ODTÜ Mobil AR'), 'ODTU-Mobil-AR');
  assert.equal(slugify('Sinyal 4 GRUP'), 'Sinyal-4-GRUP');
});

test('ASCII passthrough', () => {
  // `_` is non-alphanumeric so collapse:true replaces with `-`. Use
  // collapse:false for true passthrough if you need underscores preserved.
  assert.equal(slugify('ODTU_K01'), 'ODTU-K01');
  assert.equal(slugify('Hello-World-2026'), 'Hello-World-2026');
  assert.equal(slugify('ODTU_K01', { collapse: false }), 'ODTU_K01');
});

test('collapse multiple separators', () => {
  assert.equal(slugify('a  b   c'), 'a-b-c');
  assert.equal(slugify('a---b___c'), 'a-b-c');
});

test('trim leading/trailing separators', () => {
  assert.equal(slugify('  -hello-  '), 'hello');
  assert.equal(slugify('!!!abc!!!'), 'abc');
});

test('empty string stays empty', () => {
  assert.equal(slugify(''), '');
});

test('only separators → empty', () => {
  assert.equal(slugify('---'), '');
  assert.equal(slugify('   '), '');
});

test('case option: upper', () => {
  assert.equal(slugify('abc', { case: 'upper' }), 'ABC');
  assert.equal(slugify('Mixed Case 42', { case: 'upper' }), 'MIXED-CASE-42');
});

test('case option: lower', () => {
  assert.equal(slugify('ABC', { case: 'lower' }), 'abc');
  assert.equal(slugify('Mixed Case 42', { case: 'lower' }), 'mixed-case-42');
});

test('case option: keep (default)', () => {
  assert.equal(slugify('Mixed Case 42'), 'Mixed-Case-42');
});

test('collapse:false preserves spaces', () => {
  assert.equal(slugify('a b', { collapse: false }), 'a b');
  assert.equal(slugify('a  b', { collapse: false }), 'a  b');
});

test('maxLen truncates and trims trailing hyphens', () => {
  assert.equal(slugify('abcdefghij', { maxLen: 5 }), 'abcde');
  assert.equal(slugify('abc def ghij klm', { maxLen: 10 }), 'abc-def-gh');
  // When truncation lands mid-token, trailing '-' is stripped.
  assert.equal(slugify('abc def ghij klm', { maxLen: 7 }), 'abc-def');
});

test('slugifyAssetId: uppercase + collapse', () => {
  assert.equal(slugifyAssetId('a12-007'), 'A12-007');
  assert.equal(slugifyAssetId('Sinyal 4 Grup'), 'SINYAL-4-GRUP');
  assert.equal(slugifyAssetId('TEST DURAĞI'), 'TEST-DURAGI');
});

test('slugifyAssetId on empty', () => {
  assert.equal(slugifyAssetId(''), '');
});
