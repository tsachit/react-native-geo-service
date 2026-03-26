package com.geoservice

import android.content.Intent
import android.os.Bundle
import android.util.Log
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import org.json.JSONObject

/**
 * HeadlessJS task service invoked by LocationService when no React context is active.
 *
 * This allows JavaScript code to run in the background (e.g. to save the location to
 * a server or local storage) even when the app UI is not visible.
 *
 * The user must register a matching headless task in their app's index.js:
 *
 *   AppRegistry.registerHeadlessTask('GeoServiceHeadlessTask', () => async (location) => {
 *     // handle background location update
 *   });
 */
class HeadlessLocationTask : HeadlessJsTaskService() {

    companion object {
        const val TAG = "GeoService:HeadlessTask"
        // Max time (ms) the headless task is allowed to run before the OS kills it.
        const val TIMEOUT_MS = 30_000L
    }

    override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
        val taskName = intent?.getStringExtra("taskName") ?: run {
            Log.w(TAG, "No taskName provided to HeadlessLocationTask")
            return null
        }
        val locationJson = intent.getStringExtra("location") ?: run {
            Log.w(TAG, "No location data provided to HeadlessLocationTask")
            return null
        }

        val extras = buildTaskExtras(locationJson) ?: run {
            Log.e(TAG, "Failed to parse location JSON")
            return null
        }

        Log.d(TAG, "Starting headless task: $taskName")
        return HeadlessJsTaskConfig(
            taskName,
            extras,
            TIMEOUT_MS,
            true // allow task to run in foreground (when app is visible too)
        )
    }

    private fun buildTaskExtras(locationJson: String): com.facebook.react.bridge.WritableMap? {
        return try {
            val json = JSONObject(locationJson)
            val map = Arguments.createMap()
            map.putDouble("latitude", json.getDouble("latitude"))
            map.putDouble("longitude", json.getDouble("longitude"))
            map.putDouble("accuracy", json.getDouble("accuracy"))
            map.putDouble("altitude", json.getDouble("altitude"))
            map.putDouble("altitudeAccuracy", json.getDouble("altitudeAccuracy"))
            map.putDouble("speed", json.getDouble("speed"))
            map.putDouble("bearing", json.getDouble("bearing"))
            map.putDouble("timestamp", json.getDouble("timestamp"))
            if (json.has("isFromMockProvider")) {
                map.putBoolean("isFromMockProvider", json.getBoolean("isFromMockProvider"))
            }
            map
        } catch (e: Exception) {
            Log.e(TAG, "Error building task extras: ${e.message}")
            null
        }
    }
}
