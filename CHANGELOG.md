# Changelog

All notable changes to `@tsachit/react-native-geo-service` are documented here.

---

## [1.0.5] — 2026-04-05

### Fixed
- **"↺ Reset stats" now correctly resets Geopoints to zero** — previously the native `updateCount` from the last poll would persist through `Math.max()` and immediately override the reset. Fixed by recording a `countBaseline` at reset time and subtracting it from the native count, so both the live counter and the polled count start from 0 after a reset.

---

## [1.0.4] — 2026-04-05

### Added
- `GeoSessionStore` — new JS module that persists debug panel metrics to `AsyncStorage` across app sessions. Detects session boundaries via `batteryLevelAtStart` so previous sessions are archived without double-counting when the Android foreground service keeps running after app reopen. Optional peer dependency on `@react-native-async-storage/async-storage` (silently skipped if not installed).
- Debug panel now shows **cumulative totals** across all sessions: Geopoints, Tracking for, GPS active, Drained, and Drain rate are all accumulated rather than resetting on each app open.
- **"Started"** metric in the debug panel — local date/time of the very first tracking session, persisted in `GeoSessionStore` and never overwritten until the user resets.
- **"↺ Reset stats"** button at the bottom right of the debug panel — clears all accumulated data and the start timestamp so the user can re-measure from scratch.
- `GeoSessionStore` exported from the package for apps that register their headless task via `AppRegistry` directly.
- `AppState` listener in `GeoDebugPanel` — saves a snapshot to `GeoSessionStore` when the app goes to background, so stats survive unexpected kills.

### Changed
- `registerHeadlessTask()` now wraps the user's handler to automatically call `GeoSessionStore.onHeadlessLocation()` on each headless location event — Geopoints counter stays accurate while the app is killed with no extra code required in the host app.
- Recommended headless task registration updated from `AppRegistry.registerHeadlessTask()` to `RNGSAppRegistry.registerHeadlessTask()` (package re-export) — the package alias `RNGSAppRegistry` makes the AppRegistry intent explicit.
- **Geopoints now updates in real time** — `GeoDebugPanel` subscribes to `onLocation` internally and increments the counter immediately on every location event rather than waiting for the next poll. All other metrics (battery, drain rate, GPS active time) continue to refresh on the poll interval.
- Debug panel initial position raised — pill starts higher above the tab bar (`PILL_INITIAL_BOTTOM_MARGIN = 120`) so it does not overlap navigation controls.
- Panel expansion from pill now uses a safe estimated height fallback — expanded panel no longer clips below the screen edge on first open before `onLayout` has fired.
- README: headless task setup updated to use `RNGSAppRegistry.registerHeadlessTask()`; GeoSessionStore section added; metrics table updated with Started row and cumulative descriptions; real-time Geopoints behaviour noted.

### Fixed
- Location permission re-initialisation on app return from Settings — if the user grants permission in iOS/Android Settings and returns to the app, tracking now starts automatically without requiring a full app restart.
- Tracking now stops automatically when location permission is revoked from Settings — `GeoDebugOverlay` hides within 3 seconds.
- `configure()` is always called on app open even if `isTracking()` returns `true` — this ensures `_debugMode` is set so `GeoDebugOverlay` can show the panel when the Android foreground service was already running from a previous session.

---

## [1.0.3] — 2026-04-04

### Changed
- `Geopoints` replaces `Updates` as the metric label for total locations received in the debug panel
- Metric description updated from `"total location received"` to `"total locations received"`
- Removed `debug-panel` entry point and `react-native-root-siblings` dependency — incompatible with React Native New Architecture (Bridgeless mode)
- Debug overlay is now a standard React component: add `<GeoDebugOverlay />` once to your component tree and it self-manages visibility based on `debug: true` and tracking state; no import of `@tsachit/react-native-geo-service/debug-panel` required
- README updated: debug section rewritten to reflect `<GeoDebugOverlay />` component approach for both iOS and Android

### Fixed
- Removed `react-native-root-siblings` + `AppRegistry.setWrapperComponentProvider` approach that caused a `PlatformConstants not found` crash on New Architecture (Bridgeless mode) apps at startup

---

## [1.0.2] — 2026-04-04

### Added

#### Debug panel (auto-mounting overlay)
- New `debug-panel` package entry point — add `import '@tsachit/react-native-geo-service/debug-panel'` once to `index.js` and the panel mounts itself automatically whenever `configure({ debug: true })` + `start()` are called. No component needed anywhere in the app tree.
- `GeoDebugPanel` component — draggable, minimizable floating overlay showing live tracking metrics and battery saving suggestions. Starts minimized as a 📍 pill; tap to expand.
- `GeoDebugOverlay` component — self-managing wrapper that shows `GeoDebugPanel` only while tracking is active. Can be used manually as an alternative to the auto-mount approach.
- `autoDebug.ts` — internal module that uses `react-native-root-siblings` to mount/unmount the overlay imperatively from `configure()` and `stop()`.
- `setup.ts` — internal module called by `debug-panel` entry point; registers `RootSiblingParent` via `AppRegistry.setWrapperComponentProvider` before the app root mounts.

#### Battery and session metrics
- `getBatteryInfo()` — new API returning a `BatteryInfo` object with:
  - `level` — current battery percentage (0–100)
  - `isCharging` — whether the device is currently charging
  - `levelAtStart` — battery level when `start()` was called
  - `drainSinceStart` — total battery percentage dropped since tracking started
  - `updateCount` — total number of location received this session
  - `trackingElapsedSeconds` — seconds since `start()` was called
  - `gpsActiveSeconds` — seconds the GPS chip was actively running (vs low-power idle)
  - `updatesPerMinute` — rolling average of total location per minute
  - `drainRatePerHour` — projected battery drain rate in %/hr
- iOS native: `batteryLevelAtStart`, `updateCount`, `trackingStartTime`, `gpsActiveSeconds`, and `gpsActiveStart` properties added to `RNGeoService.m`; GPS active time accumulated when adaptive accuracy transitions between idle and active states
- Android native: `batteryLevelAtStart`, `updateCount`, `trackingStartTimeMs`, `gpsAccumulatedMs`, and `gpsActiveWindowStartMs` added to `LocationService.kt` companion object; `currentGpsActiveMs` computed property accounts for in-progress active window

#### Smart suggestions in debug panel
- Update frequency warnings: 🔴 > 20/min, ⚠️ 8–20/min, ✅ within range
- GPS active time warnings: 🔴 > 80% of session, ⚠️ > 50%, ✅ adaptive accuracy effective
- Drain rate warnings: 🔴 > 8%/hr, ⚠️ 4–8%/hr, ✅ efficient

#### Debug mode improvements
- Android: foreground notification title prefixed with `[DEBUG]` when `debug: true` so the foreground service is visually distinguishable during development
- iOS: `showsBackgroundLocationIndicator` forced to `YES` when `debug: true`

#### Other
- `setLocationIndicator(show: boolean)` — new API to toggle the iOS status bar location arrow at runtime; no-op on Android
- `react-native-root-siblings` added as a runtime dependency (used by the auto-mount overlay)
- `WatchdogWorker` (Android) improvements for reliability when the app is killed — monitors service health and restarts it if terminated unexpectedly by the OS
- Headless task handling improved for killed-app scenarios on Android
- TypeScript: added `"jsx": "react-native"` to `tsconfig.json` to support `.tsx` source files
- README fully rewritten: installation steps, permission flow, full API and type reference, debug panel setup and usage, headless mode explanation, battery saving tips

### Changed
- `BatteryInfo` type extended from 4 fields (`level`, `isCharging`, `levelAtStart`, `drainSinceStart`) to 9 fields (added `updateCount`, `trackingElapsedSeconds`, `gpsActiveSeconds`, `updatesPerMinute`, `drainRatePerHour`)

---

## [1.0.1] — 2026-03-27

### Added
- `SECURITY.md` — security policy and vulnerability disclosure process
- npm provenance workflow (`.github/workflows`) — published packages are now signed with build provenance via GitHub Actions

### Changed
- `package.json` metadata: added `keywords`, `repository`, `bugs`, and `homepage` fields for better npm discoverability

---

## [1.0.0] — 2026-03-27

Initial release.

### Features
- Background location tracking on iOS (`CLLocationManager`) and Android (`FusedLocationProviderClient`)
- Continues tracking when the app is backgrounded or killed
- **Adaptive accuracy** — GPS turns off automatically when the device is stationary and resumes the moment movement is detected, controlled by `idleSpeedThreshold` and `idleSampleCount`
- **Headless mode** (Android) — location events delivered via HeadlessJS when the React context is not active; register a handler with `registerHeadlessTask()` or `AppRegistry.registerHeadlessTask('GeoServiceHeadlessTask', ...)`
- **Boot receiver** (Android) — resumes tracking after device reboot when `restartOnBoot: true`
- **Watchdog worker** (Android) — WorkManager task that monitors the foreground service and restarts it on OEM devices with aggressive battery optimisation (Xiaomi, Samsung, Huawei)
- **iOS relaunch support** — detects `UIApplicationLaunchOptionsLocationKey`, restores config from `NSUserDefaults`, and resumes tracking before the JS bridge has fully mounted; buffered events flushed once `onLocation` is subscribed

### API
- `configure(config)` — apply configuration before `start()`; safe to call multiple times
- `start()` — begin background location tracking
- `stop()` — stop tracking and remove the foreground service / stop `CLLocationManager`
- `isTracking()` — returns whether tracking is currently active
- `getCurrentLocation()` — one-time location fetch
- `onLocation(callback)` — subscribe to location updates; returns a `GeoSubscription`
- `onError(callback)` — subscribe to location errors; returns a `GeoSubscription`
- `registerHeadlessTask(handler)` — register an Android headless task handler
- `setLocationIndicator(show)` — show/hide iOS status bar location arrow at runtime

### Configuration options
`minDistanceMeters`, `accuracy`, `stopOnAppClose`, `restartOnBoot`, `updateIntervalMs`, `minUpdateIntervalMs`, `serviceTitle`, `serviceBody`, `backgroundTaskName`, `motionActivity`, `autoPauseUpdates`, `showBackgroundIndicator`, `coarseTracking`, `adaptiveAccuracy`, `idleSpeedThreshold`, `idleSampleCount`, `debug`

### Types
`Location`, `GeoServiceConfig`, `GeoSubscription`
