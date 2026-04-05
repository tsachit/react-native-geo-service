import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  PanResponder,
  Animated,
  TouchableOpacity,
  AppState,
  Dimensions,
} from 'react-native';
import RNGeoService from './index';
import { GeoSessionStore } from './GeoSessionStore';
import type { BatteryInfo } from './types';
import type { AccumulatedStats, StoreData } from './GeoSessionStore';

interface Props {
  /** Refresh interval in ms. Default: 30000 */
  pollInterval?: number;
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const PANEL_WIDTH = Math.round(SCREEN_WIDTH * 0.95);
const PILL_SIZE = 50;
// Conservative estimate used when the panel hasn't rendered yet (onLayout not fired)
const PANEL_ESTIMATED_HEIGHT = 440;
const PANEL_BOTTOM_MARGIN = 20;
const PILL_INITIAL_BOTTOM_MARGIN = 120;

// ─── Formatting helpers ──────────────────────────────────────────────────────

function formatBattery(level: number): string {
  return level < 0 ? 'N/A' : `${level.toFixed(1)}%`;
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function formatGpsPercent(gpsActiveSeconds: number, elapsedSeconds: number): string {
  if (elapsedSeconds <= 0) return 'N/A';
  return `${Math.round((gpsActiveSeconds / elapsedSeconds) * 100)}%`;
}

// ─── Smart suggestions ───────────────────────────────────────────────────────

interface Suggestion {
  emoji: string;
  text: string;
  color: string;
}

function getSuggestions(info: BatteryInfo): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const elapsed   = info.trackingElapsedSeconds ?? 0;
  const updates   = info.updateCount ?? 0;
  const upm       = info.updatesPerMinute ?? 0;
  const gpsActive = info.gpsActiveSeconds ?? 0;
  const drainRate = info.drainRatePerHour ?? 0;
  const gpsPercent = elapsed > 0 ? (gpsActive / elapsed) * 100 : 0;

  // Not enough data yet
  if (updates === 0) {
    suggestions.push({ emoji: '⏳', color: '#aaa', text: 'No location updates received yet — make sure tracking has started and permission is granted' });
    return suggestions;
  }

  if (elapsed < 60) {
    suggestions.push({ emoji: '⏳', color: '#aaa', text: `${Math.round(elapsed)}s into session — rate metrics need ~1 min to stabilise` });
  }

  // ── Frequency ──
  if (upm > 20) {
    suggestions.push({ emoji: '🔴', color: '#f55', text: `Very frequent updates (${upm.toFixed(1)}/min) — increase minDistanceMeters or updateIntervalMs to reduce battery drain` });
  } else if (upm > 8) {
    suggestions.push({ emoji: '⚠️', color: '#fa0', text: `Frequent updates (${upm.toFixed(1)}/min) — consider increasing minDistanceMeters` });
  } else if (upm > 0) {
    suggestions.push({ emoji: '✅', color: '#4c4', text: `Update frequency is good (${upm.toFixed(1)}/min)` });
  }

  // ── GPS active time (only meaningful after 60s) ──
  if (elapsed >= 60) {
    if (gpsPercent > 80) {
      suggestions.push({ emoji: '🔴', color: '#f55', text: `GPS on ${Math.round(gpsPercent)}% of the time — enable adaptiveAccuracy or switch to coarseTracking to save battery` });
    } else if (gpsPercent > 50) {
      suggestions.push({ emoji: '⚠️', color: '#fa0', text: `GPS on ${Math.round(gpsPercent)}% of time — device is mostly moving, adaptive accuracy is active` });
    } else if (gpsPercent > 0) {
      suggestions.push({ emoji: '✅', color: '#4c4', text: `GPS on ${Math.round(gpsPercent)}% of time — adaptive accuracy is saving battery` });
    }
  }

  // ── Drain rate ──
  if (drainRate > 8) {
    suggestions.push({ emoji: '🔴', color: '#f55', text: `High drain (${drainRate.toFixed(1)}%/hr) — try accuracy: 'balanced' or increase update intervals` });
  } else if (drainRate > 4) {
    suggestions.push({ emoji: '⚠️', color: '#fa0', text: `Moderate drain (${drainRate.toFixed(1)}%/hr) — normal for active GPS, consider adaptiveAccuracy` });
  } else if (drainRate > 0) {
    suggestions.push({ emoji: '✅', color: '#4c4', text: `Low drain (${drainRate.toFixed(1)}%/hr) — battery usage is efficient` });
  }

  return suggestions;
}

// ─── Pan responder factory ───────────────────────────────────────────────────

function makePanResponder(
  pan: Animated.ValueXY,
  lastPos: React.MutableRefObject<{ x: number; y: number }>,
  maxWidth: number,
  maxHeight: number,
  onTap?: () => void,
) {
  const didDrag = { current: false };
  return PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      didDrag.current = false;
      pan.setOffset({ x: lastPos.current.x, y: lastPos.current.y });
      pan.setValue({ x: 0, y: 0 });
    },
    onPanResponderMove: (_, g) => {
      if (Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4) didDrag.current = true;
      (Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }) as Function)(_, g);
    },
    onPanResponderRelease: (_, g) => {
      pan.flattenOffset();
      if (!didDrag.current && onTap) { onTap(); return; }
      const newX = Math.max(0, Math.min(lastPos.current.x + g.dx, SCREEN_WIDTH - maxWidth));
      const newY = Math.max(0, Math.min(lastPos.current.y + g.dy, SCREEN_HEIGHT - maxHeight));
      lastPos.current = { x: newX, y: newY };
      pan.setValue({ x: newX, y: newY });
    },
  });
}

// ─── Component ───────────────────────────────────────────────────────────────

function formatStartedAt(ts: number | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export const GeoDebugPanel: React.FC<Props> = ({ pollInterval = 30_000 }) => {
  const [info, setInfo] = useState<BatteryInfo | null>(null);
  const [minimized, setMinimized] = useState(true);
  const [storeData, setStoreData] = useState<StoreData>({
    accumulated: { updateCount: 0, elapsedSeconds: 0, gpsActiveSeconds: 0, drain: 0 },
    lastSnapshot: null,
    trackingStartedAt: null,
  });
  // Live count updated on every location event so Geopoints doesn't wait for the poll
  const [realtimeCount, setRealtimeCount] = useState(0);

  const initialY = SCREEN_HEIGHT - PANEL_ESTIMATED_HEIGHT - PILL_INITIAL_BOTTOM_MARGIN;
  const pan = useRef(new Animated.ValueXY({ x: 8, y: initialY })).current;
  const lastPos = useRef({ x: 8, y: initialY });
  const panelHeight = useRef(0);

  const pillPanResponder = useRef(
    makePanResponder(pan, lastPos, PILL_SIZE, PILL_SIZE, () => {
      const expandedHeight = panelHeight.current > 0 ? panelHeight.current : PANEL_ESTIMATED_HEIGHT;
      const clamped = {
        x: Math.min(lastPos.current.x, SCREEN_WIDTH - PANEL_WIDTH),
        y: Math.min(lastPos.current.y, SCREEN_HEIGHT - expandedHeight - PANEL_BOTTOM_MARGIN),
      };
      lastPos.current = clamped;
      pan.setValue(clamped);
      setMinimized(false);
    }),
  ).current;

  const headerPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4,
      onPanResponderGrant: () => {
        pan.setOffset({ x: lastPos.current.x, y: lastPos.current.y });
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
      onPanResponderRelease: (_, g) => {
        pan.flattenOffset();
        const newX = Math.max(0, Math.min(lastPos.current.x + g.dx, SCREEN_WIDTH - PANEL_WIDTH));
        const newY = Math.max(0, Math.min(lastPos.current.y + g.dy, SCREEN_HEIGHT - panelHeight.current));
        lastPos.current = { x: newX, y: newY };
        pan.setValue({ x: newX, y: newY });
      },
    }),
  ).current;

  const refresh = useCallback(async () => {
    try {
      const data = await RNGeoService.getBatteryInfo();
      setInfo(data);
      // Persist snapshot and reload accumulated so totals stay up to date
      await GeoSessionStore.saveSnapshot(data);
      const store = await GeoSessionStore.load();
      setStoreData(store);
    } catch (_) {}
  }, []);

  const handleReset = useCallback(async () => {
    await GeoSessionStore.clear();
    setStoreData({ accumulated: { updateCount: 0, elapsedSeconds: 0, gpsActiveSeconds: 0, drain: 0 }, lastSnapshot: null, trackingStartedAt: null });
    setRealtimeCount(0);
  }, []);

  useEffect(() => {
    // Load accumulated history on mount
    GeoSessionStore.load().then(setStoreData).catch(() => {});
    refresh();
    const id = setInterval(refresh, pollInterval);

    // Real-time Geopoints counter — increments on every location event without waiting for the poll
    const locationSub = RNGeoService.onLocation(() => {
      setRealtimeCount(c => c + 1);
    });

    // Save snapshot when app is sent to background so stats survive unexpected kills
    const appStateSub = AppState.addEventListener('change', status => {
      if (status === 'background' || status === 'inactive') {
        RNGeoService.getBatteryInfo()
          .then(GeoSessionStore.saveSnapshot)
          .catch(() => {});
      }
    });

    return () => {
      clearInterval(id);
      locationSub.remove();
      appStateSub.remove();
    };
  }, [refresh, pollInterval]);

  // ── Minimized pill ──
  if (minimized) {
    return (
      <Animated.View
        style={[styles.pill, { transform: pan.getTranslateTransform() }]}
        {...pillPanResponder.panHandlers}
      >
        <Text style={styles.pillText}>📍</Text>
      </Animated.View>
    );
  }

  // Safely normalise — native side returns undefined for new fields until rebuilt
  const sessionElapsed   = info?.trackingElapsedSeconds ?? 0;
  const sessionGpsActive = info?.gpsActiveSeconds       ?? 0;
  const sessionDrain     = info?.drainSinceStart        ?? 0;
  const level            = info?.level                  ?? -1;

  // Use the higher of the native poll count vs the live subscription count
  // so we never show a number lower than what the native side knows about
  const sessionUpdates = Math.max(info?.updateCount ?? 0, realtimeCount);

  // Combine current session with accumulated history from previous sessions
  const acc: AccumulatedStats = storeData.accumulated;
  const elapsed   = acc.elapsedSeconds   + sessionElapsed;
  const updates   = acc.updateCount      + sessionUpdates;
  const gpsActive = acc.gpsActiveSeconds + sessionGpsActive;
  const drain     = acc.drain            + sessionDrain;
  const upm       = elapsed > 0 ? updates / (elapsed / 60)   : 0;
  const drainRate = elapsed > 0 ? drain   / (elapsed / 3600) : 0;

  const safeInfo = info
    ? { ...info, trackingElapsedSeconds: elapsed, updateCount: updates,
        updatesPerMinute: upm, gpsActiveSeconds: gpsActive,
        drainRatePerHour: drainRate }
    : null;

  const suggestions = safeInfo ? getSuggestions(safeInfo) : [];
  const startedAt = formatStartedAt(storeData.trackingStartedAt);

  // ── Expanded panel ──
  return (
    <Animated.View
      style={[styles.container, { transform: pan.getTranslateTransform() }]}
      onLayout={e => { panelHeight.current = e.nativeEvent.layout.height; }}
    >
      {/* Drag header */}
      <View style={styles.header} {...headerPanResponder.panHandlers}>
        <View style={styles.dragPill} />
        <View style={styles.titleRow}>
          <Text style={styles.title}>📍 GeoService Debug</Text>
          <TouchableOpacity onPress={() => setMinimized(true)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.minimizeBtn}>⊖</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.dragHint}>⠿ hold & drag to move</Text>
      </View>

      <View style={styles.body}>
        {info ? (
          <>
            {/* ── Metrics grid ── */}
            <View style={styles.grid}>
              <MetricBox
                label="Started"
                value={startedAt}
                desc="first session began" />
              <MetricBox
                label="Tracking for"
                value={elapsed > 0 ? formatElapsed(elapsed) : '—'}
                desc="cumulative duration" />
              <MetricBox
                label="Geopoints"
                value={`${updates}`}
                desc="total locations received" />
              <MetricBox
                label="Updates/min"
                value={upm > 0 ? upm.toFixed(1) : '—'}
                desc="higher = more battery" />
              <MetricBox
                label="GPS active"
                value={elapsed > 0 ? formatGpsPercent(gpsActive, elapsed) : '—'}
                desc="lower = adaptive saving" />
              <MetricBox
                label="Battery now"
                value={formatBattery(level)}
                desc={info.isCharging ? '⚡ charging' : 'not charging'} />
              <MetricBox
                label="Drained"
                value={level < 0 ? 'N/A' : `${drain.toFixed(2)}%`}
                desc="since tracking started" />
              <MetricBox
                label="Drain rate"
                value={drainRate > 0 ? `${drainRate.toFixed(1)}%/hr` : '—'}
                desc="whole device, not just GPS" />
            </View>

            {/* ── Suggestions ── */}
            <View style={styles.divider} />
            <Text style={styles.sectionLabel}>SUGGESTIONS</Text>
            {suggestions.map((s, i) => (
              <View key={i} style={styles.suggestion}>
                <Text style={styles.suggestionEmoji}>{s.emoji}</Text>
                <Text style={[styles.suggestionText, { color: s.color }]}>{s.text}</Text>
              </View>
            ))}
          </>
        ) : (
          <Text style={styles.label}>Waiting for data…</Text>
        )}

        {/* ── Reset button ── */}
        <View style={styles.resetRow}>
          <TouchableOpacity onPress={handleReset} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.resetBtn}>↺ Reset stats</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Animated.View>
  );
};

// ─── MetricBox sub-component ─────────────────────────────────────────────────

const MetricBox: React.FC<{ label: string; value: string; desc?: string }> = ({ label, value, desc }) => (
  <View style={styles.metricBox}>
    <Text style={styles.metricValue}>{value}</Text>
    <Text style={styles.metricLabel}>{label}</Text>
    {desc && <Text style={styles.metricSub}>{desc}</Text>}
  </View>
);

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    width: PANEL_WIDTH,
    backgroundColor: 'rgba(20,20,20,0.92)',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  header: {
    paddingTop: 6,
    paddingBottom: 8,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center',
  },
  dragPill: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.5)',
    marginBottom: 8,
  },
  titleRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', width: '100%',
  },
  title: { color: '#fff', fontWeight: 'bold', fontSize: 12 },
  minimizeBtn: { color: '#aaa', fontSize: 18 },
  dragHint: { color: 'rgba(255,255,255,0.35)', fontSize: 9, marginTop: 4 },
  body: { padding: 12 },
  label: { color: '#ddd', fontSize: 12 },
  // Metrics grid
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  metricBox: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 8, padding: 8,
    minWidth: '30%', flex: 1,
    alignItems: 'center',
  },
  metricValue: { color: '#fff', fontWeight: 'bold', fontSize: 15, textAlign: 'center' },
  metricLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 9, marginTop: 2, textAlign: 'center' },
  metricSub: { color: 'rgba(255,255,255,0.3)', fontSize: 8, textAlign: 'center' },
  // Suggestions
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.1)', marginBottom: 8 },
  sectionLabel: { color: 'rgba(255,255,255,0.35)', fontSize: 9, letterSpacing: 1, marginBottom: 6 },
  suggestion: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 5, gap: 6 },
  suggestionEmoji: { fontSize: 12, lineHeight: 16 },
  suggestionText: { fontSize: 11, lineHeight: 16, flex: 1 },
  // Reset
  resetRow: { alignItems: 'flex-end', marginTop: 10 },
  resetBtn: { color: 'rgba(255,255,255,0.45)', fontSize: 13, paddingVertical: 6, paddingHorizontal: 10 },
  // Minimized pill
  pill: {
    position: 'absolute',
    width: PILL_SIZE, height: PILL_SIZE, borderRadius: PILL_SIZE / 2,
    backgroundColor: 'rgba(20,20,20,0.92)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  pillText: { fontSize: 24, textAlign: 'center' },
});
