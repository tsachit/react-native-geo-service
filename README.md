# react-native-geo-service

Battery-efficient background geolocation for React Native.

- Tracks location as the user moves and fires a JS listener
- Keeps tracking in the background and when the app is killed (headless mode)
- Uses `FusedLocationProviderClient` on Android and `CLLocationManager` on iOS for maximum battery savings
- **Adaptive accuracy**: GPS turns off automatically when the device is idle and wakes up the moment movement is detected
- Fully configurable from JavaScript

---

## Installation

```bash
npm install react-native-geo-service
# or
yarn add react-native-geo-service
```

### iOS

```bash
cd ios && pod install
```

Add the following to your `Info.plist`:

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

#### iOS Headless Mode (app terminated)

When the app is terminated, iOS can still wake it up for location events if you use
`coarseTracking: true` (fires when the device moves ~500 m) or standard background
location updates (requires the Always permission).

Add this to your **AppDelegate** so tracking resumes after a background relaunch:

```objc
// AppDelegate.m
- (BOOL)application:(UIApplication *)application
    didFinishLaunchingWithOptions:(NSDictionary *)launchOptions {

    // If the app was relaunched in the background due to a location event,
    // the location manager delegate will resume tracking automatically.
    if (launchOptions[UIApplicationLaunchOptionsLocationKey]) {
        // Optionally restore your RNGeoService.configure() call here.
    }

    // ... rest of your setup
}
```

---

### Android

#### 1. Register the package

**`android/app/src/main/java/.../MainApplication.kt`** (or `.java`):

```kotlin
import com.geoservice.GeoServicePackage

override fun getPackages(): List<ReactPackage> =
    PackageList(this).packages.apply {
        add(GeoServicePackage())
    }
```

#### 2. Register the HeadlessJS task

In your app's **`index.js`** (at the top level, outside any component):

```js
import { AppRegistry } from 'react-native';
import App from './App';

AppRegistry.registerComponent('YourApp', () => App);

// Register the background task for when the app is not in the foreground.
// This runs even when the app is killed (as long as the foreground service is active).
AppRegistry.registerHeadlessTask('GeoServiceHeadlessTask', () => async (location) => {
  console.log('[Background] Location:', location);
  // Send to your server using a pre-stored auth token (e.g. from SecureStore/Keychain).
  // Avoid relying on in-memory app state — the JS context here is headless and isolated.
});
```

#### 3. Add permissions to `AndroidManifest.xml`

The library's manifest already declares the permissions, but your **app's** manifest must
also include them (merging happens at build time):

```xml
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<!-- Android 10+ — required for background access: -->
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
```

#### 4. Request permissions at runtime

On Android 10+ you must request `ACCESS_BACKGROUND_LOCATION` **separately**, after the
user has already granted foreground location. Use
[`react-native-permissions`](https://github.com/zoontek/react-native-permissions) or the
built-in `PermissionsAndroid` API.

```js
import { PermissionsAndroid, Platform } from 'react-native';

async function requestLocationPermissions() {
  if (Platform.OS !== 'android') return;

  await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
  );

  // Android 10+ requires a second, separate request for background
  if (Platform.Version >= 29) {
    await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION
    );
  }
}
```

---

## Usage

```ts
import RNGeoService from 'react-native-geo-service';

// 1. Configure (call once, before start)
await RNGeoService.configure({
  minDistanceMeters: 10,       // fire update every 10 metres of movement
  accuracy: 'balanced',        // balanced accuracy = good battery
  stopOnAppClose: false,       // keep tracking even when app is killed
  restartOnBoot: true,         // restart on device reboot (Android)
  serviceTitle: 'Tracking active',
  serviceBody: 'Your route is being recorded.',
});

// 2. Start tracking
await RNGeoService.start();

// 3. Listen for location updates
const subscription = RNGeoService.onLocation((location) => {
  console.log(location.latitude, location.longitude);
  console.log('GPS idle:', location.isStationary);
});

// 4. Stop tracking
await RNGeoService.stop();

// 5. Remove listener
subscription.remove();
```

### One-time location

```ts
const location = await RNGeoService.getCurrentLocation();
console.log(location.latitude, location.longitude);
```

### Check tracking state

```ts
const tracking = await RNGeoService.isTracking();
```

---

## Configuration reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `minDistanceMeters` | `number` | `10` | Minimum metres of movement before a location update fires |
| `accuracy` | `'navigation' \| 'high' \| 'balanced' \| 'low'` | `'balanced'` | Location accuracy (affects battery) |
| `stopOnAppClose` | `boolean` | `false` | Stop tracking when the app is killed |
| `restartOnBoot` | `boolean` | `false` | Resume tracking after device reboot *(Android only)* |
| `updateIntervalMs` | `number` | `5000` | Target ms between updates *(Android only)* |
| `minUpdateIntervalMs` | `number` | `2000` | Minimum ms between updates *(Android only)* |
| `serviceTitle` | `string` | `'Location Tracking'` | Foreground service notification title *(Android only)* |
| `serviceBody` | `string` | `'Your location is being tracked...'` | Foreground service notification body *(Android only)* |
| `backgroundTaskName` | `string` | `'GeoServiceHeadlessTask'` | HeadlessJS task name *(Android only)* |
| `motionActivity` | `'other' \| 'automotiveNavigation' \| 'fitness' \| 'otherNavigation' \| 'airborne'` | `'other'` | Hints the OS about usage for power optimisation *(iOS only)* |
| `autoPauseUpdates` | `boolean` | `false` | Let iOS pause updates when no movement *(iOS only)* |
| `showBackgroundIndicator` | `boolean` | `false` | Show blue bar in status bar while tracking in background *(iOS only)* |
| `coarseTracking` | `boolean` | `false` | Use significant-change monitoring — very battery-efficient, wakes app when terminated *(iOS only)* |
| `adaptiveAccuracy` | `boolean` | `true` | Auto-drop to low-power when idle, restore on movement |
| `idleSpeedThreshold` | `number` | `0.5` | Speed in m/s below which a reading counts as idle |
| `idleSampleCount` | `number` | `3` | Consecutive idle readings before entering low-power mode |
| `debug` | `boolean` | `false` | Enable verbose native logging |

---

## Battery saving tips

- Set `accuracy: 'balanced'` unless you need GPS precision.
- Set `minDistanceMeters` to the minimum distance useful for your use-case (higher = fewer wakes).
- On iOS, enable `coarseTracking: true` if your app only needs to know when the user
  has moved to a new area (~500 m). This is the most battery-efficient mode.
- On Android, a higher `updateIntervalMs` (e.g. `10000`) with a reasonable `minUpdateIntervalMs`
  gives FusedLocationProvider more room to batch updates and use passive fixes from other apps.
- Set `motionActivity: 'automotiveNavigation'` or `'fitness'` so iOS can apply activity-specific
  power optimisations.
- Leave `adaptiveAccuracy: true` (the default) — this is the single biggest battery saving.
  GPS turns off completely when parked and wakes up as soon as the device moves.

---

## Headless mode explained

### Android
When the app is removed from recents (but not force-stopped), the foreground service keeps
running. When a location update arrives and the React JS context is not active, the library
calls `AppRegistry.startHeadlessTask` to spin up a lightweight JS runtime and invoke your
registered `backgroundTaskName` handler.

### iOS
When the app is terminated, iOS can relaunch it silently in the background if:
1. You have the `location` background mode in `UIBackgroundModes`.
2. You use `startMonitoringSignificantLocationChanges` (`coarseTracking: true`), **or**
3. You have the _Always_ location permission and standard updates are running.

Upon relaunch, `didFinishLaunchingWithOptions` is called with
`UIApplicationLaunchOptionsLocationKey`, and the `CLLocationManager` delegate resumes delivering
updates. The JS bridge boots and your `onLocation` listener fires normally.

---

## License

MIT
