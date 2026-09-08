import { useEffect, useState } from 'react';
import {
  AppState,
  type AppStateStatus,
  View,
} from 'react-native';
import * as Font from 'expo-font';
import { Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme, useThemeMode } from '@/lib/theme';
import { AlertProvider } from '@/components/Alert';
import { AppHeader } from '@/components/AppHeader';
import { BottomTabNav, type TabKey } from '@/components/BottomTabNav';
import { lockMaxBrightness, restoreBrightness } from '@/lib/brightness';

// Material Symbols Outlined bundled locally — works offline. Falls back to
// system font if metro can't resolve the asset (still renders a glyph).
function subtitleFor(pathname: string | null | undefined): string {
  if (!pathname) return 'Saha Aracı';
  if (pathname.startsWith('/ayarlar')) return 'Ayarlar';
  if (pathname.startsWith('/harita')) return 'Harita';
  if (pathname.startsWith('/disa_aktar')) return 'Dışa Aktar';
  if (pathname.startsWith('/onboarding')) return 'Hoş Geldin';
  if (pathname.startsWith('/asset-yeni')) return 'Yeni Asset';
  if (pathname.startsWith('/kavsak-yeni')) return 'Yeni Kavşak';
  if (pathname.startsWith('/model-test')) return 'Model Testi';
  if (pathname.startsWith('/cekim')) return 'Çekim';
  if (pathname.startsWith('/kavsak')) return 'Kavşak';
  if (pathname.startsWith('/asset')) return 'Asset';
  return 'Saha Aracı';
}

function activeFor(pathname: string | null | undefined): TabKey {
  if (!pathname) return 'kavsak';
  if (pathname.startsWith('/ayarlar')) return 'ayarlar';
  if (pathname.startsWith('/harita')) return 'harita';
  if (pathname.startsWith('/disa_aktar')) return 'disa_aktar';
  if (pathname.startsWith('/kavsak')) return 'kavsak';
  return 'kavsak';
}

function StackShell() {
  const { mode } = useThemeMode();
  const t = useTheme();
  const pathname = usePathname();

  // Re-apply brightness when app returns to foreground.
  // System can revert override on background; lock again if still saha.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next !== 'active') return;
      if (mode === 'saha') {
        lockMaxBrightness();
      } else {
        restoreBrightness();
      }
    });
    return () => sub.remove();
  }, [mode]);

  const statusBarStyle: 'light' | 'dark' = mode === 'light' ? 'dark' : 'light';

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <StatusBar style={statusBarStyle} />
      <AppHeader subtitle={subtitleFor(pathname)} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: t.bg },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="kavsak" />
        <Stack.Screen name="asset" />
        <Stack.Screen name="cekim" />
        <Stack.Screen name="model-test" />
        <Stack.Screen name="disa_aktar" />
        <Stack.Screen name="ayarlar" />
        <Stack.Screen name="harita" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="kavsak-yeni" />
        <Stack.Screen name="asset-yeni" />
      </Stack>
      <BottomTabNav active={activeFor(pathname)} />
    </View>
  );
}

export default function RootLayout() {
  const [fontReady, setFontReady] = useState(false);

  useEffect(() => {
    // Hold the first frame until the bundled icon font is mounted. Local
    // require avoids the previous CDN load that failed in the field.
    Font.loadAsync({
      MaterialSymbolsOutlined: require('../assets/fonts/MaterialSymbolsOutlined.ttf'),
    })
      .catch(() => {})
      .finally(() => setFontReady(true));
  }, []);

  if (!fontReady) {
    // Empty frame keeps the splash up until the font attempt settles.
    return <SafeAreaProvider />;
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AlertProvider>
          <StackShell />
        </AlertProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
