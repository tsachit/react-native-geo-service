package com.geoservice

import android.annotation.SuppressLint
import android.app.*
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.localbroadcastmanager.content.LocalBroadcastManager
import com.google.android.gms.location.*
import org.json.JSONObject

class LocationService : Service() {

    companion object {
        const val TAG = "GeoService:LocationService"
        const val ACTION_LOCATION_UPDATE = "com.geoservice.LOCATION_UPDATE"
        const val ACTION_LOCATION_ERROR = "com.geoservice.LOCATION_ERROR"
        const val EXTRA_LOCATION = "location"
        const val EXTRA_ERROR = "error"
        const val NOTIFICATION_CHANNEL_ID = "geo_service_channel"
        const val NOTIFICATION_ID = 9731

        var isRunning = false
            private set
    }

    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private lateinit var locationCallback: LocationCallback
    private var config: GeoServiceConfig = GeoServiceConfig()

    // ---------------------------------------------------------------------------
    // Adaptive accuracy state
    // ---------------------------------------------------------------------------
    private var slowReadingCount = 0
    private var isIdle = false

    override fun onCreate() {
        super.onCreate()
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)
        createNotificationChannel()
        log("Service created")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val bundle = intent?.getBundleExtra("config")
        config = GeoServiceConfig.fromBundle(bundle)

        slowReadingCount = 0
        isIdle = false

        log("Starting — adaptiveAccuracy=${config.adaptiveAccuracy}, accuracy=${config.accuracy}")
        startForeground(NOTIFICATION_ID, buildNotification())
        startLocationUpdates(idleOverride = false)
        isRunning = true

        return START_STICKY
    }

    // ---------------------------------------------------------------------------
    // Location updates
    // ---------------------------------------------------------------------------

    @SuppressLint("MissingPermission")
    private fun startLocationUpdates(idleOverride: Boolean) {
        if (::locationCallback.isInitialized) {
            fusedLocationClient.removeLocationUpdates(locationCallback)
        }

        val (priority, interval, distanceMeters) = if (idleOverride) {
            // Device is idle: cell-tower only, long interval, large gate.
            // GPS chip goes completely idle.
            Triple(Priority.PRIORITY_LOW_POWER, 30_000L, 50f)
        } else {
            Triple(activePriority(), config.updateIntervalMs, config.minDistanceMeters)
        }

        val locationRequest = LocationRequest.Builder(priority, interval)
            .setMinUpdateIntervalMillis(if (idleOverride) 30_000L else config.minUpdateIntervalMs)
            .setMinUpdateDistanceMeters(distanceMeters)
            // Batching: OS can hold fixes and deliver them together → fewer CPU wake-ups.
            .setMaxUpdateDelayMillis(interval * 2)
            .setGranularity(Granularity.GRANULARITY_PERMISSION_LEVEL)
            .build()

        locationCallback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                result.lastLocation?.let { handleLocation(it) }
            }

            override fun onLocationAvailability(availability: LocationAvailability) {
                if (!availability.isLocationAvailable) {
                    broadcastError(1, "Location is not available")
                }
            }
        }

        try {
            fusedLocationClient.requestLocationUpdates(locationRequest, locationCallback, mainLooper)
            log("Updates registered — idle=$idleOverride, priority=$priority, interval=${interval}ms, dist=${distanceMeters}m")
        } catch (e: SecurityException) {
            broadcastError(2, "Location permission denied: ${e.message}")
        }
    }

    // ---------------------------------------------------------------------------
    // Adaptive accuracy — speed-based GPS on/off switching
    // ---------------------------------------------------------------------------

    private fun handleLocation(location: android.location.Location) {
        if (config.adaptiveAccuracy) {
            evaluateMotionState(location)
        }
        broadcastLocation(location)
    }

    private fun evaluateMotionState(location: android.location.Location) {
        val speed = if (location.hasSpeed()) location.speed else 0f

        if (speed < config.idleSpeedThreshold) {
            slowReadingCount++
            if (!isIdle && slowReadingCount >= config.idleSampleCount) {
                isIdle = true
                slowReadingCount = 0
                log("Device idle — switching to LOW_POWER (GPS off)")
                startLocationUpdates(idleOverride = true)
            }
        } else {
            if (isIdle) {
                isIdle = false
                slowReadingCount = 0
                log("Movement detected — restoring ${config.accuracy} accuracy")
                startLocationUpdates(idleOverride = false)
            } else {
                slowReadingCount = 0
            }
        }
    }

    private fun activePriority(): Int = when (config.accuracy) {
        "navigation", "high" -> Priority.PRIORITY_HIGH_ACCURACY
        "low" -> Priority.PRIORITY_LOW_POWER
        else -> Priority.PRIORITY_BALANCED_POWER_ACCURACY
    }

    // ---------------------------------------------------------------------------
    // Broadcast helpers
    // ---------------------------------------------------------------------------

    private fun broadcastLocation(location: android.location.Location) {
        val locationJson = JSONObject().apply {
            put("latitude", location.latitude)
            put("longitude", location.longitude)
            put("accuracy", location.accuracy.toDouble())
            put("altitude", location.altitude)
            put("altitudeAccuracy", if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                location.verticalAccuracyMeters.toDouble() else -1.0)
            put("speed", if (location.hasSpeed()) location.speed.toDouble() else -1.0)
            put("bearing", if (location.hasBearing()) location.bearing.toDouble() else -1.0)
            put("timestamp", location.time)
            put("isStationary", isIdle)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                put("isFromMockProvider", location.isMock)
            }
        }.toString()

        log("Location: lat=${location.latitude}, lng=${location.longitude}, speed=${location.speed} m/s, idle=$isIdle")

        val localIntent = Intent(ACTION_LOCATION_UPDATE).apply {
            putExtra(EXTRA_LOCATION, locationJson)
        }
        LocalBroadcastManager.getInstance(this).sendBroadcast(localIntent)

        if (!GeoServiceModule.isReactContextActive && config.backgroundTaskName.isNotEmpty()) {
            startHeadlessTask(locationJson)
        }
    }

    private fun broadcastError(code: Int, message: String) {
        Log.e(TAG, "Location error [$code]: $message")
        val errorJson = JSONObject().apply {
            put("code", code)
            put("message", message)
        }.toString()
        val intent = Intent(ACTION_LOCATION_ERROR).apply {
            putExtra(EXTRA_ERROR, errorJson)
        }
        LocalBroadcastManager.getInstance(this).sendBroadcast(intent)
    }

    private fun startHeadlessTask(locationJson: String) {
        log("Starting background task: ${config.backgroundTaskName}")
        val intent = Intent(this, HeadlessLocationTask::class.java).apply {
            putExtra("location", locationJson)
            putExtra("taskName", config.backgroundTaskName)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
    }

    // ---------------------------------------------------------------------------
    // Notification
    // ---------------------------------------------------------------------------

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                "Location Tracking",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Background location tracking"
                setShowBadge(false)
                enableVibration(false)
                setSound(null, null)
            }
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, NOTIFICATION_CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        else
            PendingIntent.FLAG_UPDATE_CURRENT
        val pendingIntent = PendingIntent.getActivity(this, 0, launchIntent, pendingFlags)

        return builder
            .setContentTitle(config.serviceTitle)
            .setContentText(config.serviceBody)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .build()
    }

    // ---------------------------------------------------------------------------

    override fun onDestroy() {
        super.onDestroy()
        if (::locationCallback.isInitialized) {
            fusedLocationClient.removeLocationUpdates(locationCallback)
        }
        isRunning = false
        log("Service destroyed")
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun log(msg: String) {
        if (config.debug) Log.d(TAG, msg)
    }
}
