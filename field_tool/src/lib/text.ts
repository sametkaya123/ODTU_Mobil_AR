// String helpers. Pure, framework-free — testable in Node.
//
// slugify: TR transliteration + ASCII-safe normalization.
// slugifyAssetId: convenience wrapper for asset_id-like fields
// (uppercase, collapse runs of non-alphanumerics).

export type SlugifyOpts = {
  /** Default true. Collapse [^A-Za-z0-9]+ to single '-', trim leading/trailing '-'. */
  collapse?: boolean;
  /** Default 'keep'. 'upper' lowercases everything; 'lower' uppercases. */
  case?: 'lower' | 'upper' | 'keep';
  /** Optional cap on result length. Default: no cap. */
  maxLen?: number;
};

const TR_MAP: Record<string, string> = {
  'ç': 'c', 'Ç': 'C', 'ğ': 'g', 'Ğ': 'G',
  'ı': 'i', 'İ': 'I', 'ö': 'o', 'Ö': 'O',
  'ş': 's', 'Ş': 'S', 'ü': 'u', 'Ü': 'U',
};

export function slugify(input: string, opts?: SlugifyOpts): string {
  const collapse = opts?.collapse ?? true;
  const caseMode = opts?.case ?? 'keep';
  const maxLen = opts?.maxLen;

  let s = input.replace(/[çÇğĞıİöÖşŞüÜ]/g, (c) => TR_MAP[c] ?? c);

  if (collapse) {
    s = s
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  } else {
    // Only strip chars that would break filenames / IDs; preserve original spacing.
    // TR chars already handled above. Drop a few extras that aren't valid in
    // most filesystem/ID contexts: keep ASCII printable + alphanumerics.
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

/** Asset_id-style: uppercase + collapse runs. Empty input → ''. */
export function slugifyAssetId(input: string): string {
  return slugify(input, { collapse: true, case: 'upper' });
}
