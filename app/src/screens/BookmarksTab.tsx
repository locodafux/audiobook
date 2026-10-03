import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { NOTE_MAX, forBook, formatPosition, type Bookmark } from '../bookmarks/bookmarks';
import { usePhone } from '../phone/PhoneProvider';
import { useStore } from '../phone/persisted';
import { colors, fonts } from '../theme';
import { EmptyState } from '../ui/kit';
import { NoteDialog } from '../ui/settingsKit';
import { SwipeRow } from '../ui/SwipeRow';

/** A book's bookmarks: tap to jump there, swipe left for Edit note / Delete (wireframe D5). */
export function BookmarksTab({ bookId, onJump }: { bookId: string; onJump: (bookmark: Bookmark) => void }) {
  const { bookmarks } = usePhone();
  const list = forBook(useStore(bookmarks), bookId);
  const [editing, setEditing] = useState<Bookmark | null>(null);

  if (list.length === 0) {
    return (
      <EmptyState
        icon="bookmark"
        title="No bookmarks yet"
        body="Tap the bookmark button in the player to save the sentence you're on. You can add a note to it here."
      />
    );
  }
  return (
    <View>
      {list.map((b) => (
        <SwipeRow
          key={b.id}
          actions={[
            { label: 'Edit note', icon: 'edit-3', onPress: () => setEditing(b) },
            { label: 'Delete', icon: 'trash-2', tone: 'danger', onPress: () => bookmarks.remove(b.id) },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Chapter ${b.chapterN} at ${formatPosition(b.positionS)}${b.quote ? `, ${b.quote}` : ''}${b.note ? `, note: ${b.note}` : ''}`}
            onPress={() => onJump(b)}
            style={styles.row}
          >
            <Text style={styles.where}>
              Ch. {b.chapterN} · {formatPosition(b.positionS)}
            </Text>
            {b.quote ? <Text style={styles.quote}>“{b.quote}”</Text> : null}
            {b.note ? (
              <View style={styles.note}>
                <Feather name="file-text" size={12} color={colors.accent} />
                <Text style={styles.noteText}>{b.note}</Text>
              </View>
            ) : null}
          </Pressable>
        </SwipeRow>
      ))}
      {/* key: a fresh text field (with that bookmark's note) each time the dialog opens */}
      <NoteDialog
        key={editing?.id ?? 'none'}
        visible={!!editing}
        initial={editing?.note ?? ''}
        max={NOTE_MAX}
        onSave={(note) => {
          if (editing) bookmarks.setNote(editing.id, note);
          setEditing(null);
        }}
        onCancel={() => setEditing(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: 12, paddingHorizontal: 20, gap: 4 },
  where: { fontFamily: fonts.sansHeavy, fontSize: 11, color: colors.muted },
  quote: { fontFamily: fonts.serif, fontSize: 14, lineHeight: 21, color: colors.text },
  note: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  noteText: { flex: 1, fontFamily: fonts.sansBold, fontSize: 12, color: colors.accent },
});
