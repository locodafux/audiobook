import { Feather } from '@expo/vector-icons';
import { useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { colors, fonts } from '../theme';
import { Button, type IconName } from './kit';

/** "‹ Playback" header for a settings page. */
export function BackHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} hitSlop={8} style={{ padding: 4 }}>
        <Feather name="chevron-left" size={24} color={colors.text} />
      </Pressable>
      <Text accessibilityRole="header" style={styles.headerTitle}>
        {title}
      </Text>
    </View>
  );
}

export const Group = ({ title, children }: { title?: string; children: ReactNode }) => (
  <View style={{ marginTop: 18 }}>
    {title ? <Text style={styles.groupTitle}>{title}</Text> : null}
    <View style={styles.group}>{children}</View>
  </View>
);

/** One line of a settings list: icon, title, optional second line, and a value or control on the right. */
export function Row({ icon, title, sub, right, onPress }: { icon?: IconName; title: string; sub?: string; right?: ReactNode; onPress?: () => void }) {
  const body = (
    <>
      {icon ? <Feather name={icon} size={20} color={colors.muted} /> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
      </View>
      {right ?? (onPress ? <Feather name="chevron-right" size={18} color={colors.subtle} /> : null)}
    </>
  );
  return onPress ? (
    <Pressable accessibilityRole="button" accessibilityLabel={sub ? `${title}, ${sub}` : title} onPress={onPress} style={styles.row}>
      {body}
    </Pressable>
  ) : (
    <View style={styles.row}>{body}</View>
  );
}

export function SwitchRow({ icon, title, sub, value, onChange }: { icon?: IconName; title: string; sub?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Row
      icon={icon}
      title={title}
      sub={sub}
      right={
        <Switch
          accessibilityLabel={title}
          value={value}
          onValueChange={onChange}
          trackColor={{ false: colors.raised, true: colors.accent }}
          thumbColor={colors.text}
        />
      }
    />
  );
}

/** A row showing the current choice; tapping opens a list to pick another. */
export function ChoiceRow<T extends string | number>({
  icon,
  title,
  sub,
  value,
  options,
  label,
  onChange,
}: {
  icon?: IconName;
  title: string;
  sub?: string;
  value: T;
  options: readonly T[];
  label: (v: T) => string;
  onChange: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Row
        icon={icon}
        title={title}
        sub={sub}
        onPress={() => setOpen(true)}
        right={
          <View style={styles.value}>
            <Text style={styles.valueText}>{label(value)}</Text>
          </View>
        }
      />
      <Sheet visible={open} title={title} onClose={() => setOpen(false)}>
        {options.map((o) => (
          <Pressable
            key={String(o)}
            accessibilityRole="radio"
            accessibilityState={{ selected: o === value }}
            onPress={() => {
              onChange(o);
              setOpen(false);
            }}
            style={styles.choice}
          >
            <Text style={[styles.choiceText, o === value && { color: colors.accent }]}>{label(o)}</Text>
            {o === value ? <Feather name="check" size={18} color={colors.accent} /> : null}
          </Pressable>
        ))}
      </Sheet>
    </>
  );
}

/** A row of mutually exclusive pills. */
export function Segmented<T extends string>({ value, options, label, onChange }: { value: T; options: readonly T[]; label: (v: T) => string; onChange: (v: T) => void }) {
  return (
    <View style={styles.seg} accessibilityRole="radiogroup">
      {options.map((o) => (
        <Pressable
          key={o}
          accessibilityRole="radio"
          accessibilityState={{ selected: o === value }}
          onPress={() => onChange(o)}
          style={[styles.segItem, o === value && { backgroundColor: colors.tint }]}
        >
          <Text style={[styles.segText, o === value && { color: colors.accent }]}>{label(o)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Sheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close" style={styles.scrim} onPress={onClose}>
        <Pressable accessible={false} style={styles.sheet}>
          <Text style={styles.sheetTitle}>{title}</Text>
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Centered confirm box (wireframes F6, G7, G8): says exactly what goes and what stays. */
export function ConfirmDialog({
  visible,
  icon,
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  icon: IconName;
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.scrim}>
        <View style={styles.dialog} accessibilityViewIsModal>
          <View style={[styles.dialogIcon, danger && { backgroundColor: colors.dangerBg }]}>
            <Feather name={icon} size={24} color={danger ? colors.danger : colors.accent} />
          </View>
          <Text style={styles.dialogTitle}>{title}</Text>
          <Text style={styles.dialogBody}>{body}</Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
            <View style={{ flex: 1 }}>
              <Button label="Cancel" variant="ghost" onPress={onCancel} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label={confirmLabel} onPress={onConfirm} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** Box for typing a bookmark note. */
export function NoteDialog({ visible, initial, max, onSave, onCancel }: { visible: boolean; initial: string; max: number; onSave: (note: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(initial);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.scrim}>
        <View style={styles.dialog} accessibilityViewIsModal>
          <Text style={styles.dialogTitle}>Note</Text>
          <TextInput
            accessibilityLabel="Note"
            autoFocus
            multiline
            maxLength={max}
            value={text}
            onChangeText={setText}
            placeholder="Why did you save this?"
            placeholderTextColor={colors.subtle}
            selectionColor={colors.accent}
            style={styles.note}
          />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Button label="Cancel" variant="ghost" onPress={onCancel} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="Save" onPress={() => onSave(text)} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingTop: 6, paddingBottom: 6 },
  headerTitle: { fontFamily: fonts.serif, fontSize: 22, color: colors.text },
  groupTitle: { fontFamily: fonts.sansHeavy, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: colors.muted, marginHorizontal: 20, marginBottom: 8 },
  group: { marginHorizontal: 20, backgroundColor: colors.surf, borderRadius: 20, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 16 },
  rowTitle: { fontFamily: fonts.sansBold, fontSize: 14, color: colors.text },
  rowSub: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 16, color: colors.muted, marginTop: 1 },
  value: { backgroundColor: colors.surf2, borderRadius: 99, paddingVertical: 6, paddingHorizontal: 12 },
  valueText: { fontFamily: fonts.sansBold, fontSize: 12, color: colors.text },
  choice: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 },
  choiceText: { fontFamily: fonts.sansBold, fontSize: 14, color: colors.text },
  seg: { flexDirection: 'row', backgroundColor: colors.surf2, borderRadius: 99, padding: 4, gap: 4 },
  segItem: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 99 },
  segText: { fontFamily: fonts.sansBold, fontSize: 12, color: colors.muted },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 },
  sheet: { backgroundColor: colors.surf, borderRadius: 22, paddingVertical: 18, paddingHorizontal: 22 },
  sheetTitle: { fontFamily: fonts.serif, fontSize: 18, color: colors.text, marginBottom: 4 },
  dialog: { backgroundColor: colors.surf, borderRadius: 24, padding: 22, gap: 10, alignItems: 'stretch' },
  dialogIcon: { alignSelf: 'center', width: 52, height: 52, borderRadius: 26, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  dialogTitle: { fontFamily: fonts.serif, fontSize: 18, color: colors.text, textAlign: 'center' },
  dialogBody: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 19, color: colors.muted, textAlign: 'center' },
  note: { minHeight: 90, textAlignVertical: 'top', backgroundColor: colors.surf2, borderRadius: 14, padding: 12, fontFamily: fonts.sans, fontSize: 14, color: colors.text },
});
