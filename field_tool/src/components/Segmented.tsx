// Segmented control — used by Ayarlar tema selection (Sistem / Açık / Koyu / Saha).
// Single-select, equal-width buttons inside a single pill-shaped track.

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/lib/theme';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: string;
}

export interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
}

export function Segmented<T extends string>({ options, value, onChange }: SegmentedProps<T>) {
  const t = useTheme();
  const styles = makeStyles(t);
  return (
    <View style={styles.track}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={({ pressed }) => [
              styles.btn,
              active && styles.btnActive,
              pressed && { opacity: 0.85 },
            ]}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
          >
            {opt.icon ? (
              <Text style={[styles.icon, active && { color: t.textInverse }]}>{opt.icon}</Text>
            ) : null}
            <Text style={[styles.label, active && styles.labelActive]}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function makeStyles(t: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    track: {
      flexDirection: 'row',
      padding: 4,
      backgroundColor: t.chipBg,
      borderRadius: 12,
      minHeight: 48,
    },
    btn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      paddingHorizontal: 12,
      minHeight: 40,
      borderRadius: 8,
    },
    btnActive: {
      backgroundColor: t.primaryContainer,
      shadowColor: '#000',
      shadowOpacity: 0.08,
      shadowOffset: { width: 0, height: 1 },
      shadowRadius: 2,
      elevation: 1,
    },
    icon: {
      fontSize: 18,
      fontFamily: 'MaterialSymbolsOutlined',
      color: t.textMuted,
    },
    label: {
      fontSize: 13,
      fontWeight: '600',
      color: t.textMuted,
    },
    labelActive: {
      color: t.textInverse,
      fontWeight: '700',
    },
  });
}
