import Feather from '@expo/vector-icons/Feather';
import type { ComponentProps, ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { colors, fonts } from '../theme';

export type IconName = ComponentProps<typeof Feather>['name'];

export function Button({
  label,
  onPress,
  variant = 'primary',
  busy,
  disabled,
  icon,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost';
  busy?: boolean;
  disabled?: boolean;
  icon?: IconName;
}) {
  const primary = variant === 'primary';
  const fg = primary ? colors.onAccent : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled || !!busy, busy: !!busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={[styles.btn, primary ? styles.btnPrimary : styles.btnGhost, (disabled || busy) && { opacity: 0.5 }]}
    >
      {busy ? <ActivityIndicator color={fg} /> : icon ? <Feather name={icon} size={17} color={fg} /> : null}
      <Text style={[styles.btnText, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, error, ...input }: TextInputProps & { label: string; error?: boolean }) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.subtle}
        selectionColor={colors.accent}
        accessibilityLabel={label}
        {...input}
        style={[styles.field, error && { borderColor: colors.danger }, input.style]}
      />
    </View>
  );
}

export function Callout({ tone = 'info', icon, children }: { tone?: 'info' | 'warn' | 'bad'; icon: IconName; children: ReactNode }) {
  const bg = { info: colors.tint, warn: colors.warnBg, bad: colors.dangerBg }[tone];
  const fg = { info: colors.accent, warn: colors.warn, bad: colors.danger }[tone];
  return (
    <View style={[styles.callout, { backgroundColor: bg }]} accessibilityRole={tone === 'bad' ? 'alert' : undefined}>
      <Feather name={icon} size={17} color={fg} style={{ marginTop: 1 }} />
      <Text style={styles.calloutText}>{children}</Text>
    </View>
  );
}

export function OfflinePill({ children }: { children: ReactNode }) {
  return (
    <View style={styles.pill}>
      <Feather name="wifi-off" size={15} color={colors.text} />
      <Text style={styles.pillText}>{children}</Text>
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  tone,
}: {
  icon: IconName;
  title: string;
  body: string;
  action?: ReactNode;
  tone?: 'danger';
}) {
  return (
    <View style={styles.empty}>
      <View style={[styles.bubble, tone === 'danger' && { backgroundColor: colors.dangerBg }]}>
        <Feather name={icon} size={28} color={tone === 'danger' ? colors.danger : colors.accent} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      {action}
    </View>
  );
}

/** Grey block shown while something loads, so a screen is never blank. */
export function Skeleton({ width, height, radius = 8 }: { width: number | `${number}%`; height: number; radius?: number }) {
  return <View style={{ width, height, borderRadius: radius, backgroundColor: colors.surf2 }} />;
}

export function ScreenTitle({ children, sub }: { children: string; sub?: string }) {
  return (
    <View style={styles.titleWrap}>
      {sub ? <Text style={styles.titleSub}>{sub}</Text> : null}
      <Text accessibilityRole="header" style={styles.title}>
        {children}
      </Text>
    </View>
  );
}

export const textStyles = StyleSheet.create({
  kicker: { fontFamily: fonts.sansHeavy, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: colors.muted },
  body: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 20, color: colors.muted },
  heading: { fontFamily: fonts.serif, fontSize: 30, lineHeight: 33, letterSpacing: -0.6, color: colors.text },
  link: { fontFamily: fonts.sansHeavy, fontSize: 12, color: colors.accent, textAlign: 'center' },
});

const styles = StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 99 },
  btnPrimary: { backgroundColor: colors.accent },
  btnGhost: { borderWidth: 1.5, borderColor: colors.line },
  btnText: { fontFamily: fonts.sansHeavy, fontSize: 13.5 },
  label: { fontFamily: fonts.sansHeavy, fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', color: colors.muted, marginBottom: 6 },
  field: { backgroundColor: colors.surf, borderRadius: 16, padding: 14, fontSize: 14, fontFamily: fonts.sans, color: colors.text, borderWidth: 1.5, borderColor: colors.line },
  callout: { flexDirection: 'row', gap: 10, padding: 12, borderRadius: 16, alignItems: 'flex-start' },
  calloutText: { flex: 1, fontFamily: fonts.sans, fontSize: 12, lineHeight: 17, color: colors.text },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', marginHorizontal: 20, marginBottom: 8, backgroundColor: colors.surf2, borderRadius: 99, paddingVertical: 7, paddingHorizontal: 14 },
  pillText: { fontFamily: fonts.sansBold, fontSize: 11.5, color: colors.text },
  empty: { margin: 20, padding: 26, backgroundColor: colors.surf, borderRadius: 22, alignItems: 'center', gap: 8 },
  bubble: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontFamily: fonts.serif, fontSize: 17, color: colors.text, textAlign: 'center' },
  emptyBody: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, color: colors.muted, textAlign: 'center' },
  titleWrap: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 6 },
  titleSub: { fontFamily: fonts.sans, fontSize: 12, color: colors.muted },
  title: { fontFamily: fonts.serif, fontSize: 26, letterSpacing: -0.4, color: colors.text },
});
