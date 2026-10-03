import type { Store } from '../store';

export type NetState = { connected: boolean; wifi: boolean };

/** Why downloads are not running right now (null = they are free to run). */
export type Blocked = 'paused' | 'offline' | 'wifi' | 'access_ended' | null;

export const downloadsAllowed = (net: NetState, wifiOnly: boolean): 'ok' | 'offline' | 'wifi' =>
  !net.connected ? 'offline' : wifiOnly && !net.wifi ? 'wifi' : 'ok';

/** Watches the connection; the real one wraps expo-network, tests use a plain store. */
export type NetworkWatcher = Store<NetState>;
