/**
 * GeoSessionStore — persists debug panel metrics across app sessions.
 *
 * Metrics live in-memory on the native side and reset whenever tracking
 * restarts (app killed, OS killed the service, device rebooted). This store
 * snapshots values to AsyncStorage so the debug panel can show cumulative
 * totals spanning multiple sessions.
 *
 * Storage key: @rn_geo_service/debug_session
 *
 * Schema:
 *   accumulated   — sum of all fully-closed previous sessions
 *   lastSnapshot  — most recent known state; used to detect session boundaries
 *   trackingStartedAt — Unix ms timestamp of the very first start() ever recorded
 *                       (not overwritten until clear() is called)
 */

import type { BatteryInfo } from './types';

const STORAGE_KEY = '@rn_geo_service/debug_session';

// Lazily required so the package doesn't hard-crash if AsyncStorage is not
// installed in the host app (it's a peerDependency).
function getStorage(): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('@react-native-async-storage/async-storage').default;
  } catch (_) {
    return null;
  }
}

export interface AccumulatedStats {
  updateCount: number;
  elapsedSeconds: number;
  gpsActiveSeconds: number;
  drain: number;
}

export interface SnapshotStats extends AccumulatedStats {
  batteryLevelAtStart: number;
}

export interface StoreData {
  accumulated: AccumulatedStats;
  lastSnapshot: SnapshotStats | null;
  /** Unix ms — when the very first session began. Null until first saveSnapshot(). */
  trackingStartedAt: number | null;
}

const ZERO_ACCUMULATED: AccumulatedStats = {
  updateCount: 0,
  elapsedSeconds: 0,
  gpsActiveSeconds: 0,
  drain: 0,
};

function addStats(a: AccumulatedStats, b: AccumulatedStats): AccumulatedStats {
  return {
    updateCount:      a.updateCount      + b.updateCount,
    elapsedSeconds:   a.elapsedSeconds   + b.elapsedSeconds,
    gpsActiveSeconds: a.gpsActiveSeconds + b.gpsActiveSeconds,
    drain:            a.drain            + b.drain,
  };
}

async function readRaw(): Promise<StoreData> {
  const storage = getStorage();
  if (!storage) return { accumulated: { ...ZERO_ACCUMULATED }, lastSnapshot: null, trackingStartedAt: null };
  try {
    const raw = await storage.getItem(STORAGE_KEY);
    if (!raw) return { accumulated: { ...ZERO_ACCUMULATED }, lastSnapshot: null, trackingStartedAt: null };
    return JSON.parse(raw) as StoreData;
  } catch (_) {
    return { accumulated: { ...ZERO_ACCUMULATED }, lastSnapshot: null, trackingStartedAt: null };
  }
}

async function writeRaw(data: StoreData): Promise<void> {
  const storage = getStorage();
  if (!storage) return;
  try {
    await storage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (_) {}
}

/**
 * Load accumulated stats + trackingStartedAt from storage.
 * Returns zero defaults if nothing has been stored yet.
 */
async function load(): Promise<StoreData> {
  return readRaw();
}

/**
 * Snapshot the current session's BatteryInfo into storage.
 *
 * - Detects session boundaries via batteryLevelAtStart:
 *   if it differs from the stored lastSnapshot, the previous session is
 *   archived into accumulated before storing the new snapshot.
 * - Records trackingStartedAt on the very first call (never overwritten).
 */
async function saveSnapshot(info: BatteryInfo): Promise<void> {
  const data = await readRaw();

  const newSnapshot: SnapshotStats = {
    updateCount:         info.updateCount          ?? 0,
    elapsedSeconds:      info.trackingElapsedSeconds ?? 0,
    gpsActiveSeconds:    info.gpsActiveSeconds      ?? 0,
    drain:               info.drainSinceStart        ?? 0,
    batteryLevelAtStart: info.levelAtStart           ?? -1,
  };

  let { accumulated, trackingStartedAt } = data;

  // Detect session boundary — a different batteryLevelAtStart means start() was called again
  if (
    data.lastSnapshot !== null &&
    data.lastSnapshot.batteryLevelAtStart !== newSnapshot.batteryLevelAtStart
  ) {
    accumulated = addStats(accumulated, data.lastSnapshot);
  }

  // Record start time once — on the very first snapshot ever, or after a clear()
  if (trackingStartedAt === null) {
    trackingStartedAt = Date.now();
  }

  await writeRaw({ accumulated, lastSnapshot: newSnapshot, trackingStartedAt });
}

/**
 * Called from the Android headless task when the app is killed but the
 * foreground service is still delivering location updates.
 * Increments the updateCount in lastSnapshot by 1.
 * Safe to call from a HeadlessJS context (no native bridge required).
 */
async function onHeadlessLocation(): Promise<void> {
  const data = await readRaw();
  const snap = data.lastSnapshot ?? {
    updateCount: 0,
    elapsedSeconds: 0,
    gpsActiveSeconds: 0,
    drain: 0,
    batteryLevelAtStart: -1,
  };
  await writeRaw({
    ...data,
    lastSnapshot: { ...snap, updateCount: snap.updateCount + 1 },
  });
}

/**
 * Clear all accumulated data, lastSnapshot, and trackingStartedAt.
 * The panel reverts to current-session-only view after calling this.
 */
async function clear(): Promise<void> {
  const storage = getStorage();
  if (!storage) return;
  try {
    await storage.removeItem(STORAGE_KEY);
  } catch (_) {}
}

export const GeoSessionStore = { load, saveSnapshot, onHeadlessLocation, clear };
