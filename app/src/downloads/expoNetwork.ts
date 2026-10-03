import * as Network from 'expo-network';

import { createStore } from '../store';
import type { NetState, NetworkWatcher } from './network';

const toState = (s: Network.NetworkState): NetState => ({ connected: !!s.isConnected, wifi: s.type === Network.NetworkStateType.WIFI || s.type === Network.NetworkStateType.ETHERNET });

/** Tracks the connection type; starts as "connected, on Wi-Fi" until the first reading arrives. */
export function createExpoNetwork(): NetworkWatcher {
  const store = createStore<NetState>({ connected: true, wifi: true });
  const apply = (s: Network.NetworkState) => {
    const next = toState(s);
    const cur = store.get();
    if (next.connected !== cur.connected || next.wifi !== cur.wifi) store.set(next);
  };
  void Network.getNetworkStateAsync().then(apply, () => {});
  Network.addNetworkStateListener(apply);
  return store;
}
