import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  PanResponder,
  Animated,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import RNGeoService from './index';
import type { BatteryInfo } from './types';

interface Props {
  /** Refresh interval in ms. Default: 30000 */
  pollInterval?: number;
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const PANEL_WIDTH = Math.round(SCREEN_WIDTH * 0.95);
const PILL_SIZE = 50;

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

export const GeoDebugPanel: React.FC<Props> = ({ pollInterval = 30_000 }) => {
  const [info, setInfo] = useState<BatteryInfo | null>(null);
  const [minimized, setMinimized] = useState(true);

  const pan = useRef(new Animated.ValueXY({ x: 8, y: SCREEN_HEIGHT - 320 })).current;
  const lastPos = useRef({ x: 8, y: SCREEN_HEIGHT - 320 });
  const panelHeight = useRef(0);

  const pillPanResponder = useRef(
    makePanResponder(pan, lastPos, PILL_SIZE, PILL_SIZE, () => {
      const clamped = {
        x: Math.min(lastPos.current.x, SCREEN_WIDTH - PANEL_WIDTH),
        y: Math.min(lastPos.current.y, SCREEN_HEIGHT - panelHeight.current),
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
    } catch (_) {}
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, pollInterval);
    return () => clearInterval(id);
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
  const elapsed   = info?.trackingElapsedSeconds ?? 0;
  const updates   = info?.updateCount            ?? 0;
  const upm       = info?.updatesPerMinute       ?? 0;
  const gpsActive = info?.gpsActiveSeconds       ?? 0;
  const level     = info?.level                  ?? -1;
  const drain     = info?.drainSinceStart        ?? 0;
  const drainRate = info?.drainRatePerHour       ?? 0;

  const safeInfo = info
    ? { ...info, trackingElapsedSeconds: elapsed, updateCount: updates,
        updatesPerMinute: upm, gpsActiveSeconds: gpsActive,
        drainRatePerHour: drainRate }
    : null;

  const suggestions = safeInfo ? getSuggestions(safeInfo) : [];

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
                label="Tracking for"
                value={elapsed > 0 ? formatElapsed(elapsed) : '—'}
                desc="session duration" />
              <MetricBox
                label="Updates"
                value={`${updates}`}
                desc="location fixes received" />
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
  metricValue: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  metricLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 9, marginTop: 2, textAlign: 'center' },
  metricSub: { color: 'rgba(255,255,255,0.3)', fontSize: 8, textAlign: 'center' },
  // Suggestions
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.1)', marginBottom: 8 },
  sectionLabel: { color: 'rgba(255,255,255,0.35)', fontSize: 9, letterSpacing: 1, marginBottom: 6 },
  suggestion: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 5, gap: 6 },
  suggestionEmoji: { fontSize: 12, lineHeight: 16 },
  suggestionText: { fontSize: 11, lineHeight: 16, flex: 1 },
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
