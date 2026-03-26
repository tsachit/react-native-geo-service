package com.geoservice

import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.util.Log
import androidx.localbroadcastmanager.content.LocalBroadcastManager
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.android.gms.location.LocationServices
import org.json.JSONObject

class GeoServiceModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val TAG = "GeoService:Module"
        const val MODULE_NAME = "RNGeoService"

        // Tracks whether the React context / JS engine is alive.
        // LocationService reads this to decide whether to use EventEmitter or HeadlessJS.
        @Volatile
        var isReactContextActive = false
            private set
    }

    private var config: GeoServiceConfig = GeoServiceConfig()
    private var listenerCount = 0
    private var locationReceiver: BroadcastReceiver? = null

    init {
        isReactContextActive = true
        reactContext.addLifecycleEventListener(object : LifecycleEventListener {
            override fun onHostResume() {
                isReactContextActive = true
            }

            override fun onHostPause() {
                // Still alive; HeadlessJS not needed yet
                isReactContextActive = true
            }

            override fun onHostDestroy() {
                isReactContextActive = false
            }
        })
    }

    override fun getName() = MODULE_NAME

    // --------------------------------------------------------------------------------------------
    // Required for NativeEventEmitter
    // --------------------------------------------------------------------------------------------

    @ReactMethod
    fun addListener(eventName: String) {
        listenerCount++
        if (listenerCount == 1) registerLocationReceiver()
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        listenerCount = (listenerCount - count).coerceAtLeast(0)
        if (listenerCount == 0) unregisterLocationReceiver()
    }

    // --------------------------------------------------------------------------------------------
    // JS-exposed API
    // --------------------------------------------------------------------------------------------

    @ReactMethod
    fun configure(options: ReadableMap, promise: Promise) {
        try {
            config = GeoServiceConfig(
                minDistanceMeters = options.getDoubleOrDefault("minDistanceMeters", 10.0).toFloat(),
                accuracy = options.getStringOrDefault("accuracy", "balanced"),
                stopOnAppClose = options.getBooleanOrDefault("stopOnAppClose", false),
                restartOnBoot = options.getBooleanOrDefault("restartOnBoot", false),
                updateIntervalMs = options.getDoubleOrDefault("updateIntervalMs", 5000.0).toLong(),
                minUpdateIntervalMs = options.getDoubleOrDefault("minUpdateIntervalMs", 2000.0).toLong(),
                serviceTitle = options.getStringOrDefault("serviceTitle", "Location Tracking"),
                serviceBody = options.getStringOrDefault("serviceBody", "Your location is being tracked in the background."),
                backgroundTaskName = options.getStringOrDefault("backgroundTaskName", "GeoServiceHeadlessTask"),
                adaptiveAccuracy = options.getBooleanOrDefault("adaptiveAccuracy", true),
                idleSpeedThreshold = options.getDoubleOrDefault("idleSpeedThreshold", 0.5).toFloat(),
                idleSampleCount = options.getDoubleOrDefault("idleSampleCount", 3.0).toInt(),
                debug = options.getBooleanOrDefault("debug", false)
            )
            persistConfig()
            log("Config updated: $config")
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("CONFIGURE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun start(promise: Promise) {
        try {
            registerLocationReceiver()
            startLocationService()
            saveTrackingState(true)
            log("Tracking started")
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("START_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun stop(promise: Promise) {
        try {
            reactContext.stopService(Intent(reactContext, LocationService::class.java))
            saveTrackingState(false)
            log("Tracking stopped")
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("STOP_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun isTracking(promise: Promise) {
        promise.resolve(LocationService.isRunning)
    }

    @SuppressLint("MissingPermission")
    @ReactMethod
    fun getCurrentLocation(promise: Promise) {
        val client = LocationServices.getFusedLocationProviderClient(reactContext)
        client.lastLocation
            .addOnSuccessListener { location ->
                if (location != null) {
                    promise.resolve(locationToWritableMap(location))
                } else {
                    promise.reject("NO_LOCATION", "No last known location available. Start tracking first.")
                }
            }
            .addOnFailureListener { e ->
                promise.reject("LOCATION_ERROR", e.message, e)
            }
    }

    // --------------------------------------------------------------------------------------------
    // Internal helpers
    // --------------------------------------------------------------------------------------------

    private fun startLocationService() {
        val intent = Intent(reactContext, LocationService::class.java).apply {
            putExtra("config", config.toBundle())
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            reactContext.startForegroundService(intent)
        } else {
            reactContext.startService(intent)
        }
    }

    private fun registerLocationReceiver() {
        if (locationReceiver != null) return

        locationReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                when (intent.action) {
                    LocationService.ACTION_LOCATION_UPDATE -> {
                        val json = intent.getStringExtra(LocationService.EXTRA_LOCATION) ?: return
                        sendEvent("onLocation", json)
                    }
                    LocationService.ACTION_LOCATION_ERROR -> {
                        val json = intent.getStringExtra(LocationService.EXTRA_ERROR) ?: return
                        sendEvent("onError", json)
                    }
                }
            }
        }

        val filter = IntentFilter().apply {
            addAction(LocationService.ACTION_LOCATION_UPDATE)
            addAction(LocationService.ACTION_LOCATION_ERROR)
        }
        LocalBroadcastManager.getInstance(reactContext)
            .registerReceiver(locationReceiver!!, filter)
    }

    private fun unregisterLocationReceiver() {
        locationReceiver?.let {
            LocalBroadcastManager.getInstance(reactContext).unregisterReceiver(it)
            locationReceiver = null
        }
    }

    private fun sendEvent(eventName: String, jsonString: String) {
        if (!reactContext.hasActiveCatalystInstance()) return
        try {
            val map = Arguments.createMap()
            val json = JSONObject(jsonString)
            for (key in json.keys()) {
                when (val value = json.get(key)) {
                    is Double -> map.putDouble(key, value)
                    is Int -> map.putInt(key, value)
                    is Long -> map.putDouble(key, value.toDouble())
                    is Boolean -> map.putBoolean(key, value)
                    is String -> map.putString(key, value)
                }
            }
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, map)
        } catch (e: Exception) {
            Log.e(TAG, "Error sending event: ${e.message}")
        }
    }

    private fun locationToWritableMap(location: android.location.Location): WritableMap {
        return Arguments.createMap().apply {
            putDouble("latitude", location.latitude)
            putDouble("longitude", location.longitude)
            putDouble("accuracy", location.accuracy.toDouble())
            putDouble("altitude", location.altitude)
            putDouble("altitudeAccuracy", if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                location.verticalAccuracyMeters.toDouble() else -1.0)
            putDouble("speed", if (location.hasSpeed()) location.speed.toDouble() else -1.0)
            putDouble("bearing", if (location.hasBearing()) location.bearing.toDouble() else -1.0)
            putDouble("timestamp", location.time.toDouble())
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                putBoolean("isFromMockProvider", location.isMock)
            }
        }
    }

    private fun persistConfig() {
        val prefs = reactContext.getSharedPreferences(
            BootReceiver.PREFS_NAME, Context.MODE_PRIVATE
        )
        val json = JSONObject().apply {
            put("minDistanceMeters", config.minDistanceMeters.toDouble())
            put("accuracy", config.accuracy)
            put("stopOnAppClose", config.stopOnAppClose)
            put("restartOnBoot", config.restartOnBoot)
            put("updateIntervalMs", config.updateIntervalMs)
            put("minUpdateIntervalMs", config.minUpdateIntervalMs)
            put("serviceTitle", config.serviceTitle)
            put("serviceBody", config.serviceBody)
            put("backgroundTaskName", config.backgroundTaskName)
            put("adaptiveAccuracy", config.adaptiveAccuracy)
            put("idleSpeedThreshold", config.idleSpeedThreshold.toDouble())
            put("idleSampleCount", config.idleSampleCount)
            put("debug", config.debug)
        }
        prefs.edit()
            .putString("configBundle", json.toString())
            .putBoolean(BootReceiver.KEY_RESTART_ON_BOOT, config.restartOnBoot)
            .apply()
    }

    private fun saveTrackingState(isTracking: Boolean) {
        reactContext.getSharedPreferences(BootReceiver.PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(BootReceiver.KEY_IS_TRACKING, isTracking)
            .apply()
    }

    private fun log(msg: String) {
        if (config.debug) Log.d(TAG, msg)
    }

    override fun invalidate() {
        super.invalidate()
        isReactContextActive = false
        unregisterLocationReceiver()
        if (config.stopOnAppClose) {
            reactContext.stopService(Intent(reactContext, LocationService::class.java))
        }
    }
}

// --------------------------------------------------------------------------------------------
// Extension helpers for ReadableMap
// --------------------------------------------------------------------------------------------

private fun ReadableMap.getDoubleOrDefault(key: String, default: Double): Double =
    if (hasKey(key) && !isNull(key)) getDouble(key) else default

private fun ReadableMap.getStringOrDefault(key: String, default: String): String =
    if (hasKey(key) && !isNull(key)) getString(key) ?: default else default

private fun ReadableMap.getBooleanOrDefault(key: String, default: Boolean): Boolean =
    if (hasKey(key) && !isNull(key)) getBoolean(key) else default
