// Theme tokens. 3 fixed modes (Açık / Koyu / Saha). M3-inspired palette
// matching Stitch saha_referans_toplama_app_ui.
//   Light: teal #0F6E6E primary-container on white-blue surface.
//   Dark:  teal #149393 on charcoal #101314.
//   Saha:  high-contrast outdoor sunlight (orange-tinted for daylight legibility).
// Brightness override handled via src/lib/brightness.ts.

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { lockMaxBrightness, restoreBrightness } from '@/lib/brightness';

export type ThemeMode = 'light' | 'dark' | 'saha';

export interface ThemeColors {
  bg: string;
  card: string;
  cardElevated: string;
  cardLowest: string;
  cardHigh: string;
  cardHighest: string;
  text: string;
  textMuted: string;
  textInverse: string;
  primary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  primaryAlt: string;
  border: string;
  borderStrong: string;
  outline: string;
  outlineVariant: string;
  warn: string;
  ok: string;
  danger: string;
  dangerContainer: string;
  onDangerContainer: string;
  missingBg: string;
  headerBg: string;
  headerText: string;
  headerBorder: string;
  previewBg: string;
  shadow: string;
  progressBg: string;
  chipBg: string;
  overlay: string;
  inverseSurface: string;
  inverseOnSurface: string;
  inversePrimary: string;
  // Semantic asset-type accents (used only as dots / badges — never backgrounds).
  signal: string;
  cabinet: string;
  busStop: string;
  // Material symbols fixed variants.
  tertiary: string;
  tertiaryContainer: string;
  onTertiaryContainer: string;
  tertiaryFixed: string;
  tertiaryFixedDim: string;
}

export interface ThemeTypography {
  bodyLg: number;        // 16/24
  labelLg: number;       // 14/18 600
  bodySm: number;        // 13/18
  headlineMd: number;    // 20/28
  labelSm: number;       // 11/14 700
  titleMd: number;       // 16/22
  headlineLg: number;    // 24/32
  dataMonoLg: number;    // 18/22 700
  bodyMd: number;        // 14/20
  labelMd: number;       // 12/16
  dataMonoMd: number;    // 14/18
  headlineSm: number;    // 18/24
  hero: number;
  icon: number;
  btn: number;
  // ponytail: legacy single-word aliases kept so old screens (Alert, index,
  // utility variants) compile without per-call rewrites. Remove when those
  // screens migrate to the M3 key names.
  body: number;
  caption: number;
  title: number;
}

export const TYPOGRAPHY: ThemeTypography = {
  bodyLg: 16,
  labelLg: 14,
  bodySm: 13,
  headlineMd: 20,
  labelSm: 11,
  titleMd: 16,
  headlineLg: 24,
  dataMonoLg: 18,
  bodyMd: 14,
  labelMd: 12,
  dataMonoMd: 14,
  headlineSm: 18,
  hero: 32,
  icon: 22,
  btn: 17,
  body: 14,
  caption: 13,
  title: 16,
};

// Açık — Stitch M3 light teal palette.
const light: ThemeColors = {
  bg: '#f3faff',
  card: '#ffffff',
  cardElevated: '#ffffff',
  cardLowest: '#ffffff',
  cardHigh: '#dfeaf0',
  cardHighest: '#dae4ea',
  text: '#131d21',
  textMuted: '#3e4948',
  textInverse: '#ffffff',
  primary: '#005454',
  primaryContainer: '#0f6e6e',
  onPrimaryContainer: '#9eedec',
  primaryAlt: '#03696a',
  border: '#bec9c8',
  borderStrong: '#6e7979',
  outline: '#6e7979',
  outlineVariant: '#bec9c8',
  warn: '#ff9500',
  ok: '#007330',
  danger: '#ba1a1a',
  dangerContainer: '#ffdad6',
  onDangerContainer: '#93000a',
  missingBg: '#dfeaf0',
  headerBg: 'rgba(243,250,255,0.85)',
  headerText: '#131d21',
  headerBorder: '#dae4ea',
  previewBg: '#101314',
  shadow: 'rgba(0,0,0,0.08)',
  progressBg: '#dae4ea',
  chipBg: '#ebf5fb',
  overlay: 'rgba(40,50,54,0.6)',
  inverseSurface: '#283236',
  inverseOnSurface: '#e8f2f8',
  inversePrimary: '#85d4d3',
  signal: '#D33A2C',
  cabinet: '#2563EB',
  busStop: '#16A34A',
  tertiary: '#005823',
  tertiaryContainer: '#007330',
  onTertiaryContainer: '#7cf995',
  tertiaryFixed: '#7ffc97',
  tertiaryFixedDim: '#62df7d',
};

// Koyu — Stitch M3 dark teal palette.
const dark: ThemeColors = {
  bg: '#101314',
  card: '#15191a',
  cardElevated: '#191E20',
  cardLowest: '#0c0f10',
  cardHigh: '#1f2426',
  cardHighest: '#262D30',
  text: '#E8ECEE',
  textMuted: '#9BA4A8',
  textInverse: '#0E1112',
  primary: '#149393',
  primaryContainer: '#033D3D',
  onPrimaryContainer: '#85d4d3',
  primaryAlt: '#85d4d3',
  border: '#262D30',
  borderStrong: '#2D373B',
  outline: '#2D373B',
  outlineVariant: '#262D30',
  warn: '#FFB74D',
  ok: '#22C55E',
  danger: '#F87171',
  dangerContainer: '#5A1A1A',
  onDangerContainer: '#FECACA',
  missingBg: '#1f2426',
  headerBg: 'rgba(16,19,20,0.9)',
  headerText: '#E8ECEE',
  headerBorder: '#262D30',
  previewBg: '#000000',
  shadow: 'rgba(0,0,0,0.6)',
  progressBg: '#262D30',
  chipBg: '#191E20',
  overlay: 'rgba(0,0,0,0.7)',
  inverseSurface: '#E8ECEE',
  inverseOnSurface: '#101314',
  inversePrimary: '#005454',
  signal: '#EF4444',
  cabinet: '#3B82F6',
  busStop: '#22C55E',
  tertiary: '#7cf995',
  tertiaryContainer: '#005320',
  onTertiaryContainer: '#7cf995',
  tertiaryFixed: '#7ffc97',
  tertiaryFixedDim: '#62df7d',
};

// Saha — high contrast, saturated, pure-black surfaces for direct sunlight.
const saha: ThemeColors = {
  bg: '#121212',
  card: '#1E1E1E',
  cardElevated: '#252525',
  cardLowest: '#000000',
  cardHigh: '#2A2A2A',
  cardHighest: '#3A3A3A',
  text: '#F5F5F5',
  textMuted: '#BDBDBD',
  textInverse: '#FFFFFF',
  primary: '#FF6D00',
  primaryContainer: '#7A3300',
  onPrimaryContainer: '#FFD0B0',
  primaryAlt: '#FFAB40',
  border: '#2A2A2A',
  borderStrong: '#FFFFFF',
  outline: '#FFFFFF',
  outlineVariant: '#3A3A3A',
  warn: '#FFD600',
  ok: '#00C853',
  danger: '#FF1744',
  dangerContainer: '#5A0010',
  onDangerContainer: '#FFC1CC',
  missingBg: '#2A2A2A',
  headerBg: '#000000',
  headerText: '#FFFFFF',
  headerBorder: '#2A2A2A',
  previewBg: '#000000',
  shadow: '#000000',
  progressBg: '#2A2A2A',
  chipBg: '#2A2A2A',
  overlay: 'rgba(0,0,0,0.8)',
  inverseSurface: '#FFFFFF',
  inverseOnSurface: '#000000',
  inversePrimary: '#7A3300',
  signal: '#FF1744',
  cabinet: '#448AFF',
  busStop: '#00E676',
  tertiary: '#00E676',
  tertiaryContainer: '#005320',
  onTertiaryContainer: '#7cf995',
  tertiaryFixed: '#7ffc97',
  tertiaryFixedDim: '#62df7d',
};

const PALETTES: Record<ThemeMode, ThemeColors> = { light, dark, saha };

const CYCLE: ThemeMode[] = ['light', 'dark', 'saha'];

interface ThemeContextValue {
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
  toggle: () => void;
  effective: ThemeMode;
  colors: ThemeColors;
}

const STORAGE_KEY = 'ft/themeMode';

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>('dark');

  // Hydrate persisted mode on mount.
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => {
        if (v === 'light' || v === 'dark' || v === 'saha') setModeState(v);
      })
      .catch(() => {});
  }, []);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState((prev) => {
      if (prev !== 'saha' && m === 'saha') {
        lockMaxBrightness();
      } else if (prev === 'saha' && m !== 'saha') {
        restoreBrightness();
      }
      return m;
    });
    AsyncStorage.setItem(STORAGE_KEY, m).catch(() => {});
  }, []);

  const toggle = useCallback(() => {
    setModeState((prev) => {
      const idx = CYCLE.indexOf(prev);
      const next = CYCLE[(idx + 1) % CYCLE.length];
      if (prev !== 'saha' && next === 'saha') {
        lockMaxBrightness();
      } else if (prev === 'saha' && next !== 'saha') {
        restoreBrightness();
      }
      AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
      return next;
    });
  }, []);

  const colors = PALETTES[mode];

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, setMode, toggle, effective: mode, colors }),
    [mode, setMode, toggle, colors],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeColors & { type: ThemeTypography } {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme outside ThemeProvider');
  return { ...ctx.colors, type: TYPOGRAPHY } as ThemeColors & { type: ThemeTypography };
}

export function useThemeMode(): Omit<ThemeContextValue, 'colors'> {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemeMode outside ThemeProvider');
  return { mode: ctx.mode, setMode: ctx.setMode, toggle: ctx.toggle, effective: ctx.effective };
}

// Convenience spacing/radius scales (mirror Stitch).
export const SPACING = {
  '4xs': 2,
  '3xs': 4,
  '2xs': 6,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  '2xl': 32,
  safeTop: 54,
  safeBottom: 34,
} as const;

export const RADIUS = {
  lg: 8,
  xl: 12,
  full: 9999,
} as const;
