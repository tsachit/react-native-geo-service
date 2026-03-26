package com.geoservice

import android.os.Bundle

data class GeoServiceConfig(
    val minDistanceMeters: Float = 10f,
    val accuracy: String = "balanced",
    val stopOnAppClose: Boolean = false,
    val restartOnBoot: Boolean = false,
    val updateIntervalMs: Long = 5000L,
    val minUpdateIntervalMs: Long = 2000L,
    val serviceTitle: String = "Location Tracking",
    val serviceBody: String = "Your location is being tracked in the background.",
    val backgroundTaskName: String = "GeoServiceHeadlessTask",
    val adaptiveAccuracy: Boolean = true,
    val idleSpeedThreshold: Float = 0.5f,
    val idleSampleCount: Int = 3,
    val debug: Boolean = false
) {
    fun toBundle(): Bundle = Bundle().apply {
        putFloat("minDistanceMeters", minDistanceMeters)
        putString("accuracy", accuracy)
        putBoolean("stopOnAppClose", stopOnAppClose)
        putBoolean("restartOnBoot", restartOnBoot)
        putLong("updateIntervalMs", updateIntervalMs)
        putLong("minUpdateIntervalMs", minUpdateIntervalMs)
        putString("serviceTitle", serviceTitle)
        putString("serviceBody", serviceBody)
        putString("backgroundTaskName", backgroundTaskName)
        putBoolean("adaptiveAccuracy", adaptiveAccuracy)
        putFloat("idleSpeedThreshold", idleSpeedThreshold)
        putInt("idleSampleCount", idleSampleCount)
        putBoolean("debug", debug)
    }

    companion object {
        fun fromBundle(bundle: Bundle?): GeoServiceConfig {
            if (bundle == null) return GeoServiceConfig()
            return GeoServiceConfig(
                minDistanceMeters = bundle.getFloat("minDistanceMeters", 10f),
                accuracy = bundle.getString("accuracy", "balanced") ?: "balanced",
                stopOnAppClose = bundle.getBoolean("stopOnAppClose", false),
                restartOnBoot = bundle.getBoolean("restartOnBoot", false),
                updateIntervalMs = bundle.getLong("updateIntervalMs", 5000L),
                minUpdateIntervalMs = bundle.getLong("minUpdateIntervalMs", 2000L),
                serviceTitle = bundle.getString("serviceTitle", "Location Tracking") ?: "Location Tracking",
                serviceBody = bundle.getString("serviceBody", "Your location is being tracked in the background.") ?: "Your location is being tracked in the background.",
                backgroundTaskName = bundle.getString("backgroundTaskName", "GeoServiceHeadlessTask") ?: "GeoServiceHeadlessTask",
                adaptiveAccuracy = bundle.getBoolean("adaptiveAccuracy", true),
                idleSpeedThreshold = bundle.getFloat("idleSpeedThreshold", 0.5f),
                idleSampleCount = bundle.getInt("idleSampleCount", 3),
                debug = bundle.getBoolean("debug", false)
            )
        }
    }
}
