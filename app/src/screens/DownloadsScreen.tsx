import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { formatBytes, plural } from '../format';
import { usePhone } from '../phone/PhoneProvider';
import { useStore } from '../phone/persisted';
import {
  queueCounts,
  summarizeStorage,
  type DownloadsPort,
  type PhoneBook,
  type PhonePorts,
  type QueueItem,
  type StorageUsage,
} from '../storage/ports';
import { colors, fonts } from '../theme';
import { Button, EmptyState, OfflinePill, ScreenTitle } from '../ui/kit';
import { ConfirmDialog, Segmented } from '../ui/settingsKit';
import { SwipeRow } from '../ui/SwipeRow';

type Tab = 'queue' | 'phone';
const TAB_LABEL = { queue: 'Queue', phone: 'On this phone' } as const;

/** Downloads: the live queue (F1-F4) and what is stored on the phone (F5, F6). */
export function DownloadsScreen({ ports }: { ports: PhonePorts }) {
  const [tab, setTab] = useState<Tab>('queue');
  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <ScreenTitle>Downloads</ScreenTitle>
      <View style={{ marginHorizontal: 20, marginBottom: 8 }}>
        <Segmented value={tab} options={['queue', 'phone'] as const} label={(t) => TAB_LABEL[t]} onChange={setTab} />
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        {tab === 'queue' ? <QueueTab downloads={ports.downloads} /> : <StorageTab storage={ports.storage} />}
      </ScrollView>
    </SafeAreaView>
  );
}

const pct = (p?: number) => `${Math.round((p ?? 0) * 100)}%`;

function QueueTab({ downloads }: { downloads: DownloadsPort }) {
  const q = useStore(downloads);
  const { settings } = usePhone();
  const keepAhead = useStore(settings).keepNextN;
  const counts = queueCounts(q.items);
  const active = q.items.find((i) => i.status === 'active');
  const queued = q.items.filter((i) => i.status === 'queued' || i.status === 'waiting');
  const failed = q.items.filter((i) => i.status === 'failed');

  const row = (i: QueueItem, tag: string) => (
    <SwipeRow
      key={i.id}
      actions={[
        { label: 'Do first', icon: 'arrow-up', onPress: () => downloads.doFirst(i.id) },
        { label: 'Cancel', icon: 'x', tone: 'danger', onPress: () => downloads.cancel(i.id) },
      ]}
    >
      <QueueRow item={i} tag={tag} />
    </SwipeRow>
  );

  if (q.items.length === 0) {
    return (
      <>
        <EmptyState icon="check" title="All caught up" body="Chapters you download from a book page queue here with live progress." />
        {keepAhead === 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Keep the next 3 chapters ready"
            onPress={() => settings.update({ keepNextN: 3 })}
            style={styles.offer}
          >
            <Text style={styles.offerTitle}>Keep the next 3 chapters ready</Text>
            <Text style={styles.offerBody}>Downloads ahead of you so you never run out mid-commute. Change it any time in Settings.</Text>
          </Pressable>
        ) : null}
      </>
    );
  }

  return (
    <>
      {!q.online ? <OfflinePill>{q.note ?? 'No connection · will resume automatically'}</OfflinePill> : null}
      <View style={styles.head}>
        <Text style={styles.headTitle}>
          {q.paused ? 'Downloads paused' : !q.online ? 'Waiting for connection' : active ? `Downloading chapter ${active.chapterN}` : 'Starting…'}
        </Text>
        <Text style={styles.headSub}>
          {[
            counts.active ? `${counts.active} active` : null,
            counts.queued + counts.waiting ? `${counts.queued + counts.waiting} queued` : null,
            counts.failed ? `${counts.failed} failed` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        {active && q.online && !q.paused ? (
          <Text style={styles.headSub}>
            {[pct(active.progress), q.bytesLeft != null ? `${formatBytes(q.bytesLeft)} left` : null, q.bytesPerSecond ? `${(q.bytesPerSecond / 1e6).toFixed(1)} MB/s` : null].filter(Boolean).join(' · ')}
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
          <View style={{ flex: 1 }}>
            <Button label={q.paused ? 'Resume' : 'Pause queue'} variant="ghost" icon={q.paused ? 'play' : 'pause'} onPress={q.paused ? downloads.resume : downloads.pause} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="Cancel all" variant="ghost" onPress={downloads.cancelAll} />
          </View>
        </View>
      </View>
      {active ? <QueueRow item={active} tag={pct(active.progress)} /> : null}
      {queued.length ? <Section title="Queued" /> : null}
      {queued.map((i, n) => row(i, i.status === 'waiting' ? `Waiting${i.progress ? ` · ${pct(i.progress)} saved` : ''}` : `#${n + 1} in queue`))}
      {failed.length ? <Section title="Failed" action={{ label: 'Retry all', onPress: downloads.retryAll }} /> : null}
      {failed.map((i) => (
        <Pressable key={i.id} accessibilityRole="button" accessibilityLabel={`Retry chapter ${i.chapterN}, ${i.bookTitle}`} onPress={() => downloads.retry(i.id)}>
          <QueueRow item={i} tag="Tap to retry" bad />
        </Pressable>
      ))}
    </>
  );
}

function QueueRow({ item, tag, bad }: { item: QueueItem; tag: string; bad?: boolean }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={styles.rowTitle}>
          {item.chapterTitle}
        </Text>
        <Text numberOfLines={1} style={styles.rowSub}>
          {item.bookTitle} · Chapter {item.chapterN}
          {item.error ? ` · ${item.error}` : ''}
        </Text>
      </View>
      <Text style={[styles.tag, bad && { color: colors.danger }]}>{tag}</Text>
    </View>
  );
}

const Section = ({ title, action }: { title: string; action?: { label: string; onPress: () => void } }) => (
  <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.sectionTitle}>
      {title}
    </Text>
    {action ? (
      <Pressable accessibilityRole="button" onPress={action.onPress} hitSlop={8}>
        <Text style={styles.sectionAction}>{action.label}</Text>
      </Pressable>
    ) : null}
  </View>
);

type Load = { status: 'loading' } | { status: 'error' } | { status: 'ready'; usage: StorageUsage };

function StorageTab({ storage }: { storage: PhonePorts['storage'] }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [removing, setRemoving] = useState<PhoneBook | null>(null);
  const [failed, setFailed] = useState(false);
  const refresh = useCallback(
    () => storage.usage().then((usage) => setLoad({ status: 'ready', usage }), () => setLoad({ status: 'error' })),
    [storage],
  );
  useEffect(() => void refresh(), [refresh]);

  const act = async (run: () => Promise<void>) => {
    try {
      await run();
      setFailed(false);
    } catch {
      setFailed(true);
    }
    await refresh();
  };

  if (load.status === 'loading') return <Text style={styles.rowSub}>{'  '}Loading…</Text>;
  if (load.status === 'error') {
    return <EmptyState icon="alert-triangle" tone="danger" title="Can't read storage" body="Something went wrong reading the downloads on this phone." action={<Button label="Retry" variant="ghost" onPress={() => void refresh()} />} />;
  }
  const { books, freeBytes } = load.usage;
  if (books.length === 0) {
    return <EmptyState icon="download" title="Nothing on this phone" body="Downloaded chapters show up here, with the space they use." />;
  }
  const sum = summarizeStorage(books);
  return (
    <>
      <View style={styles.head}>
        <Text style={styles.headTitle}>Audiobooks {formatBytes(sum.usedBytes)}</Text>
        {freeBytes > 0 ? <Text style={styles.headSub}>{formatBytes(freeBytes)} free on the phone</Text> : null}
      </View>
      {sum.freeableChapters > 0 ? (
        <View style={styles.offer}>
          <Text style={styles.offerTitle}>{formatBytes(sum.freeableBytes)} can be freed.</Text>
          <Text style={styles.offerBody}>{plural(sum.freeableChapters, 'finished chapter')}.</Text>
          <View style={{ marginTop: 10 }}>
            <Button
              label="Free up now"
              onPress={() => void act(async () => void (await Promise.all(books.filter((b) => b.finishedChapters > 0).map((b) => storage.cleanUp(b.bookId)))))}
            />
          </View>
        </View>
      ) : null}
      {failed ? <Text style={[styles.rowSub, { color: colors.danger, marginHorizontal: 20 }]}>That didn&apos;t work. Try again.</Text> : null}
      <Section title="Books on this phone" />
      {books.map((b) => (
        <SwipeRow
          key={b.bookId}
          actions={[
            ...(b.finishedChapters > 0 ? [{ label: 'Clean up', icon: 'check' as const, onPress: () => void act(() => storage.cleanUp(b.bookId)) }] : []),
            { label: 'Remove', icon: 'trash-2' as const, tone: 'danger' as const, onPress: () => setRemoving(b) },
          ]}
        >
          <View style={styles.row}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={styles.rowTitle}>
                {b.title}
              </Text>
              <Text style={styles.rowSub}>
                {b.downloadedChapters} of {b.totalChapters}
                {b.finishedChapters === b.downloadedChapters && b.downloadedChapters > 0 ? ' · finished' : ''} · {formatBytes(b.bytes)}
              </Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${b.title}`} onPress={() => setRemoving(b)} hitSlop={8}>
              <Text style={styles.sectionAction}>Remove</Text>
            </Pressable>
          </View>
        </SwipeRow>
      ))}
      <ConfirmDialog
        visible={!!removing}
        icon="trash-2"
        danger
        title={`Remove "${removing?.title ?? ''}"?`}
        body={`Frees ${formatBytes(removing?.bytes ?? 0)}. Your place and bookmarks are kept; you can download it again any time.`}
        confirmLabel="Remove"
        onConfirm={() => {
          const b = removing;
          setRemoving(null);
          if (b) void act(() => storage.remove(b.bookId));
        }}
        onCancel={() => setRemoving(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  head: { marginHorizontal: 20, marginTop: 8, padding: 16, backgroundColor: colors.surf, borderRadius: 20 },
  headTitle: { fontFamily: fonts.serif, fontSize: 18, color: colors.text },
  headSub: { fontFamily: fonts.sans, fontSize: 12, color: colors.muted, marginTop: 3 },
  offer: { marginHorizontal: 20, marginTop: 12, padding: 16, backgroundColor: colors.tint, borderRadius: 20 },
  offerTitle: { fontFamily: fonts.sansBold, fontSize: 14, color: colors.text },
  offerBody: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 17, color: colors.muted, marginTop: 2 },
  section: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 20, marginTop: 18, marginBottom: 6 },
  sectionTitle: { fontFamily: fonts.sansHeavy, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: colors.muted },
  sectionAction: { fontFamily: fonts.sansHeavy, fontSize: 12, color: colors.accent },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 20 },
  rowTitle: { fontFamily: fonts.sansBold, fontSize: 13.5, color: colors.text },
  rowSub: { fontFamily: fonts.sans, fontSize: 11.5, color: colors.muted, marginTop: 2 },
  tag: { fontFamily: fonts.sansBold, fontSize: 11, color: colors.muted },
});
