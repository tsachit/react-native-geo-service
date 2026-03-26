#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <CoreLocation/CoreLocation.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * RNGeoService — Battery-efficient background geolocation for React Native (iOS)
 *
 * Supports:
 *  - Standard location updates (fine-grained, respects minDistanceMeters)
 *  - Significant location changes (coarse, very battery-efficient, wakes app when terminated)
 *  - Background location via UIBackgroundModes: location
 */
@interface RNGeoService : RCTEventEmitter <RCTBridgeModule, CLLocationManagerDelegate>

@end

NS_ASSUME_NONNULL_END
