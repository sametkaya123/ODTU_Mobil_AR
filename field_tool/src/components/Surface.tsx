// Card / section surface used across screens. Two elevations:
//   - <Card> white-on-surface with soft shadow (cards, kavşak list rows).
//   - <SectionCard> surface-container-low (grouped, lower elevation — used inside sections).

import { Pressable, StyleSheet, View, type ViewProps } from 'react-native';
import { useTheme } from '@/lib/theme';

export interface CardProps extends ViewProps {
  onPress?: () => void;
  padded?: boolean;
}

export function Card({ onPress, padded = true, style, children, ...rest }: CardProps) {
  const t = useTheme();
  const styles = makeStyles(t);
  const composed = [styles.card, padded && styles.padded, style];
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [composed, pressed && { opacity: 0.85, transform: [{ scale: 0.99 }] }]}
        {...rest}
      >
        {children}
      </Pressable>
    );
  }
  return (
    <View style={composed} {...rest}>
      {children}
    </View>
  );
}

export interface SectionCardProps extends ViewProps {
  padded?: boolean;
}

export function SectionCard({ padded = true, style, children, ...rest }: SectionCardProps) {
  const t = useTheme();
  const styles = makeStyles(t);
  return (
    <View style={[styles.section, padded && styles.padded, style]} {...rest}>
      {children}
    </View>
  );
}

function makeStyles(t: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    card: {
      backgroundColor: t.cardLowest,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: t.border,
      shadowColor: '#000',
      shadowOpacity: 0.04,
      shadowOffset: { width: 0, height: 1 },
      shadowRadius: 4,
      elevation: 1,
    },
    section: {
      backgroundColor: t.chipBg,
      borderRadius: 12,
    },
    padded: { padding: 16 },
  });
}
