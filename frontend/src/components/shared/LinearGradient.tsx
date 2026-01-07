import { View, StyleSheet, ViewStyle, Platform } from 'react-native';

interface LinearGradientProps {
  colors: string[];
  start?: { x: number; y: number };
  end?: { x: number; y: number };
  style?: ViewStyle;
  children?: React.ReactNode;
}

export default function LinearGradient({ colors, start, end, style, children }: LinearGradientProps) {
  const direction = start && end 
    ? `${Math.round((end.x - start.x) * 180)}deg`
    : '180deg';
  
  const gradientColors = colors.join(', ');
  
  if (Platform.OS === 'web') {
    return (
      <View
        style={[
          style,
          {
            background: `linear-gradient(${direction}, ${gradientColors})`,
          } as any,
        ]}
      >
        {children}
      </View>
    );
  }

  return (
    <View
      style={[
        style,
        {
          backgroundColor: colors[0],
        },
      ]}
    >
      {children}
    </View>
  );
}
