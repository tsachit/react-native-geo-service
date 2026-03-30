package com.geoservice

import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

/**
 * Periodic watchdog that detects when the LocationService was killed by the OS
 * (common on Xiaomi, Samsung, Huawei with aggressive battery optimization) and
 * restarts it using the config persisted in SharedPreferences.
 *
 * Scheduled every 15 minutes (WorkManager minimum). If the service is already
 * running nothing happens. If tracking was expected but the service is dead,
 * it is restarted with the user's original config.
 */
class WatchdogWorker(
    private val appContext: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {

    companion object {
        const val TAG = "GeoService:Watchdog"
        const val WORK_NAME = "GeoServiceWatchdog"
    }

    override suspend fun doWork(): Result {
        val prefs = appContext.getSharedPreferences(
            BootReceiver.PREFS_NAME, Context.MODE_PRIVATE
        )
        val isTrackingExpected = prefs.getBoolean(BootReceiver.KEY_IS_TRACKING, false)

        if (!isTrackingExpected) {
            Log.d(TAG, "Tracking not expected — nothing to do")
            return Result.success()
        }

        if (LocationService.isRunning) {
            Log.d(TAG, "Service is running — no action needed")
            return Result.success()
        }

        Log.w(TAG, "Service not running but tracking was expected — restarting")

        val configJson = prefs.getString("configBundle", null)
        val serviceIntent = Intent(appContext, LocationService::class.java)

        if (configJson != null) {
            try {
                val json = org.json.JSONObject(configJson)
                val bundle = android.os.Bundle().apply {
                    putFloat("minDistanceMeters", json.optDouble("minDistanceMeters", 10.0).toFloat())
                    putString("accuracy", json.optString("accuracy", "balanced"))
                    putBoolean("stopOnAppClose", json.optBoolean("stopOnAppClose", false))
                    putBoolean("restartOnBoot", json.optBoolean("restartOnBoot", false))
                    putLong("updateIntervalMs", json.optLong("updateIntervalMs", 5000L))
                    putLong("minUpdateIntervalMs", json.optLong("minUpdateIntervalMs", 2000L))
                    putString("serviceTitle", json.optString("serviceTitle", "Location Tracking"))
                    putString("serviceBody", json.optString("serviceBody", "Your location is being tracked in the background."))
                    putString("backgroundTaskName", json.optString("backgroundTaskName", "GeoServiceHeadlessTask"))
                    putBoolean("adaptiveAccuracy", json.optBoolean("adaptiveAccuracy", true))
                    putFloat("idleSpeedThreshold", json.optDouble("idleSpeedThreshold", 0.5).toFloat())
                    putInt("idleSampleCount", json.optInt("idleSampleCount", 3))
                    putBoolean("debug", json.optBoolean("debug", false))
                }
                serviceIntent.putExtra("config", bundle)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to parse config — starting with defaults: ${e.message}")
            }
        }

        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                appContext.startForegroundService(serviceIntent)
            } else {
                appContext.startService(serviceIntent)
            }
            Log.d(TAG, "Service restarted successfully")
            Result.success()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to restart service: ${e.message}")
            Result.retry()
        }
    }
}
