import Feather from '@expo/vector-icons/Feather';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { formatClock, formatSpeed } from '../format';
import { useServices, type Services } from '../servicesContext';
import { useStore as usePhoneStore } from '../phone/persisted';
import { useStore } from '../store';
import { colors, fonts } from '../theme';
import { Button, EmptyState, type IconName } from '../ui/kit';
import { Slider } from '../ui/Slider';
import { ChaptersSheet, ReadingSheet, SleepSheet, SpeedSheet } from './PlayerSheets';

/** Full-screen player. The read-along text fills the frame and follows the voice (wireframe E1). */
export function PlayerScreen({ onClose }: { onClose: () => void }) {
  const services = useServices();
  if (!services) return null;
  return <Player services={services} onClose={onClose} />;
}

const TEXT_PX = { small: 15, medium: 18, large: 22 } as const;

type SheetName = 'speed' | 'sleep' | 'chapters' | 'reading' | null;

function Player({ services, onClose }: { services: Services; onClose: () => void }) {
  const { player, settings, bookmarks, queue, downloaded } = services;
  const s = useStore(player.state);
  const p = usePhoneStore(settings);
  const fontSize = TEXT_PX[p.textSize];
  const [bookmarked, setBookmarked] = useState(false);
  const jobs = useStore(queue.state).jobs;
  useStore(downloaded.state);
  const [sheet, setSheet] = useState<SheetName>(null);
  const list = useRef<FlatList>(null);
  const [away, setAway] = useState(false); // the reader scrolled away from the current sentence
  const retried = useRef<number | null>(null); // the sentence whose failed scroll was already retried
  const retryTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(retryTimer.current), []);

  // Follow the voice: keep the current sentence in view unless the reader scrolled elsewhere.
  useEffect(() => {
    if (!p.follow || s.sentenceIndex < 0 || away) return;
    retried.current = null;
    list.current?.scrollToIndex({ index: s.sentenceIndex, viewPosition: 0.35, animated: true });
  }, [s.sentenceIndex, p.follow, away]);

  // A row that was never drawn (after a seek or resume far down a long chapter) has no known position:
  // jump to its estimated offset so it gets drawn, then scroll to it properly, once.
  const scrollFailed = (info: { index: number; averageItemLength: number }) => {
    if (retried.current === info.index) return;
    retried.current = info.index;
    list.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
    clearTimeout(retryTimer.current);
    retryTimer.current = setTimeout(() => list.current?.scrollToIndex({ index: info.index, viewPosition: 0.35, animated: true }), 100);
  };

  const book = s.book;
  const chapter = s.chapters.find((c) => c.n === s.chapterN);
  const jobHere = jobs.find((j) => j.bookId === book?.id && j.n === s.chapterN);

  const top = (
    <View style={styles.top}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close player" hitSlop={10} onPress={onClose}>
        <Feather name="chevron-down" size={26} color={colors.text} />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={styles.book}>
          {book?.title}
        </Text>
        <Text numberOfLines={1} style={styles.chapter}>
          {s.chapterN ? `${s.chapterN}. ` : ''}
          {chapter?.title ?? ''}
        </Text>
      </View>
      {book && s.chapterN !== null && s.load === 'ready' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Bookmark this spot"
          hitSlop={10}
          onPress={() => {
            bookmarks.add({ bookId: book.id, chapterN: s.chapterN!, positionS: s.position, quote: s.sentences[s.sentenceIndex]?.t });
            setBookmarked(true);
            setTimeout(() => setBookmarked(false), 1500);
          }}
        >
          <Feather name={bookmarked ? 'check' : 'bookmark'} size={20} color={bookmarked ? colors.accent : colors.text} />
        </Pressable>
      ) : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Reading settings" hitSlop={10} onPress={() => setSheet('reading')}>
        <Text style={styles.aa}>Aa</Text>
      </Pressable>
    </View>
  );

  if (s.load === 'missing') {
    return (
      <SafeAreaView style={styles.safe}>
        {top}
        <EmptyState
          icon="download-cloud"
          title="This chapter is not on your phone"
          body={jobHere ? (jobHere.status === 'failed' ? 'The download failed.' : 'It is on its way.') : 'Download it to listen offline.'}
          action={
            jobHere?.status === 'failed' ? (
              <Button label="Try again" onPress={() => queue.retry(jobHere.bookId, jobHere.n)} />
            ) : jobHere ? undefined : (
              <Button
                label="Download"
                icon="download"
                onPress={() => {
                  if (chapter && book) {
                    queue.enqueue([{ bookId: book.id, bookTitle: book.title, n: chapter.n, title: chapter.title, bytes: chapter.bytes, durationS: chapter.duration_s, sentenceCount: chapter.sentence_count }]);
                    queue.doFirst(book.id, chapter.n);
                  }
                }}
              />
            )
          }
        />
        {sheet === 'chapters' ? <ChaptersSheet player={player} state={s} onClose={() => setSheet(null)} isOnPhone={(n) => !!book && downloaded.has(book.id, n)} /> : null}
        <Pressable accessibilityRole="button" onPress={() => setSheet('chapters')} style={styles.pillBtn}>
          <Feather name="list" size={16} color={colors.text} />
          <Text style={styles.pillText}>Chapters</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const frac = s.duration > 0 ? s.position / s.duration : 0;
  const ctl = (icon: IconName, label: string, onPress: () => void, big = false) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={8} style={big ? styles.play : styles.ctl}>
      <Feather name={icon} size={big ? 30 : 24} color={big ? colors.onAccent : colors.text} />
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.safe}>
      {top}
      {s.rewound ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>Welcome back. Rewound {s.rewound.seconds} s.</Text>
          <Pressable accessibilityRole="button" onPress={() => player.undoRewind()}>
            <Text style={styles.undo}>Undo</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={{ flex: 1 }}>
        {s.sentences.length === 0 ? (
          <EmptyState icon="headphones" title={s.load === 'loading' ? 'Opening…' : 'Listening mode'} body={s.load === 'loading' ? '' : 'The text for this chapter is not available, the voice plays on.'} />
        ) : (
          <FlatList
            ref={list}
            data={s.sentences}
            keyExtractor={(x) => String(x.i)}
            extraData={`${s.sentenceIndex}:${fontSize}`}
            contentContainerStyle={styles.text}
            onScrollBeginDrag={() => setAway(true)}
            onScrollToIndexFailed={scrollFailed}
            renderItem={({ item, index }) => (
              <Text
                accessibilityRole="button"
                onPress={() => (setAway(false), player.seekToSentence(index))}
                style={[styles.sentence, { fontSize: fontSize, lineHeight: fontSize * 1.55 }, index === s.sentenceIndex ? styles.now : index < s.sentenceIndex ? styles.read : null]}
              >
                {item.t}{' '}
              </Text>
            )}
          />
        )}
        {away && s.sentenceIndex >= 0 ? (
          <Pressable accessibilityRole="button" style={styles.jump} onPress={() => setAway(false)}>
            <Feather name="crosshair" size={14} color={colors.onAccent} />
            <Text style={styles.jumpText}>Jump to now</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.controls}>
        <Slider label="Position in chapter" value={frac} onCommit={(v) => player.seekTo(v * s.duration)} />
        <View style={styles.times}>
          <Text style={styles.time}>{formatClock(s.position)}</Text>
          <Text style={styles.time}>-{formatClock(Math.max(0, s.duration - s.position))}</Text>
        </View>
        <View style={styles.row}>
          {ctl('skip-back', 'Previous sentence', () => player.prevSentence())}
          {ctl('rotate-ccw', `Back ${p.skipBackS} seconds`, () => player.skipBack())}
          {ctl(s.playing ? 'pause' : 'play', s.playing ? 'Pause' : 'Play', () => player.toggle(), true)}
          {ctl('rotate-cw', `Forward ${p.skipForwardS} seconds`, () => player.skipForward())}
          {ctl('skip-forward', 'Next sentence', () => player.nextSentence())}
        </View>
        <View style={styles.row}>
          <Pressable accessibilityRole="button" accessibilityLabel="Speed" onPress={() => setSheet('speed')} style={styles.pillBtn}>
            <Text style={styles.pillText}>{formatSpeed(s.speed)}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Sleep timer" onPress={() => setSheet('sleep')} style={[styles.pillBtn, s.sleep && { backgroundColor: colors.tint }]}>
            <Feather name="moon" size={15} color={s.sleep ? colors.accent : colors.text} />
            <Text style={[styles.pillText, s.sleep && { color: colors.accent }]}>{s.sleep ? (s.sleep.kind === 'chapter' ? 'Chapter end' : formatClock(s.sleepLeftS ?? 0)) : 'Sleep'}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Chapters" onPress={() => setSheet('chapters')} style={styles.pillBtn}>
            <Feather name="list" size={15} color={colors.text} />
            <Text style={styles.pillText}>Chapters</Text>
          </Pressable>
        </View>
      </View>

      {sheet === 'speed' ? <SpeedSheet player={player} state={s} settings={p} onClose={() => setSheet(null)} /> : null}
      {sheet === 'sleep' ? <SleepSheet player={player} state={s} onClose={() => setSheet(null)} /> : null}
      {sheet === 'chapters' ? <ChaptersSheet player={player} state={s} onClose={() => setSheet(null)} isOnPhone={(n) => !!book && downloaded.has(book.id, n)} /> : null}
      {sheet === 'reading' ? <ReadingSheet settings={p} store={settings} onClose={() => setSheet(null)} /> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
  book: { fontFamily: fonts.sansBold, fontSize: 12, color: colors.muted },
  chapter: { fontFamily: fonts.serif, fontSize: 15, color: colors.text },
  aa: { fontFamily: fonts.serif, fontSize: 18, color: colors.text },
  banner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 16, padding: 10, borderRadius: 14, backgroundColor: colors.tint },
  bannerText: { fontFamily: fonts.sans, fontSize: 12, color: colors.text },
  undo: { fontFamily: fonts.sansHeavy, fontSize: 12.5, color: colors.accent },
  text: { paddingHorizontal: 22, paddingVertical: 20 },
  sentence: { fontFamily: fonts.sans, color: colors.muted },
  read: { color: colors.subtle },
  now: { color: colors.text, fontFamily: fonts.sansBold, backgroundColor: colors.tint },
  jump: { position: 'absolute', alignSelf: 'center', bottom: 12, flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: colors.accent, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 99 },
  jumpText: { fontFamily: fonts.sansHeavy, fontSize: 12, color: colors.onAccent },
  controls: { paddingHorizontal: 20, paddingBottom: 10, gap: 6 },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  time: { fontFamily: fonts.sans, fontSize: 11, color: colors.muted },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', marginVertical: 6 },
  ctl: { padding: 10 },
  play: { width: 68, height: 68, borderRadius: 34, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  pillBtn: { flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: colors.surf2, paddingVertical: 9, paddingHorizontal: 15, borderRadius: 99, alignSelf: 'center' },
  pillText: { fontFamily: fonts.sansBold, fontSize: 12.5, color: colors.text },
});
