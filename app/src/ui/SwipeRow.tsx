import Feather from '@expo/vector-icons/Feather';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts } from '../theme';
import type { IconName } from './kit';

export type SwipeAction = { label: string; icon: IconName; onPress: () => void; tone?: 'danger' };

const ACTION_W = 76;
/** Minimum sideways travel before a drag counts as a swipe (so taps and vertical scrolls pass through). */
const SLOP = 10;

/** Where a released drag ends up: open when dragged past half the actions' width (or flicked), else closed. */
export function settleOpen(startedOpen: boolean, dx: number, vx: number, openWidth: number): boolean {
  const pos = Math.min(0, Math.max(-openWidth, (startedOpen ? -openWidth : 0) + dx));
  if (Math.abs(vx) > 0.5) return vx < 0;
  return pos < -openWidth / 2;
}

/**
 * A row that reveals actions on a left swipe (wireframes F1, F5, D5). The action buttons stay in the
 * accessibility tree while hidden (the row on top covers them until it slides away), so a screen reader can use them without the gesture.
 */
export function SwipeRow({ actions, children }: { actions: SwipeAction[]; children: ReactNode }) {
  const width = actions.length * ACTION_W;
  const widthRef = useRef(width);
  useEffect(() => {
    widthRef.current = width;
  }, [width]);
  // One long-lived gesture handler per row; `s` is its mutable state (the actions' width can change between renders).
  // The handler only reads the ref inside gesture callbacks, never while rendering.
  // eslint-disable-next-line react-hooks/refs
  const [swipe] = useState(() => {
    const s = { open: false, width: () => widthRef.current };
    const x = new Animated.Value(0);
    const settle = (to: boolean) => {
      s.open = to;
      Animated.spring(x, { toValue: to ? -s.width() : 0, useNativeDriver: true, bounciness: 0 }).start();
    };
    const pan = PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > SLOP && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderMove: (_, g) => x.setValue(Math.min(0, Math.max(-s.width(), (s.open ? -s.width() : 0) + g.dx))),
      onPanResponderRelease: (_, g) => settle(settleOpen(s.open, g.dx, g.vx, s.width())),
      onPanResponderTerminate: () => settle(s.open),
    });
    return { s, x, settle, pan };
  });
  const { x, settle, pan } = swipe;

  return (
    <View>
      <View style={styles.actions}>
        {actions.map((a) => (
          <Pressable
            key={a.label}
            accessibilityRole="button"
            accessibilityLabel={a.label}
            onPress={() => {
              settle(false);
              a.onPress();
            }}
            style={[styles.action, { backgroundColor: a.tone === 'danger' ? colors.dangerBg : colors.tint }]}
          >
            <Feather name={a.icon} size={18} color={a.tone === 'danger' ? colors.danger : colors.accent} />
            <Text style={[styles.actionText, { color: a.tone === 'danger' ? colors.danger : colors.accent }]}>{a.label}</Text>
          </Pressable>
        ))}
      </View>
      <Animated.View {...pan.panHandlers} style={[styles.front, { transform: [{ translateX: x }] }]}>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  front: { backgroundColor: colors.bg },
  actions: { position: 'absolute', top: 0, bottom: 0, right: 0, flexDirection: 'row' },
  action: { width: ACTION_W, alignItems: 'center', justifyContent: 'center', gap: 4 },
  actionText: { fontFamily: fonts.sansHeavy, fontSize: 10.5 },
});
