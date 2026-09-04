// Fast zip via JSZip (pure JS — works in Expo Go).
// Optimizations:
//   - Parallel file reads via Promise.all (no sequential FS roundtrips)
//   - STORE compression for JPEGs (already compressed — DEFLATE wastes CPU)
//   - DEFLATE only for text-ish files (manifest.json, etc.) — small impact

import JSZip from 'jszip';
import * as FS from 'expo-file-system/legacy';

async function listFilesRecursive(root: string): Promise<string[]> {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = await FS.readDirectoryAsync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = `${dir}/${name}`;
      let info;
      try {
        info = await FS.getInfoAsync(full);
      } catch {
        continue;
      }
      if (info.isDirectory) stack.push(full);
      else out.push(full);
    }
  }
  return out;
}

function relPath(root: string, full: string): string {
  let r = root.endsWith('/') ? root.slice(0, -1) : root;
  if (!full.startsWith(r)) return full;
  let p = full.slice(r.length);
  if (p.startsWith('/')) p = p.slice(1);
  return p;
}

function isJpegPath(p: string): boolean {
  const lower = p.toLowerCase();
  return lower.endsWith('.jpg') || lower.endsWith('.jpeg');
}

export async function zipFolder(sourceFolder: string, destinationZip: string): Promise<string> {
  const files = await listFilesRecursive(sourceFolder);

  // Read all files in parallel — no sequential bridge calls.
  const contents = await Promise.all(
    files.map(async (full) => {
      const rel = relPath(sourceFolder, full);
      const base64 = await FS.readAsStringAsync(full, { encoding: FS.EncodingType.Base64 });
      return { rel, base64, jpeg: isJpegPath(rel) };
    }),
  );

  const zip = new JSZip();
  for (const c of contents) {
    // STORE: no recompression. JPEGs are already compressed; manifest.json is tiny.
    zip.file(c.rel, c.base64, { base64: true, compression: 'STORE' });
  }

  // Generate as base64 — STORE keeps it fast.
  const out = await zip.generateAsync({
    type: 'base64',
    compression: 'STORE',
  });

  try {
    await FS.deleteAsync(destinationZip, { idempotent: true });
  } catch {
    /* ok */
  }
  await FS.writeAsStringAsync(destinationZip, out, { encoding: FS.EncodingType.Base64 });
  return destinationZip;
}
