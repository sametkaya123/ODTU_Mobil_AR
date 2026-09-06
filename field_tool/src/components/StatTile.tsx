// Small inline icon using Material Symbols Outlined (text font).
// Family must be loaded by the app shell (handled in app.json via expo-font hook).

import { Text, type TextProps } from 'react-native';

export interface IconSymbolProps extends TextProps {
  name: string;
  size?: number;
  color?: string;
}

export function IconSymbol({ name, size = 22, color, style, ...rest }: IconSymbolProps) {
  return (
    <Text
      {...rest}
      style={[
        { fontFamily: 'MaterialSymbolsOutlined', fontSize: size, color, lineHeight: size + 2 },
        style,
      ]}
    >
      {name}
    </Text>
  );
}
