#import "RNGeoService.h"
#import <React/RCTLog.h>

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
// Supported events
// ---------------------------------------------------------------------------
- (NSArray<NSString *> *)supportedEvents {
    return @[@"onLocation", @"onError"];
}

- (void)startObserving { self.hasListeners = YES; }
- (void)stopObserving  { self.hasListeners = NO;  }

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
    self.config = options;
    self.coarseTracking   = [options[@"coarseTracking"] boolValue];
    self.debugMode        = [options[@"debug"] boolValue];
    self.adaptiveAccuracy = options[@"adaptiveAccuracy"] ? [options[@"adaptiveAccuracy"] boolValue] : YES;
    self.idleSpeedThreshold = options[@"idleSpeedThreshold"] ? [options[@"idleSpeedThreshold"] floatValue] : 0.5f;
    self.idleSampleCount  = options[@"idleSampleCount"] ? [options[@"idleSampleCount"] integerValue] : 3;
    self.slowReadingCount = 0;
    self.isIdle           = NO;

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
        BOOL bgIndicator = [cfg[@"showBackgroundIndicator"] boolValue];
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

    if (status == kCLAuthorizationStatusDenied ||
        status == kCLAuthorizationStatusRestricted) {
        reject(@"PERMISSION_DENIED", @"Location permission denied. Request 'Always' permission before calling start().", nil);
        return;
    }

    if (status == kCLAuthorizationStatusNotDetermined) {
        [self.locationManager requestAlwaysAuthorization];
    }

    [self applyConfigToLocationManager];

    if (self.coarseTracking) {
        [self.locationManager startMonitoringSignificantLocationChanges];
        if (self.debugMode) RCTLogInfo(@"[RNGeoService] Coarse (significant-change) tracking started");
    } else {
        [self.locationManager startUpdatingLocation];
        if (self.debugMode) RCTLogInfo(@"[RNGeoService] Standard tracking started");
    }

    self.isTracking = YES;
    [[NSUserDefaults standardUserDefaults] setBool:YES forKey:@"GeoServiceIsTracking"];
    [[NSUserDefaults standardUserDefaults] synchronize];

    resolve(nil);
}

// ---------------------------------------------------------------------------
// stop()
// ---------------------------------------------------------------------------
RCT_EXPORT_METHOD(stop:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    if (self.coarseTracking) {
        [self.locationManager stopMonitoringSignificantLocationChanges];
    } else {
        [self.locationManager stopUpdatingLocation];
    }

    self.isTracking = NO;
    [[NSUserDefaults standardUserDefaults] setBool:NO forKey:@"GeoServiceIsTracking"];
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
// CLLocationManagerDelegate
// ---------------------------------------------------------------------------
- (void)locationManager:(CLLocationManager *)manager
     didUpdateLocations:(NSArray<CLLocation *> *)locations {
    CLLocation *location = [locations lastObject];
    if (!location) return;

    if (self.debugMode) {
        RCTLogInfo(@"[RNGeoService] Location: %f, %f (±%.0fm) speed=%.1fm/s",
                   location.coordinate.latitude,
                   location.coordinate.longitude,
                   location.horizontalAccuracy,
                   location.speed);
    }

    if (self.adaptiveAccuracy && !self.coarseTracking) {
        [self evaluateMotionState:location];
    }

    if (self.hasListeners) {
        [self sendEventWithName:@"onLocation" body:[self locationToDictionary:location]];
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
            // Reduce accuracy — CoreLocation stops requesting GPS
            self.locationManager.desiredAccuracy = kCLLocationAccuracyKilometer;
            self.locationManager.distanceFilter = 50.0;
            if (self.debugMode) RCTLogInfo(@"[RNGeoService] Device idle — GPS off");
        }
    } else {
        if (self.isIdle) {
            self.isIdle = NO;
            self.slowReadingCount = 0;
            [self applyConfigToLocationManager];
            if (self.debugMode) RCTLogInfo(@"[RNGeoService] Movement detected — accuracy restored");
        } else {
            self.slowReadingCount = 0;
        }
    }
}

- (void)locationManager:(CLLocationManager *)manager
       didFailWithError:(NSError *)error {
    RCTLogError(@"[RNGeoService] Location error: %@", error.localizedDescription);
    if (self.hasListeners) {
        [self sendEventWithName:@"onError" body:@{
            @"code":    @(error.code),
            @"message": error.localizedDescription ?: @"Unknown location error"
        }];
    }
}

- (void)locationManager:(CLLocationManager *)manager
    didChangeAuthorizationStatus:(CLAuthorizationStatus)status {
    if (self.debugMode) RCTLogInfo(@"[RNGeoService] Auth status: %d", status);

    // Resume tracking after background relaunch (e.g. significant location change)
    if (status == kCLAuthorizationStatusAuthorizedAlways &&
        [[NSUserDefaults standardUserDefaults] boolForKey:@"GeoServiceIsTracking"]) {
        [self applyConfigToLocationManager];
        if (self.coarseTracking) {
            [self.locationManager startMonitoringSignificantLocationChanges];
        } else {
            [self.locationManager startUpdatingLocation];
        }
        self.isTracking = YES;
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
