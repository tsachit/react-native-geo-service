#import "RNGeoService.h"
#import <React/RCTLog.h>
#import <UIKit/UIKit.h>

// ---------------------------------------------------------------------------
// CLActivityType helper
// ---------------------------------------------------------------------------
static CLActivityType activityTypeFromString(NSString *type) {
    if ([type isEqualToString:@"automotiveNavigation"]) return CLActivityTypeAutomotiveNavigation;
    if ([type isEqualToString:@"fitness"])              return CLActivityTypeFitness;
    if ([type isEqualToString:@"otherNavigation"])      return CLActivityTypeOtherNavigation;
    if (@available(iOS 12.0, *)) {
        if ([type isEqualToString:@"airborne"])         return CLActivityTypeAirborne;
    }
    return CLActivityTypeOther;
}

// ---------------------------------------------------------------------------
// CLLocationAccuracy helper
// ---------------------------------------------------------------------------
static CLLocationAccuracy accuracyFromString(NSString *accuracy) {
    if ([accuracy isEqualToString:@"navigation"])  return kCLLocationAccuracyBestForNavigation;
    if ([accuracy isEqualToString:@"high"])        return kCLLocationAccuracyBest;
    if ([accuracy isEqualToString:@"low"])         return kCLLocationAccuracyKilometer;
    // "balanced" → nearest 100 metres — good trade-off between precision and battery
    return kCLLocationAccuracyHundredMeters;
}

// ---------------------------------------------------------------------------
// RNGeoService implementation
// ---------------------------------------------------------------------------
@interface RNGeoService ()

@property (nonatomic, strong) CLLocationManager *locationManager;
@property (nonatomic, strong) NSDictionary *config;

// Locations buffered while JS listeners are not yet attached (background relaunch)
@property (nonatomic, strong) NSMutableArray<NSDictionary *> *pendingLocations;

@property (nonatomic, assign) BOOL isTracking;
@property (nonatomic, assign) BOOL hasListeners;
@property (nonatomic, assign) BOOL coarseTracking;
@property (nonatomic, assign) BOOL debugMode;

// Adaptive accuracy state
@property (nonatomic, assign) BOOL adaptiveAccuracy;
@property (nonatomic, assign) float idleSpeedThreshold;
@property (nonatomic, assign) NSInteger idleSampleCount;
@property (nonatomic, assign) NSInteger slowReadingCount;
@property (nonatomic, assign) BOOL isIdle;

// Battery tracking
@property (nonatomic, assign) float batteryLevelAtStart;

// Session tracking metrics
@property (nonatomic, assign) NSInteger updateCount;
@property (nonatomic, strong) NSDate *trackingStartTime;
@property (nonatomic, assign) NSTimeInterval gpsActiveSeconds; // accumulated GPS-on time
@property (nonatomic, strong) NSDate *gpsActiveStart;          // when current GPS-on window started

@end

@implementation RNGeoService

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup {
    return YES;
}

- (dispatch_queue_t)methodQueue {
    return dispatch_get_main_queue();
}

// ---------------------------------------------------------------------------
// Init — auto-resume tracking if app was relaunched from terminated state
//
// iOS can relaunch a terminated app when startMonitoringSignificantLocationChanges
// is active. When this happens, React Native creates a fresh module instance.
// We detect this via NSUserDefaults and immediately resume tracking so that
// location updates are not lost during the relaunch window.
// ---------------------------------------------------------------------------
- (instancetype)init {
    if (self = [super init]) {
        self.pendingLocations = [NSMutableArray array];

        NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];
        BOOL wasTracking = [defaults boolForKey:@"GeoServiceIsTracking"];

        if (wasTracking) {
            // Restore persisted config
            NSData *configData = [defaults objectForKey:@"GeoServiceConfig"];
            if (configData) {
                NSDictionary *restoredConfig = [NSPropertyListSerialization
                    propertyListWithData:configData options:0 format:nil error:nil];
                if (restoredConfig) {
                    self.config             = restoredConfig;
                    self.coarseTracking     = [restoredConfig[@"coarseTracking"] boolValue];
                    self.debugMode          = [restoredConfig[@"debug"] boolValue];
                    self.adaptiveAccuracy   = restoredConfig[@"adaptiveAccuracy"]
                        ? [restoredConfig[@"adaptiveAccuracy"] boolValue] : YES;
                    self.idleSpeedThreshold = restoredConfig[@"idleSpeedThreshold"]
                        ? [restoredConfig[@"idleSpeedThreshold"] floatValue] : 0.5f;
                    self.idleSampleCount    = restoredConfig[@"idleSampleCount"]
                        ? [restoredConfig[@"idleSampleCount"] integerValue] : 3;
                }
            }

            [self applyConfigToLocationManager];

            // Significant changes is always running alongside standard updates —
            // it is the only mechanism that can wake a terminated app and costs
            // almost nothing in battery (cell towers, not GPS).
            [self.locationManager startMonitoringSignificantLocationChanges];
            if (!self.coarseTracking) {
                [self.locationManager startUpdatingLocation];
            }
            self.isTracking = YES;
            if (self.debugMode) RCTLogInfo(@"[RNGeoService] Auto-resumed tracking after app relaunch");
        }
    }
    return self;
}

// ---------------------------------------------------------------------------
// Supported events
// ---------------------------------------------------------------------------
- (NSArray<NSString *> *)supportedEvents {
    return @[@"onLocation", @"onError"];
}

// Drain any locations that arrived before JS listeners were attached.
// This is the normal case during a background relaunch from terminated state:
// CLLocationManager fires before the React component tree has mounted.
- (void)startObserving {
    self.hasListeners = YES;
    if (self.pendingLocations.count > 0) {
        if (self.debugMode) {
            RCTLogInfo(@"[RNGeoService] Draining %lu buffered location(s) to JS",
                       (unsigned long)self.pendingLocations.count);
        }
        for (NSDictionary *loc in self.pendingLocations) {
            [self sendEventWithName:@"onLocation" body:loc];
        }
        [self.pendingLocations removeAllObjects];
    }
}

- (void)stopObserving { self.hasListeners = NO; }

// ---------------------------------------------------------------------------
// Lazy CLLocationManager
// ---------------------------------------------------------------------------
- (CLLocationManager *)locationManager {
    if (!_locationManager) {
        _locationManager = [[CLLocationManager alloc] init];
        _locationManager.delegate = self;
    }
    return _locationManager;
}

// ---------------------------------------------------------------------------
// configure()
// ---------------------------------------------------------------------------
RCT_EXPORT_METHOD(configure:(NSDictionary *)options
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    self.config           = options;
    self.coarseTracking   = [options[@"coarseTracking"] boolValue];
    self.debugMode        = [options[@"debug"] boolValue];
    self.adaptiveAccuracy = options[@"adaptiveAccuracy"] ? [options[@"adaptiveAccuracy"] boolValue] : YES;
    self.idleSpeedThreshold = options[@"idleSpeedThreshold"] ? [options[@"idleSpeedThreshold"] floatValue] : 0.5f;
    self.idleSampleCount  = options[@"idleSampleCount"] ? [options[@"idleSampleCount"] integerValue] : 3;
    self.slowReadingCount = 0;
    self.isIdle           = NO;

    // Persist config so it survives app termination and can be restored on
    // background relaunch triggered by significant location changes.
    NSError *serializeError = nil;
    NSData *configData = [NSPropertyListSerialization
        dataWithPropertyList:options
        format:NSPropertyListBinaryFormat_v1_0
        options:0
        error:&serializeError];
    if (configData && !serializeError) {
        [[NSUserDefaults standardUserDefaults] setObject:configData forKey:@"GeoServiceConfig"];
        [[NSUserDefaults standardUserDefaults] synchronize];
    }

    [self applyConfigToLocationManager];

    if (self.debugMode) RCTLogInfo(@"[RNGeoService] Config applied: %@", options);
    resolve(nil);
}

- (void)applyConfigToLocationManager {
    NSDictionary *cfg = self.config ?: @{};

    NSString *accuracy = cfg[@"accuracy"] ?: @"balanced";
    self.locationManager.desiredAccuracy = accuracyFromString(accuracy);

    double minDist = [cfg[@"minDistanceMeters"] doubleValue];
    self.locationManager.distanceFilter = (minDist > 0) ? minDist : kCLDistanceFilterNone;

    NSString *motionActivity = cfg[@"motionActivity"] ?: @"other";
    self.locationManager.activityType = activityTypeFromString(motionActivity);

    BOOL autoPause = [cfg[@"autoPauseUpdates"] boolValue];
    self.locationManager.pausesLocationUpdatesAutomatically = autoPause;

    if (@available(iOS 11.0, *)) {
        BOOL bgIndicator = self.debugMode ? YES : [cfg[@"showBackgroundIndicator"] boolValue];
        self.locationManager.showsBackgroundLocationIndicator = bgIndicator;
    }

    self.locationManager.allowsBackgroundLocationUpdates = YES;
}

// ---------------------------------------------------------------------------
// start()
// ---------------------------------------------------------------------------
RCT_EXPORT_METHOD(start:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    CLAuthorizationStatus status = [CLLocationManager authorizationStatus];

    // If permission is denied or restricted, resolve without starting.
    // The app is responsible for requesting OS permission (via react-native-permissions)
    // before calling start(). If denied, the didChangeAuthorizationStatus delegate
    // will handle cleanup.
    if (status == kCLAuthorizationStatusDenied ||
        status == kCLAuthorizationStatusRestricted) {
        resolve(nil);
        return;
    }

    [self applyConfigToLocationManager];

    // Significant changes MUST always run alongside standard updates.
    // It is the only iOS mechanism that can relaunch a terminated app —
    // and it uses cell towers (not GPS), so battery cost is negligible.
    [self.locationManager startMonitoringSignificantLocationChanges];

    if (self.coarseTracking) {
        if (self.debugMode) RCTLogInfo(@"[RNGeoService] Coarse (significant-change only) tracking started");
    } else {
        [self.locationManager startUpdatingLocation];
        if (self.debugMode) RCTLogInfo(@"[RNGeoService] Standard tracking started (+ significant changes for background wake)");
    }

    self.isTracking = YES;
    [[NSUserDefaults standardUserDefaults] setBool:YES forKey:@"GeoServiceIsTracking"];
    [[NSUserDefaults standardUserDefaults] synchronize];

    // Record battery level at tracking start for drain calculation
    [UIDevice currentDevice].batteryMonitoringEnabled = YES;
    self.batteryLevelAtStart = [UIDevice currentDevice].batteryLevel;

    // Reset session metrics
    self.updateCount      = 0;
    self.gpsActiveSeconds = 0;
    self.trackingStartTime = [NSDate date];
    self.gpsActiveStart    = [NSDate date]; // GPS starts active

    resolve(nil);
}

// ---------------------------------------------------------------------------
// stop()
// ---------------------------------------------------------------------------
RCT_EXPORT_METHOD(stop:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    [self.locationManager stopUpdatingLocation];
    [self.locationManager stopMonitoringSignificantLocationChanges];

    self.isTracking = NO;
    [[NSUserDefaults standardUserDefaults] setBool:NO forKey:@"GeoServiceIsTracking"];
    [[NSUserDefaults standardUserDefaults] removeObjectForKey:@"GeoServiceConfig"];
    [[NSUserDefaults standardUserDefaults] synchronize];

    if (self.debugMode) RCTLogInfo(@"[RNGeoService] Tracking stopped");
    resolve(nil);
}

// ---------------------------------------------------------------------------
// isTracking() / getCurrentLocation()
// ---------------------------------------------------------------------------
RCT_EXPORT_METHOD(isTracking:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    resolve(@(self.isTracking));
}

RCT_EXPORT_METHOD(getCurrentLocation:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    CLLocation *last = self.locationManager.location;
    if (last) {
        resolve([self locationToDictionary:last]);
    } else {
        reject(@"NO_LOCATION", @"No cached location available. Call start() first.", nil);
    }
}

// ---------------------------------------------------------------------------
// getBatteryInfo() / setLocationIndicator()
// ---------------------------------------------------------------------------
RCT_EXPORT_METHOD(getBatteryInfo:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    [UIDevice currentDevice].batteryMonitoringEnabled = YES;
    float current = [UIDevice currentDevice].batteryLevel;
    UIDeviceBatteryState state = [UIDevice currentDevice].batteryState;
    BOOL isCharging = state == UIDeviceBatteryStateCharging || state == UIDeviceBatteryStateFull;
    float drain = (self.batteryLevelAtStart > 0 && current > 0)
        ? (self.batteryLevelAtStart - current) * 100.0f : 0.0f;

    // Elapsed session time
    NSTimeInterval elapsed = self.trackingStartTime
        ? [[NSDate date] timeIntervalSinceDate:self.trackingStartTime] : 0;

    // GPS active = accumulated time + current window (if GPS is on right now)
    NSTimeInterval gpsActive = self.gpsActiveSeconds;
    if (!self.isIdle && self.gpsActiveStart) {
        gpsActive += [[NSDate date] timeIntervalSinceDate:self.gpsActiveStart];
    }

    double updatesPerMinute = (elapsed > 0)
        ? (self.updateCount / (elapsed / 60.0)) : 0;
    double drainRatePerHour = (elapsed > 0 && drain > 0)
        ? (drain / (elapsed / 3600.0)) : 0;

    resolve(@{
        @"level":                  @(current * 100.0f),
        @"isCharging":             @(isCharging),
        @"levelAtStart":           @(self.batteryLevelAtStart * 100.0f),
        @"drainSinceStart":        @(MAX(drain, 0.0f)),
        @"updateCount":            @(self.updateCount),
        @"trackingElapsedSeconds": @(elapsed),
        @"gpsActiveSeconds":       @(gpsActive),
        @"updatesPerMinute":       @(updatesPerMinute),
        @"drainRatePerHour":       @(MAX(drainRatePerHour, 0.0))
    });
}

RCT_EXPORT_METHOD(setLocationIndicator:(BOOL)show
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    if (@available(iOS 11.0, *)) {
        self.locationManager.showsBackgroundLocationIndicator = show;
    }
    resolve(nil);
}

// ---------------------------------------------------------------------------
// CLLocationManagerDelegate
// ---------------------------------------------------------------------------
- (void)locationManager:(CLLocationManager *)manager
     didUpdateLocations:(NSArray<CLLocation *> *)locations {
    CLLocation *location = [locations lastObject];
    if (!location) return;

    self.updateCount++;

    if (self.debugMode) {
        RCTLogInfo(@"[RNGeoService] Location #%ld: %f, %f (±%.0fm) speed=%.1fm/s",
                   (long)self.updateCount,
                   location.coordinate.latitude,
                   location.coordinate.longitude,
                   location.horizontalAccuracy,
                   location.speed);
    }

    if (self.adaptiveAccuracy && !self.coarseTracking) {
        [self evaluateMotionState:location];
    }

    NSDictionary *locationDict = [self locationToDictionary:location];

    if (self.hasListeners) {
        [self sendEventWithName:@"onLocation" body:locationDict];
    } else {
        // Buffer the location — JS listeners haven't attached yet.
        // This is normal during background relaunch: CLLocationManager fires
        // before the React component tree has had time to mount.
        // Events are drained in startObserving() once a listener attaches.
        if (self.pendingLocations.count < 10) {
            [self.pendingLocations addObject:locationDict];
        }
    }
}

- (void)evaluateMotionState:(CLLocation *)location {
    // speed is -1 when unavailable (e.g. first fix from cache) — treat as moving
    float speed = (location.speed >= 0) ? (float)location.speed : 1.0f;

    if (speed < self.idleSpeedThreshold) {
        self.slowReadingCount++;
        if (!self.isIdle && self.slowReadingCount >= self.idleSampleCount) {
            self.isIdle = YES;
            self.slowReadingCount = 0;
            // Accumulate GPS-on time before going idle
            if (self.gpsActiveStart) {
                self.gpsActiveSeconds += [[NSDate date] timeIntervalSinceDate:self.gpsActiveStart];
                self.gpsActiveStart = nil;
            }
            // Reduce accuracy — CoreLocation stops requesting GPS
            self.locationManager.desiredAccuracy = kCLLocationAccuracyKilometer;
            self.locationManager.distanceFilter = 50.0;
            if (self.debugMode) RCTLogInfo(@"[RNGeoService] Device idle — GPS off");
        }
    } else {
        if (self.isIdle) {
            self.isIdle = NO;
            self.slowReadingCount = 0;
            self.gpsActiveStart = [NSDate date]; // GPS back on
            [self applyConfigToLocationManager];
            if (self.debugMode) RCTLogInfo(@"[RNGeoService] Movement detected — accuracy restored");
        } else {
            self.slowReadingCount = 0;
        }
    }
}

- (void)locationManager:(CLLocationManager *)manager
       didFailWithError:(NSError *)error {
    // kCLErrorLocationUnknown (code 0) is transient — CoreLocation hasn't acquired
    // a fix yet but will keep trying automatically. Silently ignore it.
    if ([error.domain isEqualToString:kCLErrorDomain] && error.code == kCLErrorLocationUnknown) {
        if (self.debugMode) RCTLogInfo(@"[RNGeoService] Location unknown (transient) — waiting for GPS fix");
        return;
    }

    // kCLErrorDenied: user revoked permission. Stop everything and clear state.
    if ([error.domain isEqualToString:kCLErrorDomain] && error.code == kCLErrorDenied) {
        RCTLogWarn(@"[RNGeoService] Location permission denied — stopping tracking");
        [self.locationManager stopUpdatingLocation];
        [self.locationManager stopMonitoringSignificantLocationChanges];
        self.isTracking = NO;
        [[NSUserDefaults standardUserDefaults] setBool:NO forKey:@"GeoServiceIsTracking"];
        [[NSUserDefaults standardUserDefaults] synchronize];
    } else {
        RCTLogError(@"[RNGeoService] Location error: %@", error.localizedDescription);
    }

    if (self.hasListeners) {
        [self sendEventWithName:@"onError" body:@{
            @"code":    @(error.code),
            @"message": error.localizedDescription ?: @"Unknown location error"
        }];
    }
}

- (void)locationManager:(CLLocationManager *)manager
    didChangeAuthorizationStatus:(CLAuthorizationStatus)status {
    if (self.debugMode) RCTLogInfo(@"[RNGeoService] Auth status changed: %d", status);

    // Permission was revoked while tracking — stop and notify JS
    if (status == kCLAuthorizationStatusDenied || status == kCLAuthorizationStatusRestricted) {
        if (self.isTracking) {
            [self.locationManager stopUpdatingLocation];
            [self.locationManager stopMonitoringSignificantLocationChanges];
            self.isTracking = NO;
            [[NSUserDefaults standardUserDefaults] setBool:NO forKey:@"GeoServiceIsTracking"];
            [[NSUserDefaults standardUserDefaults] synchronize];
            if (self.hasListeners) {
                [self sendEventWithName:@"onError" body:@{
                    @"code":    @(kCLErrorDenied),
                    @"message": @"Location permission was revoked. Please re-enable in Settings."
                }];
            }
        }
        return;
    }

    // Permission granted after background relaunch — resume if we were tracking before
    if ((status == kCLAuthorizationStatusAuthorizedAlways ||
         status == kCLAuthorizationStatusAuthorizedWhenInUse) &&
        !self.isTracking &&
        [[NSUserDefaults standardUserDefaults] boolForKey:@"GeoServiceIsTracking"]) {
        [self applyConfigToLocationManager];
        [self.locationManager startMonitoringSignificantLocationChanges];
        if (!self.coarseTracking) {
            [self.locationManager startUpdatingLocation];
        }
        self.isTracking = YES;
        if (self.debugMode) RCTLogInfo(@"[RNGeoService] Tracking resumed after auth grant");
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
- (NSDictionary *)locationToDictionary:(CLLocation *)location {
    return @{
        @"latitude":         @(location.coordinate.latitude),
        @"longitude":        @(location.coordinate.longitude),
        @"accuracy":         @(location.horizontalAccuracy),
        @"altitude":         @(location.altitude),
        @"altitudeAccuracy": @(location.verticalAccuracy),
        @"speed":            @(location.speed),
        @"bearing":          @(location.course),
        @"timestamp":        @((long long)(location.timestamp.timeIntervalSince1970 * 1000)),
        @"isStationary":     @(self.isIdle)
    };
}

@end
