// Slug maps: UI shows Turkish labels, manifest stores ASCII slugs.

import type { AngleSlug, LightSlug, PostureSlug } from '@/types/domain';

export const ANGLE_LABELS: Record<AngleSlug, string> = {
  on: 'Ön',
  sag_capraz: 'Sağ Çapraz',
  sol_capraz: 'Sol Çapraz',
  karsi_kaldirim: 'Karşı Kaldırım',
  yaklasma: 'Yaklaşma',
  uzaklasma: 'Uzaklaşma',
};

export const ANGLE_SLUGS: readonly AngleSlug[] = [
  'on',
  'sag_capraz',
  'sol_capraz',
  'karsi_kaldirim',
  'yaklasma',
  'uzaklasma',
] as const;

export const LIGHT_LABELS: Record<LightSlug, string> = {
  gunesli: 'Güneşli',
  bulutlu: 'Bulutlu',
  golge: 'Gölge',
  gece: 'Gece',
};

export const LIGHT_SLUGS: readonly LightSlug[] = ['gunesli', 'bulutlu', 'golge', 'gece'] as const;

export const POSTURE_LABELS: Record<PostureSlug, string> = {
  ayakta: 'Ayakta',
  oturarak: 'Oturarak',
  yukari_egik: 'Yukarı Eğik',
  asagi_egik: 'Aşağı Eğik',
};

export const POSTURE_SLUGS: readonly PostureSlug[] = [
  'ayakta',
  'oturarak',
  'yukari_egik',
  'asagi_egik',
] as const;

// Reverse maps for any consumer that needs label from slug.
export const SLUG_TO_ANGLE: Record<string, string> = Object.fromEntries(
  Object.entries(ANGLE_LABELS).map(([slug, label]) => [slug, label]),
);
export const SLUG_TO_LIGHT: Record<string, string> = Object.fromEntries(
  Object.entries(LIGHT_LABELS).map(([slug, label]) => [slug, label]),
);
export const SLUG_TO_POSTURE: Record<string, string> = Object.fromEntries(
  Object.entries(POSTURE_LABELS).map(([slug, label]) => [slug, label]),
);