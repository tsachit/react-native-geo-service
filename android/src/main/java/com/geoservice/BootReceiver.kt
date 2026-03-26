package com.geoservice

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

/**
 * Restarts location tracking on device boot if restartOnBoot was enabled.
 *
 * The config is persisted to SharedPreferences by GeoServiceModule when start() is called.
 * This receiver reads it on boot and restarts the service if required.
 */
class BootReceiver : BroadcastReceiver() {

    companion object {
        const val TAG = "GeoService:BootReceiver"
        const val PREFS_NAME = "GeoServicePrefs"
        const val KEY_RESTART_ON_BOOT = "restartOnBoot"
        const val KEY_IS_TRACKING = "isTracking"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        if (action != Intent.ACTION_BOOT_COMPLETED &&
            action != "android.intent.action.QUICKBOOT_POWERON") {
            return
        }

        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val restartOnBoot = prefs.getBoolean(KEY_RESTART_ON_BOOT, false)
        val wasTracking = prefs.getBoolean(KEY_IS_TRACKING, false)

        if (!restartOnBoot || !wasTracking) {
            Log.d(TAG, "Skipping boot start: restartOnBoot=$restartOnBoot, wasTracking=$wasTracking")
            return
        }

        Log.d(TAG, "Device booted — restarting location service")

        val serviceIntent = Intent(context, LocationService::class.java)
        val configJson = prefs.getString("configBundle", null)
        if (configJson != null) {
            try {
                val json = org.json.JSONObject(configJson)
                val bundle = android.os.Bundle()
                bundle.putFloat("minDistanceMeters", json.optDouble("minDistanceMeters", 10.0).toFloat())
                bundle.putString("accuracy", json.optString("accuracy", "balanced"))
                bundle.putBoolean("stopOnAppClose", json.optBoolean("stopOnAppClose", false))
                bundle.putBoolean("restartOnBoot", json.optBoolean("restartOnBoot", false))
                bundle.putLong("updateIntervalMs", json.optLong("updateIntervalMs", 5000L))
                bundle.putLong("minUpdateIntervalMs", json.optLong("minUpdateIntervalMs", 2000L))
                bundle.putString("serviceTitle", json.optString("serviceTitle", "Location Tracking"))
                bundle.putString("serviceBody", json.optString("serviceBody", "Your location is being tracked in the background."))
                bundle.putString("backgroundTaskName", json.optString("backgroundTaskName", "GeoServiceHeadlessTask"))
                bundle.putBoolean("adaptiveAccuracy", json.optBoolean("adaptiveAccuracy", true))
                bundle.putFloat("idleSpeedThreshold", json.optDouble("idleSpeedThreshold", 0.5).toFloat())
                bundle.putInt("idleSampleCount", json.optInt("idleSampleCount", 3))
                bundle.putBoolean("debug", json.optBoolean("debug", false))
                serviceIntent.putExtra("config", bundle)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to parse persisted config: ${e.message}")
            }
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(serviceIntent)
        } else {
            context.startService(serviceIntent)
        }
    }
}
