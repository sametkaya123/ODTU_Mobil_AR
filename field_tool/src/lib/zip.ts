// Fast zip via JSZip (pure JS — works in Expo Go).
// Optimizations:
//   - Bounded-concurrency file reads (no OOM from loading 30-40+ photos as
//     base64 all at once — each batch's strings are freed before the next)
//   - STORE compression for JPEGs (already compressed — DEFLATE wastes CPU)
//   - Streamed output write via the native FileHandle/WritableStream API
//     (avoids building one giant base64 string for the whole zip in memory
//     and avoids the old bridge's argument-size limit on writeAsStringAsync)

import JSZip from 'jszip';
import * as FS from 'expo-file-system/legacy';
import { File } from 'expo-file-system';

// How many files to read into memory at once. Caps peak memory regardless
// of how many photos are being exported.
const READ_BATCH_SIZE = 6;

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

/** Writes the zip to disk as a byte stream — never holds the whole zip in one buffer. */
async function writeZipToFile(zip: JSZip, destinationZip: string): Promise<void> {
  const writer = new File(destinationZip).writableStream().getWriter();
  await new Promise<void>((resolve, reject) => {
    const stream = zip.generateInternalStream({ type: 'uint8array', compression: 'STORE' });
    stream
      .on('data', (chunk: Uint8Array) => {
        stream.pause();
        writer.write(chunk).then(() => stream.resume(), reject);
      })
      .on('error', reject)
      .on('end', () => resolve())
      .resume();
  });
  await writer.close();
}

export async function zipFolder(sourceFolder: string, destinationZip: string): Promise<string> {
  const files = await listFilesRecursive(sourceFolder);

  const zip = new JSZip();
  // Read in small batches instead of Promise.all-ing every photo's base64 at
  // once — with 30-40+ photos that blew the JS heap (each entry is ~33%
  // bigger than the JPEG itself, all held simultaneously).
  for (let i = 0; i < files.length; i += READ_BATCH_SIZE) {
    const batch = files.slice(i, i + READ_BATCH_SIZE);
    const entries = await Promise.all(
      batch.map(async (full) => {
        const rel = relPath(sourceFolder, full);
        const base64 = await FS.readAsStringAsync(full, { encoding: FS.EncodingType.Base64 });
        return { rel, base64, jpeg: isJpegPath(rel) };
      }),
    );
    for (const c of entries) {
      // STORE: no recompression. JPEGs are already compressed; manifest.json is tiny.
      zip.file(c.rel, c.base64, { base64: true, compression: 'STORE' });
    }
  }

  try {
    await FS.deleteAsync(destinationZip, { idempotent: true });
  } catch {
    /* ok */
  }
  await writeZipToFile(zip, destinationZip);
  return destinationZip;
}
