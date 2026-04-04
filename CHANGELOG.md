# Changelog

All notable changes to `@tsachit/react-native-geo-service` are documented here.

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
  - `updateCount` — number of location fixes received this session
  - `trackingElapsedSeconds` — seconds since `start()` was called
  - `gpsActiveSeconds` — seconds the GPS chip was actively running (vs low-power idle)
  - `updatesPerMinute` — rolling average of location fixes per minute
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
