// Theme tokens. 3 fixed modes (Açık / Koyu / Saha), no system follow.
// Saha Modu = high-contrast outdoor sunlight palette.
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
  text: string;
  textMuted: string;
  textInverse: string;
  primary: string;
  primaryAlt: string;
  border: string;
  borderStrong: string;
  warn: string;
  ok: string;
  danger: string;
  missingBg: string;
  headerBg: string;
  headerText: string;
  headerBorder: string;
  previewBg: string;
  shadow: string;
  progressBg: string;
  chipBg: string;
  overlay: string;
}

export interface ThemeTypography {
  hero: number;
  title: number;
  body: number;
  caption: number;
  btn: number;
  icon: number;
}

export const TYPOGRAPHY: ThemeTypography = {
  hero: 32,
  title: 20,
  body: 16,
  caption: 14,
  btn: 17,
  icon: 22,
};

// Açık — iOS-style soft surfaces.
const light: ThemeColors = {
  bg: '#f2f2f7',
  card: '#ffffff',
  cardElevated: '#ffffff',
  text: '#1c1c1e',
  textMuted: '#6e6e73',
  textInverse: '#ffffff',
  primary: '#007aff',
  primaryAlt: '#5ac8fa',
  border: '#e5e5ea',
  borderStrong: '#d1d1d6',
  warn: '#ff9500',
  ok: '#34c759',
  danger: '#ff3b30',
  missingBg: '#e5e5ea',
  headerBg: '#ffffff',
  headerText: '#1c1c1e',
  headerBorder: '#e5e5ea',
  previewBg: '#000000',
  shadow: 'rgba(0,0,0,0.08)',
  progressBg: '#e5e5ea',
  chipBg: '#ffffff',
  overlay: 'rgba(0,0,0,0.55)',
};

// Koyu — Apple elevated dark gray.
const dark: ThemeColors = {
  bg: '#000000',
  card: '#1c1c1e',
  cardElevated: '#2c2c2e',
  text: '#f5f5f7',
  textMuted: '#98989d',
  textInverse: '#ffffff',
  primary: '#0a84ff',
  primaryAlt: '#64d2ff',
  border: '#38383a',
  borderStrong: '#48484a',
  warn: '#ff9f0a',
  ok: '#30d158',
  danger: '#ff453a',
  missingBg: '#2c2c2e',
  headerBg: '#1c1c1e',
  headerText: '#f5f5f7',
  headerBorder: '#38383a',
  previewBg: '#000000',
  shadow: 'rgba(0,0,0,0.5)',
  progressBg: '#2c2c2e',
  chipBg: '#1c1c1e',
  overlay: 'rgba(0,0,0,0.55)',
};

// Saha — high contrast, saturated, pure-black surfaces for direct sunlight.
const saha: ThemeColors = {
  bg: '#121212',
  card: '#1E1E1E',
  cardElevated: '#252525',
  text: '#F5F5F5',
  textMuted: '#BDBDBD',
  textInverse: '#FFFFFF',
  primary: '#FF6D00',
  primaryAlt: '#E65100',
  border: '#2A2A2A',
  borderStrong: '#FFFFFF',
  warn: '#FFD600',
  ok: '#00C853',
  danger: '#FF1744',
  missingBg: '#2A2A2A',
  headerBg: '#000000',
  headerText: '#FFFFFF',
  headerBorder: '#2A2A2A',
  previewBg: '#000000',
  shadow: '#000000',
  progressBg: '#2A2A2A',
  chipBg: '#2A2A2A',
  overlay: 'rgba(0,0,0,0.7)',
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
      // Brightness side effect on actual mode transition.
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
  return { ...ctx.colors, type: TYPOGRAPHY };
}

export function useThemeMode(): Omit<ThemeContextValue, 'colors'> {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemeMode outside ThemeProvider');
  return { mode: ctx.mode, setMode: ctx.setMode, toggle: ctx.toggle, effective: ctx.effective };
}
