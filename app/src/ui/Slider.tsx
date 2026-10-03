import { useState } from 'react';
import { StyleSheet, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';

import { colors } from '../theme';

/** A draggable bar. `value` is 0..1; `onCommit` fires when the finger lifts (a tap seeks too). */
export function Slider({ value, onCommit, label }: { value: number; onCommit: (v: number) => void; label: string }) {
  const [width, setWidth] = useState(1);
  const [drag, setDrag] = useState<number | null>(null);
  const at = (e: GestureResponderEvent) => Math.min(1, Math.max(0, e.nativeEvent.locationX / width));
  const shown = drag ?? value;
  return (
    <View
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(shown * 100) }}
      onLayout={(e: LayoutChangeEvent) => setWidth(Math.max(1, e.nativeEvent.layout.width))}
      onStartShouldSetResponder={() => true}
      onResponderGrant={(e) => setDrag(at(e))}
      onResponderMove={(e) => setDrag(at(e))}
      onResponderRelease={(e) => (setDrag(null), onCommit(at(e)))}
      onResponderTerminate={() => setDrag(null)}
      style={styles.hit}
    >
      <View pointerEvents="none" style={styles.track}>
        <View style={[styles.fill, { width: `${shown * 100}%` }]} />
      </View>
      <View pointerEvents="none" style={[styles.knob, { left: `${shown * 100}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  hit: { height: 32, justifyContent: 'center' },
  track: { height: 5, borderRadius: 3, backgroundColor: colors.raised, overflow: 'hidden' },
  fill: { height: 5, backgroundColor: colors.accent },
  knob: { position: 'absolute', width: 16, height: 16, borderRadius: 8, marginLeft: -8, backgroundColor: colors.accent },
});
