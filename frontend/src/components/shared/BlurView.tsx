import { View, StyleSheet, ViewStyle } from 'react-native';
import { colors } from '../../theme';

interface BlurViewProps {
  intensity?: number;
  style?: ViewStyle;
  children?: React.ReactNode;
}

export default function BlurView({ intensity = 20, style, children }: BlurViewProps) {
  const opacity = Math.min(intensity / 100, 0.95);
  const alphaHex = Math.round(opacity * 255).toString(16).padStart(2, '0');
  
  return (
    <View 
      style={[
        styles.overlay, 
        { backgroundColor: colors.background + alphaHex },
        style
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
