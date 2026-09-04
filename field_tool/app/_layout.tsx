import { useEffect } from 'react';
import { AppState, type AppStateStatus, Pressable, StyleSheet, Text } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme, useThemeMode } from '@/lib/theme';
import { AlertProvider } from '@/components/Alert';
import { lockMaxBrightness, restoreBrightness } from '@/lib/brightness';
import type { ThemeMode } from '@/lib/theme';

// Cycle hint: light→dark→saha→light. Icon previews the NEXT mode's mood.
function cycleIcon(mode: ThemeMode): string {
  if (mode === 'light') return '☾'; // go dark next
  if (mode === 'dark') return '☀︎'; // go saha (sun) next
  return '☾'; // saha → light
}

function ThemeToggle() {
  const { mode, toggle } = useThemeMode();
  const t = useTheme();
  const styles = toggleStyles(t);
  return (
    <Pressable
      onPress={toggle}
      hitSlop={12}
      style={({ pressed }) => [styles.toggle, pressed && { opacity: 0.5 }]}
    >
      <Text style={styles.toggleIcon}>{cycleIcon(mode)}</Text>
    </Pressable>
  );
}

function StackShell() {
  const { mode } = useThemeMode();
  const t = useTheme();

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
    <>
      <StatusBar style={statusBarStyle} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: t.headerBg },
          headerTintColor: t.headerText,
          headerTitleStyle: { fontWeight: '700', fontSize: t.type.title },
          headerRight: () => <ThemeToggle />,
          contentStyle: { backgroundColor: t.bg },
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Saha Aracı' }} />
        <Stack.Screen name="kavsak" options={{ title: 'Kavşak Seç' }} />
        <Stack.Screen name="asset" options={{ title: 'Asset Seç' }} />
        <Stack.Screen name="cekim" options={{ title: 'Çekim' }} />
        <Stack.Screen name="disa_aktar" options={{ title: 'Dışa Aktar' }} />
        <Stack.Screen name="ayarlar" options={{ title: 'Ayarlar' }} />
        <Stack.Screen name="harita" options={{ title: '🗺️ Harita' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
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

function toggleStyles(t: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    toggle: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
    },
    toggleIcon: { fontSize: t.type.icon, color: t.primary },
  });
}
