// Selectable chip — used by Ayarlar chips, Asset type chips, Capture tag rows.
// Filled primaryContainer when active, surface-container-low when not.

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/lib/theme';

export interface ChipProps {
  active?: boolean;
  onPress: () => void;
  children: React.ReactNode;
  leading?: string; // emoji or short prefix
  size?: 'sm' | 'md';
  variant?: 'filter' | 'type';
}

export function Chip({ active, onPress, children, leading, size = 'md', variant = 'filter' }: ChipProps) {
  const t = useTheme();
  const styles = makeStyles(t);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        size === 'sm' ? styles.sm : styles.md,
        variant === 'type' && styles.typeStyle,
        active ? styles.active : styles.inactive,
        pressed && { opacity: 0.85 },
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
    >
      {leading ? <Text style={[styles.leading, active && styles.leadingActive]}>{leading}</Text> : null}
      <Text style={[styles.label, size === 'sm' && { fontSize: 13 }, active && styles.labelActive]}>
        {children}
      </Text>
    </Pressable>
  );
}

export function ChipRow({ children, gap = 6 }: { children: React.ReactNode; gap?: number }) {
  return <View style={[styles2.row, { gap }]}>{children}</View>;
}

function makeStyles(t: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    base: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 12,
      borderWidth: 1,
      minHeight: 44,
      paddingHorizontal: 14,
    },
    sm: { minHeight: 40, paddingHorizontal: 12, borderRadius: 10 },
    md: {},
    typeStyle: {},
    active: {
      backgroundColor: t.primaryContainer,
      borderColor: t.primaryContainer,
    },
    inactive: {
      backgroundColor: t.cardHigh,
      borderColor: 'transparent',
    },
    label: {
      fontSize: 14,
      fontWeight: '600',
      color: t.text,
    },
    labelActive: {
      color: t.textInverse,
    },
    leading: { fontSize: 16, color: t.text, marginRight: 6 },
    leadingActive: { color: t.textInverse },
  });
}

const styles2 = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
});
