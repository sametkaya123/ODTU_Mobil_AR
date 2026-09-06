// Linear progress bar with a label row.
// Used by Capture screen (X/480 combos), Export (step progress), Kavşak cards (asset completion).

import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/lib/theme';

export interface ProgressBarProps {
  value: number; // 0..100
  label?: string;
  caption?: string;
  tone?: 'primary' | 'success' | 'warning' | 'danger';
  height?: number;
}

export function ProgressBar({
  value,
  label,
  caption,
  tone = 'primary',
  height = 8,
}: ProgressBarProps) {
  const t = useTheme();
  const styles = makeStyles(t);
  const pct = Math.max(0, Math.min(100, value));
  const fillColor =
    tone === 'success'
      ? t.ok
      : tone === 'warning'
        ? t.warn
        : tone === 'danger'
          ? t.danger
          : t.primary;
  return (
    <View style={styles.wrap}>
      {(label || caption) && (
        <View style={styles.headerRow}>
          {label ? <Text style={styles.label}>{label}</Text> : <View />}
          {caption ? <Text style={styles.caption}>{caption}</Text> : null}
        </View>
      )}
      <View style={[styles.track, { height, borderRadius: height / 2 }]}>
        <View
          style={[
            styles.fill,
            {
              width: `${pct}%`,
              backgroundColor: fillColor,
              borderRadius: height / 2,
            },
          ]}
        />
      </View>
    </View>
  );
}

function makeStyles(t: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    wrap: { width: '100%' },
    headerRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      marginBottom: 6,
    },
    label: {
      fontSize: 13,
      fontWeight: '600',
      color: t.text,
    },
    caption: {
      fontSize: 13,
      fontWeight: '600',
      color: t.textMuted,
    },
    track: {
      width: '100%',
      backgroundColor: t.progressBg,
      overflow: 'hidden',
    },
    fill: { height: '100%' },
  });
}
