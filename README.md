# @tsachit/react-native-geo-service

Battery-efficient background geolocation for React Native — a lightweight, free alternative to commercial packages.

- Tracks location as the user moves and fires a JS listener
- Keeps tracking when the app is backgrounded or killed (headless mode)
- Uses `FusedLocationProviderClient` on Android and `CLLocationManager` on iOS
- **Adaptive accuracy** — GPS turns off automatically when the device is idle and wakes the moment movement is detected
- **Debug panel** — draggable floating overlay showing live metrics, GPS activity, and battery saving suggestions; add `<GeoDebugOverlay />` once and it self-manages based on `debug: true` and tracking state
- Fully configurable from JavaScript — no API keys, no license required

---

## Installation

```bash
yarn add @tsachit/react-native-geo-service
# or
npm install @tsachit/react-native-geo-service
```

### iOS

```bash
cd ios && pod install
```

Add to your `Info.plist`:

```xml
<!-- Required — explain why you need location -->
<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>We use your location to track your route in the background.</string>

<key>NSLocationWhenInUseUsageDescription</key>
<string>We use your location to show your position on the map.</string>

<!-- Required for background location updates -->
<key>UIBackgroundModes</key>
<array>
    <string>location</string>
</array>
```

#### iOS — AppDelegate (headless relaunch)

When iOS relaunches a terminated app for a location event, add this so tracking resumes automatically:

```objc
// AppDelegate.m
- (BOOL)application:(UIApplication *)application
    didFinishLaunchingWithOptions:(NSDictionary *)launchOptions {

    if (launchOptions[UIApplicationLaunchOptionsLocationKey]) {
        // RNGeoService detects this automatically and resumes tracking
        // from the config it persisted to NSUserDefaults before termination.
    }

    // ... rest of your setup
}
```

---

### Android

#### 1. Register the package

**`android/app/src/main/java/.../MainApplication.kt`**:

```kotlin
import com.geoservice.GeoServicePackage

override fun getPackages(): List<ReactPackage> =
    PackageList(this).packages.apply {
        add(GeoServicePackage())
    }
```

#### 2. Register the HeadlessJS task

In your app's **`index.js`** (top level, outside any component):

```js
import { AppRegistry } from 'react-native';
import App from './App';

AppRegistry.registerComponent('YourApp', () => App);

// Handles location events when the React context is not active.
// Runs even when the app is killed (foreground service must be running).
AppRegistry.registerHeadlessTask('GeoServiceHeadlessTask', () => async (location) => {
  console.log('[Background] Location:', location);
  // Send to your server using a pre-stored auth token (e.g. SecureStore/Keychain).
  // Do not rely on in-memory state — this JS context is isolated.
});
```

#### 3. Add permissions to `AndroidManifest.xml`

```xml
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<!-- Android 10+ — required for background access -->
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
```

---

## Usage

### Request permissions first

Always request OS permission before calling `start()`. We recommend [`react-native-permissions`](https://github.com/zoontek/react-native-permissions):

```ts
import { request, PERMISSIONS, RESULTS, Platform } from 'react-native-permissions';

async function requestLocationPermissions(): Promise<boolean> {
  if (Platform.OS === 'ios') {
    const result = await request(PERMISSIONS.IOS.LOCATION_ALWAYS);
    return result === RESULTS.GRANTED;
  }

  const fine = await request(PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION);
  if (fine !== RESULTS.GRANTED) return false;

  if (Number(Platform.Version) >= 29) {
    const bg = await request(PERMISSIONS.ANDROID.ACCESS_BACKGROUND_LOCATION);
    return bg === RESULTS.GRANTED;
  }
  return true;
}
```

### Start tracking

```ts
import RNGeoService from '@tsachit/react-native-geo-service';

// 1. Request OS permission
const granted = await requestLocationPermissions();
if (!granted) return;

// 2. Configure (call once before start, safe to call again to update)
await RNGeoService.configure({
  minDistanceMeters: 10,
  accuracy: 'balanced',
  stopOnAppClose: false,
  restartOnBoot: true,
  serviceTitle: 'Tracking active',
  serviceBody: 'Your route is being recorded.',
});

// 3. Start tracking
await RNGeoService.start();

// 4. Listen for updates
const subscription = RNGeoService.onLocation((location) => {
  console.log(location.latitude, location.longitude);
  console.log('Idle (GPS off):', location.isStationary);
});

// 5. Listen for errors
const errorSub = RNGeoService.onError((error) => {
  console.error('Location error:', error.code, error.message);
});

// 6. Stop
await RNGeoService.stop();

// 7. Clean up listeners
subscription.remove();
errorSub.remove();
```

### One-time location

```ts
const location = await RNGeoService.getCurrentLocation();
```

### Check if tracking

```ts
const tracking = await RNGeoService.isTracking();
```

### Register headless task via the module

Alternatively to `AppRegistry.registerHeadlessTask`, you can use the helper:

```ts
RNGeoService.registerHeadlessTask(async (location) => {
  await sendToServer(location);
});
```

---

## Configuration reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `minDistanceMeters` | `number` | `10` | Minimum metres of movement before a location update fires |
| `accuracy` | `'navigation' \| 'high' \| 'balanced' \| 'low'` | `'balanced'` | Location accuracy — higher accuracy uses more battery |
| `stopOnAppClose` | `boolean` | `false` | Stop tracking when the app is killed |
| `restartOnBoot` | `boolean` | `false` | Resume tracking after device reboot *(Android only)* |
| `updateIntervalMs` | `number` | `5000` | Target ms between updates *(Android only)* |
| `minUpdateIntervalMs` | `number` | `2000` | Minimum ms between updates *(Android only)* |
| `serviceTitle` | `string` | `'Location Tracking'` | Foreground service notification title *(Android only)* |
| `serviceBody` | `string` | `'Your location is being tracked...'` | Foreground service notification body *(Android only)* |
| `backgroundTaskName` | `string` | `'GeoServiceHeadlessTask'` | HeadlessJS task name *(Android only)* |
| `motionActivity` | `'other' \| 'automotiveNavigation' \| 'fitness' \| 'otherNavigation' \| 'airborne'` | `'other'` | Activity hint for iOS power optimisations *(iOS only)* |
| `autoPauseUpdates` | `boolean` | `false` | Let iOS pause updates when no movement detected *(iOS only)* |
| `showBackgroundIndicator` | `boolean` | `false` | Show blue location bar in status bar while tracking *(iOS only)* |
| `coarseTracking` | `boolean` | `false` | Use significant-change monitoring only — very battery-efficient, wakes terminated app *(iOS only)* |
| `adaptiveAccuracy` | `boolean` | `true` | Auto-drop to low-power when idle, restore on movement (biggest battery saver) |
| `idleSpeedThreshold` | `number` | `0.5` | Speed in m/s below which a reading counts as idle |
| `idleSampleCount` | `number` | `3` | Consecutive idle readings required before entering low-power mode |
| `debug` | `boolean` | `false` | Enable verbose native logging + debug notification on Android + status bar indicator on iOS |

---

## API reference

### `configure(config)`
Apply configuration. Safe to call multiple times — subsequent calls update the running config.

### `start()`
Start background location tracking. Always call `requestLocationPermissions()` before this.

### `stop()`
Stop tracking and remove the foreground service (Android) / stop CLLocationManager (iOS).

### `isTracking(): Promise<boolean>`
Returns whether tracking is currently active.

### `getCurrentLocation(): Promise<Location>`
One-time location fetch from the last known position.

### `onLocation(callback): GeoSubscription`
Subscribe to location updates. Call `.remove()` on the returned subscription to unsubscribe.

### `onError(callback): GeoSubscription`
Subscribe to location errors (e.g. permission revoked mid-session).

### `registerHeadlessTask(handler)` *(Android only)*
Register a function to handle location events when the app is not in the foreground.

### `getBatteryInfo(): Promise<BatteryInfo>`
Returns battery and session tracking metrics. See [Debug mode](#debug-mode) below.

### `setLocationIndicator(show: boolean)` *(iOS only)*
Show or hide the blue location indicator in the status bar at runtime. No-op on Android.

---

## Type reference

### `Location`

```ts
interface Location {
  latitude: number;
  longitude: number;
  accuracy: number;         // horizontal accuracy in metres
  altitude: number;
  altitudeAccuracy: number; // vertical accuracy in metres (iOS only, -1 on Android)
  speed: number;            // m/s, -1 if unavailable
  bearing: number;          // degrees 0–360, -1 if unavailable
  timestamp: number;        // Unix ms
  isFromMockProvider?: boolean; // Android only
  isStationary?: boolean;   // true when adaptive accuracy has turned GPS off
}
```

### `BatteryInfo`

```ts
interface BatteryInfo {
  level: number;                  // current battery level 0–100
  isCharging: boolean;
  levelAtStart: number;           // battery level when start() was called
  drainSinceStart: number;        // total % dropped since start() (whole device)

  updateCount: number;            // total location received this session
  trackingElapsedSeconds: number; // seconds since start() was called
  gpsActiveSeconds: number;       // seconds the GPS chip was actively running
  updatesPerMinute: number;       // average total location per minute
  drainRatePerHour: number;       // battery drain rate in %/hr (whole device)
}
```

### `GeoServiceConfig`
See [Configuration reference](#configuration-reference) above.

### `GeoSubscription`

```ts
interface GeoSubscription {
  remove(): void;
}
```

---

## Debug mode

Set `debug: true` in `configure()` to enable debug features:

- **iOS** — forces the blue location arrow in the status bar while tracking is active
- **Android** — notification title changes to `[DEBUG] <title>` so you can confirm the foreground service is running
- **Both** — verbose native logging via `console.log` / `Logcat`
- **Both** — a floating debug panel shows live metrics and battery saving suggestions; add `<GeoDebugOverlay />` once to your component tree and it self-manages visibility

### Setup

Add `<GeoDebugOverlay />` once to your component tree, co-located with wherever you call `RNGeoService.start()`. It self-manages visibility — it only shows when `debug: true` is set in `configure()` and tracking is active.

```tsx
import { GeoDebugOverlay } from '@tsachit/react-native-geo-service';

// Render it alongside your navigation root or wherever tracking is used:
return (
  <>
    <YourNavigator />
    <GeoDebugOverlay />
  </>
);
```

Then set `debug: true` in your config:

```ts
await RNGeoService.configure({ debug: true, ... });
await RNGeoService.start(); // panel becomes visible automatically

await RNGeoService.stop();  // panel hides automatically
```

> **Note:** `GeoDebugOverlay` is a standard React component — it renders nothing in production when `debug: false`. It is safe to leave in the tree at all times.

| Minimized | Opened |
|--------|-------------|
| <img width="349" height="261" alt="image" src="https://github.com/user-attachments/assets/a6b43b93-7a93-485d-a68d-f4e4fe658011" /> | <img width="363" height="348" alt="image" src="https://github.com/user-attachments/assets/9c02ebc9-28f2-4983-982b-810c98a32dfe" /> |

### Debug panel behaviour

The panel is a **draggable, minimizable floating overlay** that starts minimized:

- **Tap the 📍 circle** to expand
- **Drag** by holding the striped header bar
- **Minimize** with the ⊖ button — collapses back to the 📍 circle

**Metrics shown:**

| Metric | Description |
|--------|-------------|
| Tracking for | How long the current session has been running |
| Geopoints | Total locations received |
| Updates/min | Average frequency of location updates |
| GPS active | % of session time the GPS chip was on vs idle |
| Battery now | Current device battery level |
| Drained | Total device battery % dropped since `start()` |
| Drain rate | Battery consumed per hour (total device, not just location) |

**Smart suggestions** are shown automatically:

- 🔴 Updates/min > 20 → increase `minDistanceMeters` or `updateIntervalMs`
- ⚠️ Updates/min 8–20 → consider reducing update frequency
- 🔴 GPS on > 80% of time → enable `adaptiveAccuracy` or use `coarseTracking`
- 🔴 Drain rate > 8%/hr → try `'balanced'` accuracy or longer update intervals
- ✅ All metrics in range → confirms settings are efficient

> **Note:** Battery drain is measured at the whole-device level since iOS and Android do not expose per-app battery consumption via public APIs. Use GPS active % and updates/min as the primary indicators of how much this package contributes.

### Manual panel (optional)

For a custom poll interval or always-visible panel, use `GeoDebugPanel` directly:

```tsx
import { GeoDebugPanel } from '@tsachit/react-native-geo-service';

<GeoDebugPanel pollInterval={15000} />
```

---

## Headless mode explained

### Android
When the app is removed from recents, the foreground service keeps running. When a location arrives and the React JS context is inactive, the library calls `AppRegistry.startHeadlessTask` to spin up a lightweight JS runtime and invoke your registered handler.

A `WatchdogWorker` (WorkManager, 15-min interval) monitors whether the service is still alive. On OEM devices with aggressive battery optimisation (Xiaomi, Samsung, Huawei), it restarts the service if it was killed unexpectedly.

A `BootReceiver` restarts the service after device reboot if `restartOnBoot: true`.

### iOS
When the app is terminated, iOS relaunches it silently when:
1. `UIBackgroundModes` contains `location`, **and**
2. `startMonitoringSignificantLocationChanges` is active (always on when tracking), **or**
3. Standard location updates are running with the _Always_ permission

Upon relaunch, the module detects `UIApplicationLaunchOptionsLocationKey`, restores config from `NSUserDefaults`, and resumes tracking before the JS bridge has fully mounted. Any location events that arrive before JS listeners attach are buffered and flushed once `onLocation` is subscribed.

---

## Battery saving tips

- Use `accuracy: 'balanced'` unless you need GPS precision — cell/WiFi positioning uses far less power
- Increase `minDistanceMeters` to the minimum useful for your use case — fewer wakes = longer battery
- Leave `adaptiveAccuracy: true` (default) — this is the single biggest saving; GPS turns off completely when parked
- On iOS, use `coarseTracking: true` if ~500m granularity is acceptable — uses cell towers only
- On Android, increase `updateIntervalMs` (e.g. `10000`) to give FusedLocationProvider room to batch fixes
- Set `motionActivity: 'automotiveNavigation'` or `'fitness'` so iOS applies activity-specific optimisations
- Use the debug overlay (`debug: true`) to measure real-world impact and act on its suggestions

---

## License

MIT
