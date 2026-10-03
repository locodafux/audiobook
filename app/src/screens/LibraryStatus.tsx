import { useState } from 'react';
import { View } from 'react-native';

import type { BookListState } from '../data/useBookList';
import { timeAgo } from '../format';
import { Button, EmptyState, OfflinePill, Skeleton } from '../ui/kit';

export const SkeletonRows = () => (
  <View style={{ paddingHorizontal: 20, gap: 20, paddingTop: 10 }}>
    {[0, 1, 2].map((i) => (
      <View key={i} style={{ flexDirection: 'row', gap: 12 }}>
        <Skeleton width={44} height={64} radius={9} />
        <View style={{ gap: 8, paddingTop: 6 }}>
          <Skeleton width={160} height={14} />
          <Skeleton width={100} height={10} />
        </View>
      </View>
    ))}
  </View>
);

/** The pill above a list that came from the saved copy because the server could not be reached. */
export function CachedPill({ state }: { state: BookListState }) {
  const [now] = useState(Date.now);
  if (state.status !== 'ready' || state.list.source !== 'cache' || state.refreshing) return null;
  return <OfflinePill>Offline · list from {timeAgo(state.list.fetchedAt, now)}</OfflinePill>;
}

export function LibraryError({ onRetry }: { onRetry: () => void }) {
  return (
    <EmptyState
      icon="wifi-off"
      tone="danger"
      title="Can't reach the library"
      body="Check your connection and try again."
      action={<Button label="Retry" variant="ghost" onPress={onRetry} />}
    />
  );
}
