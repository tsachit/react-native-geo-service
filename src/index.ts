import {
  NativeModules,
  NativeEventEmitter,
  Platform,
  AppRegistry,
} from 'react-native';
import {
  GeoServiceConfig,
  GeoSubscription,
  Location,
  LocationCallback,
  ErrorCallback,
  BatteryInfo,
} from './types';

export * from './types';

// The native bridge module registered as "RNGeoService" on both platforms
const nativeModule = NativeModules.RNGeoService;

if (!nativeModule) {
  throw new Error(
    '[react-native-geo-service] Native module not found. ' +
      'Make sure you have linked the native module correctly. ' +
      'For iOS run `pod install`, for Android rebuild the project.'
  );
}

const eventEmitter = new NativeEventEmitter(nativeModule);

const DEFAULT_CONFIG: GeoServiceConfig = {
  minDistanceMeters: 10,
  accuracy: 'balanced',
  stopOnAppClose: false,
  restartOnBoot: false,
  updateIntervalMs: 5000,
  minUpdateIntervalMs: 2000,
  serviceTitle: 'Location Tracking',
  serviceBody: 'Your location is being tracked in the background.',
  backgroundTaskName: 'GeoServiceHeadlessTask',
  motionActivity: 'other',
  autoPauseUpdates: false,
  showBackgroundIndicator: false,
  coarseTracking: false,
  adaptiveAccuracy: true,
  idleSpeedThreshold: 0.5,
  idleSampleCount: 3,
  debug: false,
};

// Tracks the debug flag set via configure() so GeoDebugOverlay can
// read it without the consuming app having to pass it as a prop.
let _debugMode = false;
export function _isDebugMode(): boolean { return _debugMode; }

/**
 * Configure the geo service. Call this before start().
 * Safe to call multiple times; subsequent calls update the config.
 */
async function configure(config: GeoServiceConfig): Promise<void> {
  _debugMode = config.debug ?? false;
  const merged = { ...DEFAULT_CONFIG, ...config };
  return nativeModule.configure(merged);
}

/**
 * Start background location tracking.
 * On Android, this starts a foreground service with a persistent notification.
 * On iOS, this starts standard or significant-change location monitoring.
 */
async function start(): Promise<void> {
  return nativeModule.start();
}

/**
 * Stop background location tracking.
 */
async function stop(): Promise<void> {
  return nativeModule.stop();
}

/**
 * Fetch the current device location as a one-time request.
 */
async function getCurrentLocation(): Promise<Location> {
  return nativeModule.getCurrentLocation();
}

/**
 * Returns whether the geo service is currently tracking.
 */
async function isTracking(): Promise<boolean> {
  return nativeModule.isTracking();
}

/**
 * Subscribe to location updates.
 * Returns a GeoSubscription — call .remove() to unsubscribe.
 *
 * @example
 * const sub = RNGeoService.onLocation((location) => {
 *   console.log(location.latitude, location.longitude);
 * });
 * // Later:
 * sub.remove();
 */
function onLocation(callback: LocationCallback): GeoSubscription {
  return eventEmitter.addListener('onLocation', callback);
}

/**
 * Subscribe to location errors.
 */
function onError(callback: ErrorCallback): GeoSubscription {
  return eventEmitter.addListener('onError', callback);
}

/**
 * Register a headless task handler for Android background processing.
 *
 * When the app is not in the foreground, location updates are delivered via
 * HeadlessJS. Register your handler here OR in your app's index.js using
 * AppRegistry.registerHeadlessTask('GeoServiceHeadlessTask', ...).
 *
 * The handler receives a Location object and should return a Promise.
 *
 * @example
 * // In index.js (outside the App component, at the top level):
 * import { AppRegistry } from 'react-native';
 * AppRegistry.registerHeadlessTask('GeoServiceHeadlessTask', () => async (location) => {
 *   console.log('[Headless] Location:', location);
 *   // Send to your server using a pre-stored auth token (e.g. SecureStore/Keychain).
 *   // Do not rely on in-memory app state — this context is headless and isolated.
 * });
 *
 * @platform android
 */
function registerHeadlessTask(
  handler: (location: Location) => Promise<void>
): void {
  if (Platform.OS !== 'android') return;
  const taskName = DEFAULT_CONFIG.backgroundTaskName!;
  AppRegistry.registerHeadlessTask(taskName, () => handler);
}

/**
 * Returns battery information including current level and drain since tracking started.
 * Only meaningful after start() has been called.
 */
async function getBatteryInfo(): Promise<BatteryInfo> {
  return nativeModule.getBatteryInfo();
}

/**
 * Show or hide the status bar location indicator at runtime (iOS only).
 * On Android this is a no-op — the foreground notification handles visibility.
 */
async function setLocationIndicator(show: boolean): Promise<void> {
  return nativeModule.setLocationIndicator(show);
}

const RNGeoService = {
  configure,
  start,
  stop,
  getCurrentLocation,
  isTracking,
  onLocation,
  onError,
  registerHeadlessTask,
  getBatteryInfo,
  setLocationIndicator,
};

export default RNGeoService;
export { GeoDebugPanel } from './GeoDebugPanel';
export { GeoDebugOverlay } from './GeoDebugOverlay';
