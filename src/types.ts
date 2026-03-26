export interface GeoServiceConfig {
  /**
   * Minimum distance in meters the device must move before a location update is fired.
   * Higher values = fewer updates = better battery life.
   * Default: 10
   */
  minDistanceMeters?: number;

  /**
   * Location accuracy mode.
   * - 'navigation': GPS-level accuracy (most battery)
   * - 'high': High accuracy
   * - 'balanced': City-block accuracy, uses cell/WiFi (recommended for most apps)
   * - 'low': Approximate location, very low battery usage
   * Default: 'balanced'
   */
  accuracy?: 'navigation' | 'high' | 'balanced' | 'low';

  /**
   * Stop location tracking when the app is closed by the user.
   * Set to false for always-on headless tracking.
   * Default: false
   */
  stopOnAppClose?: boolean;

  /**
   * Automatically restart tracking on device reboot (Android only).
   * Default: false
   */
  restartOnBoot?: boolean;

  /**
   * Target time interval between location updates in milliseconds (Android only).
   * Default: 5000
   */
  updateIntervalMs?: number;

  /**
   * Minimum time between location updates in milliseconds (Android only).
   * Updates will never arrive faster than this value.
   * Default: 2000
   */
  minUpdateIntervalMs?: number;

  /**
   * Title of the persistent foreground service notification (Android only).
   * Default: 'Location Tracking'
   */
  serviceTitle?: string;

  /**
   * Body text of the persistent foreground service notification (Android only).
   * Default: 'Your location is being tracked in the background.'
   */
  serviceBody?: string;

  /**
   * Name of the HeadlessJS task to invoke when the app is not in the foreground (Android only).
   * Register this task in your app's index.js using AppRegistry.registerHeadlessTask().
   * Default: 'GeoServiceHeadlessTask'
   */
  backgroundTaskName?: string;

  /**
   * Hint to the OS about what kind of motion this location data is used for (iOS only).
   * Allows CoreLocation to apply activity-specific power optimisations.
   * Default: 'other'
   */
  motionActivity?: 'other' | 'automotiveNavigation' | 'fitness' | 'otherNavigation' | 'airborne';

  /**
   * Allow iOS to automatically pause location updates when no movement is detected.
   * Set to false to always receive updates.
   * Default: false
   */
  autoPauseUpdates?: boolean;

  /**
   * Show the blue location indicator in the iOS status bar when tracking in background.
   * Default: false
   */
  showBackgroundIndicator?: boolean;

  /**
   * Use Significant Location Changes instead of standard location updates (iOS only).
   * Much more battery efficient — only fires when the device moves ~500m.
   * Wakes the app even if it was terminated.
   * Default: false
   */
  coarseTracking?: boolean;

  /**
   * Automatically drop to low-power mode when the device appears stationary,
   * and restore the configured accuracy the moment movement is detected again.
   *
   * On Android this turns the GPS chip completely off while parked.
   * On iOS this reduces accuracy to kCLLocationAccuracyKilometer while still.
   *
   * This is the single biggest battery saving for apps that track driving/walking —
   * GPS stays off while the user is parked or sitting still.
   * Default: true
   */
  adaptiveAccuracy?: boolean;

  /**
   * Speed in m/s below which a reading is counted as "idle/stationary".
   * Default: 0.5 (~1.8 km/h)
   */
  idleSpeedThreshold?: number;

  /**
   * Number of consecutive idle readings required before entering low-power mode.
   * Higher = fewer false positives but slower to power down.
   * Default: 3
   */
  idleSampleCount?: number;

  /**
   * Enable verbose native logging.
   * Default: false
   */
  debug?: boolean;
}

export interface Location {
  latitude: number;
  longitude: number;
  /** Horizontal accuracy in meters */
  accuracy: number;
  altitude: number;
  /** Vertical accuracy in meters (iOS only, -1 on Android) */
  altitudeAccuracy: number;
  /** Speed in meters per second, -1 if unavailable */
  speed: number;
  /** Bearing/heading in degrees (0–360), -1 if unavailable */
  bearing: number;
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** Whether this location came from a mock provider (Android only) */
  isFromMockProvider?: boolean;
  /** True when adaptive accuracy has detected the device is idle and GPS is off */
  isStationary?: boolean;
}

export interface LocationError {
  code: number;
  message: string;
}

export type LocationCallback = (location: Location) => void;
export type ErrorCallback = (error: LocationError) => void;

/**
 * Returned by onLocation() and onError().
 * Call .remove() to stop receiving updates and clean up the listener.
 */
export interface GeoSubscription {
  remove(): void;
}
