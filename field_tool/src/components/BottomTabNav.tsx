// Stitch-style bottom navigation. 4 tabs, 72px bar + safe-area inset.
// Active tab uses primary color + bolder weight; inactive uses on-surface-variant.

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname, useRouter } from 'expo-router';
import { useTheme } from '@/lib/theme';
import { IconSymbol } from '@/components/StatTile';

export type TabKey = 'ayarlar' | 'kavsak' | 'harita' | 'disa_aktar';

interface TabDef {
  key: TabKey;
  label: string;
  icon: string;
  path: string;
}

const TABS: TabDef[] = [
  { key: 'ayarlar', label: 'Ayarlar', icon: 'settings', path: '/ayarlar' },
  { key: 'kavsak', label: 'Kavşak', icon: 'route', path: '/kavsak' },
  { key: 'harita', label: 'Harita', icon: 'map', path: '/harita' },
  { key: 'disa_aktar', label: 'Dışa Aktar', icon: 'upload_file', path: '/disa_aktar' },
];

export interface BottomTabNavProps {
  active?: TabKey;
  onChange?: (key: TabKey) => void;
}

export function BottomTabNav({ active, onChange }: BottomTabNavProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const styles = makeStyles(t, insets.bottom);

  const resolved = active ?? inferActive(pathname);

  return (
    <View style={styles.bar}>
      <View style={styles.grid}>
        {TABS.map((tab) => {
          const isActive = tab.key === resolved;
          const iconColor = isActive ? t.primary : t.textMuted;
          const labelColor = isActive ? t.primary : t.text;
          return (
            <Pressable
              key={tab.key}
              accessibilityRole="button"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected: isActive }}
              onPress={() => {
                onChange?.(tab.key);
                router.push(tab.path as never);
              }}
              style={({ pressed }) => [styles.tab, pressed && { opacity: 0.6 }]}
            >
              <View style={[styles.iconWrap, isActive && styles.iconWrapActive]}>
                <IconSymbol name={tab.icon} size={24} color={iconColor} />
              </View>
              <Text
                style={[
                  styles.tabLabel,
                  { color: labelColor },
                  isActive && { fontWeight: '800' },
                ]}
                numberOfLines={1}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function inferActive(pathname?: string | null): TabKey {
  if (!pathname) return 'kavsak';
  if (pathname.startsWith('/ayarlar')) return 'ayarlar';
  if (pathname.startsWith('/harita')) return 'harita';
  if (pathname.startsWith('/disa_aktar')) return 'disa_aktar';
  return 'kavsak';
}

function makeStyles(t: ReturnType<typeof useTheme>, safeBottom: number) {
  return StyleSheet.create({
    bar: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: t.headerBg,
      borderTopWidth: 1,
      borderTopColor: t.headerBorder,
      paddingBottom: safeBottom,
    },
    grid: {
      flexDirection: 'row',
      alignItems: 'center',
      height: 72,
      paddingHorizontal: 6,
    },
    tab: {
      flex: 1,
      minHeight: 48,
      minWidth: 48,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
    },
    iconWrap: {
      width: 48,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconWrapActive: {
      backgroundColor: t.chipBg,
    },
    tabLabel: {
      fontSize: 11,
      fontWeight: '600',
      letterSpacing: 0.4,
    },
  });
}
