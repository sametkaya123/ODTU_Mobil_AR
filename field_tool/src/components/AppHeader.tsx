// Stitch-style top app header.
//   - Logo + "Saha Referans" wordmark
//   - subtitle = current screen title
//   - safe-area top padding built-in
//
// The logo is an inline SVG (teal rounded square + viewfinder + semantic dots)
// so it renders without bundling any binary asset. Matching the brand SVG in
// document/stitch_saha_referans_toplama_app_ui/saha_referans_toplama_logosu/code.html.

import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Path, Polygon, Rect, Text as SvgText } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useTheme, useThemeMode, type ThemeMode } from '@/lib/theme';
import { IconSymbol } from '@/components/StatTile';

export interface AppHeaderProps {
  subtitle: string;
  right?: React.ReactNode;
}

const THEME_CYCLE: ThemeMode[] = ['light', 'dark', 'saha'];
const THEME_ICON: Record<ThemeMode, string> = {
  light: 'light_mode',
  dark: 'dark_mode',
  saha: 'wb_sunny',
};
const THEME_LABEL: Record<ThemeMode, string> = {
  light: 'Açık',
  dark: 'Koyu',
  saha: 'Saha',
};

export function AppHeader({ subtitle, right }: AppHeaderProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(t, insets.top);
  const { mode, setMode } = useThemeMode();

  const cycleTheme = () => {
    Haptics.selectionAsync().catch(() => {});
    const idx = THEME_CYCLE.indexOf(mode);
    setMode(THEME_CYCLE[(idx + 1) % THEME_CYCLE.length]);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <View style={styles.left}>
          <Logo color={t.primaryContainer} dotColors={[t.signal, t.cabinet, t.busStop]} />
          <View style={styles.titleCol}>
            <Text style={styles.brand} numberOfLines={1}>Saha Referans</Text>
            <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>
          </View>
        </View>
        <View style={styles.right}>
          <Pressable
            style={({ pressed }) => [styles.themeBtn, pressed && styles.themeBtnPressed]}
            onPress={cycleTheme}
            hitSlop={6}
            accessibilityLabel={`Tema: ${THEME_LABEL[mode]}. Geçmek için tıkla.`}
          >
            <IconSymbol name={THEME_ICON[mode]} size={20} color={t.headerText} />
          </Pressable>
          {right}
        </View>
      </View>
    </View>
  );
}

function Logo({
  color,
  dotColors,
  size = 32,
}: {
  color: string;
  dotColors: [string, string, string];
  size?: number;
}) {
  // Brand mark: teal pin (camera-aperture inside) + traffic light dots + pole + bus stop.
  // Colors: outer (pin bg) = `color`, traffic dots = dotColors, pole = muted teal, busStop = dotColors[2].
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.22, overflow: 'hidden' }}>
      <Svg width={size} height={size} viewBox="0 0 200 200">
        {/* Pin teardrop body (filled with brand color) */}
        <Path
          d="M70,42 C49,42 33,58 33,79 C33,104 70,148 70,148 C70,148 107,104 107,79 C107,58 91,42 70,42 Z"
          fill={color}
        />
        {/* Aperture plate (white) */}
        <Circle cx={70} cy={79} r={26} fill="#FFFFFF" />
        {/* 6 blade triangles (subtle) */}
        <G fill={color} opacity={0.18}>
          <G transform="rotate(0 70 79)"><Polygon points="70,79 94,72 46,72" /></G>
          <G transform="rotate(60 70 79)"><Polygon points="70,79 94,72 46,72" /></G>
          <G transform="rotate(120 70 79)"><Polygon points="70,79 94,72 46,72" /></G>
          <G transform="rotate(180 70 79)"><Polygon points="70,79 94,72 46,72" /></G>
          <G transform="rotate(240 70 79)"><Polygon points="70,79 94,72 46,72" /></G>
          <G transform="rotate(300 70 79)"><Polygon points="70,79 94,72 46,72" /></G>
        </G>
        {/* Aperture inner ring + pupil */}
        <Circle cx={70} cy={79} r={11} fill="none" stroke={color} strokeWidth={3} />
        <Circle cx={70} cy={79} r={3.5} fill={color} />
        {/* Traffic light body */}
        <Rect x={118} y={42} width={22} height={62} rx={6} fill={color} opacity={0.25} />
        <Circle cx={129} cy={55} r={6} fill={dotColors[0]} />
        <Circle cx={129} cy={73} r={6} fill={dotColors[1]} />
        <Circle cx={129} cy={91} r={6} fill={dotColors[2]} />
        {/* Cabinet pole with 2 horizontal arms */}
        <G fill={color} opacity={0.55}>
          <Rect x={160} y={78} width={6} height={100} />
          <Rect x={140} y={100} width={32} height={4} />
          <Rect x={140} y={138} width={32} height={4} />
        </G>
        {/* Bus-stop small square */}
        <Rect x={55} y={156} width={30} height={30} rx={4} fill={dotColors[2]} />
        <SvgText
          x={70}
          y={178}
          textAnchor="middle"
          fontSize={20}
          fontWeight="700"
          fill="#FFFFFF"
        >
          B
        </SvgText>
      </Svg>
    </View>
  );
}

function makeStyles(t: ReturnType<typeof useTheme>, safeTop: number) {
  return StyleSheet.create({
    wrap: {
      paddingTop: safeTop + 8,
      paddingBottom: 8,
      paddingHorizontal: 16,
      backgroundColor: t.headerBg,
      borderBottomWidth: 1,
      borderBottomColor: t.headerBorder,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: 48,
    },
    left: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flex: 1,
      minWidth: 0,
    },
    titleCol: { flexShrink: 1, minWidth: 0 },
    brand: {
      fontSize: t.type.headlineSm,
      fontWeight: '700',
      color: t.headerText,
      letterSpacing: -0.5,
    },
    subtitle: {
      fontSize: 12,
      fontWeight: '600',
      color: t.textMuted,
      marginTop: 1,
      letterSpacing: 0.2,
    },
    right: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    themeBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    themeBtnPressed: {
      opacity: 0.6,
      transform: [{ scale: 0.95 }],
    },
  });
}
