// Photo filesystem helpers. Photo bytes live in documentDirectory.
// Layout: photos/<intersection_id>/<asset_id>/<NNN>.jpg
//
// Uses the expo-file-system/legacy module — works on Android, iOS, AND web,
// which the new SDK 56/57 object-oriented API does not on web (validatePath
// is missing on the web polyfill).

import * as FS from 'expo-file-system/legacy';

const DOC_URI = FS.documentDirectory ?? '';

export function photoPath(intersectionId: string, assetId: string, fileIndex: number): string {
  const nnn = String(fileIndex).padStart(3, '0');
  return `${DOC_URI}photos/${intersectionId}/${assetId}/${nnn}.jpg`;
}

export function photoDir(intersectionId: string, assetId: string): string {
  return `${DOC_URI}photos/${intersectionId}/${assetId}`;
}

export function exportDir(intersectionId: string): string {
  return `${DOC_URI}export/${intersectionId}`;
}

async function ensureDir(path: string): Promise<void> {
  try {
    await FS.makeDirectoryAsync(path, { intermediates: true });
  } catch (e: unknown) {
    const msg = String(e instanceof Error ? e.message : e);
    if (!/already exists|EEXIST/i.test(msg)) throw e;
  }
}

/**
 * Copies a photo from a temporary URI (e.g. takePictureAsync output) into
 * the final photo path. Returns the final absolute path.
 */
export async function savePhoto(
  tempUri: string,
  intersectionId: string,
  assetId: string,
  fileIndex: number,
): Promise<string> {
  await ensureDir(photoDir(intersectionId, assetId));
  const dest = photoPath(intersectionId, assetId, fileIndex);
  await FS.copyAsync({ from: tempUri, to: dest });
  return dest;
}

export async function deletePhoto(
  intersectionId: string,
  assetId: string,
  fileIndex: number,
): Promise<boolean> {
  const path = photoPath(intersectionId, assetId, fileIndex);
  try {
    await FS.deleteAsync(path, { idempotent: true });
    return true;
  } catch {
    return false;
  }
}

/** Next file index for an asset: max(existing) + 1, or 1. */
export async function nextFileIndex(
  intersectionId: string,
  assetId: string,
): Promise<number> {
  const dir = photoDir(intersectionId, assetId);
  try {
    const info = await FS.getInfoAsync(dir);
    if (!info.exists) return 1;
    const entries = await FS.readDirectoryAsync(dir);
    const indices = entries
      .filter((f) => /^\d{3}\.jpg$/.test(f))
      .map((f) => parseInt(f.slice(0, 3), 10));
    return indices.length === 0 ? 1 : Math.max(...indices) + 1;
  } catch {
    return 1;
  }
}

export async function ensureExportDir(intersectionId: string): Promise<string> {
  const dir = exportDir(intersectionId);
  await ensureDir(dir);
  return dir;
}

/** Mirror photos/<i>/<a>/<NNN>.jpg into export/<i>/<a>/<NNN>.jpg. */
export async function mirrorPhotosForExport(
  intersectionId: string,
  assetIds: readonly string[],
): Promise<string[]> {
  const out: string[] = [];
  for (const assetId of assetIds) {
    const srcDir = photoDir(intersectionId, assetId);
    try {
      const info = await FS.getInfoAsync(srcDir);
      if (!info.exists) continue;
    } catch {
      continue;
    }
    const destDir = `${exportDir(intersectionId)}/${assetId}`;
    await ensureDir(destDir);
    const entries = await FS.readDirectoryAsync(srcDir);
    for (const f of entries) {
      if (!/^\d{3}\.jpg$/.test(f)) continue;
      const from = `${srcDir}/${f}`;
      const to = `${destDir}/${f}`;
      await FS.copyAsync({ from, to });
      out.push(to);
    }
  }
  return out;
}

export function exportDirUri(intersectionId: string): string {
  return exportDir(intersectionId);
}