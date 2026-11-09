package com.privatefit

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Exposes the hardware step counter (cumulative since boot). No data leaves the process;
 * JS diffs successive readings and attributes them to days.
 */
class StepCounterModule(private val ctx: ReactApplicationContext) :
    ReactContextBaseJavaModule(ctx), SensorEventListener {

  private val sensorManager = ctx.getSystemService(Context.SENSOR_SERVICE) as SensorManager
  private val sensor: Sensor? = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)
  private val mainHandler = Handler(Looper.getMainLooper())
  private var pendingRead: Promise? = null
  private var listening = false

  /** Goes up by one on every boot. Unlike the boot timestamp below, it does not move when the clock is changed. */
  private val bootCount: Int? by lazy {
    try {
      Settings.Global.getInt(ctx.contentResolver, Settings.Global.BOOT_COUNT)
    } catch (e: Exception) {
      null
    }
  }

  override fun getName(): String = "StepCounterModule"

  @ReactMethod
  fun isAvailable(promise: Promise) {
    promise.resolve(sensor != null)
  }

  /** One-shot read: resolves with the next sensor event, or null after 3 s. */
  @ReactMethod
  fun read(promise: Promise) {
    val s = sensor
    if (s == null) {
      promise.resolve(null)
      return
    }
    synchronized(this) {
      if (pendingRead != null) {
        promise.resolve(null)
        return
      }
      pendingRead = promise
    }
    sensorManager.registerListener(this, s, SensorManager.SENSOR_DELAY_FASTEST)
    mainHandler.postDelayed({
      var toResolve: Promise? = null
      synchronized(this) {
        if (pendingRead === promise) {
          toResolve = pendingRead
          pendingRead = null
        }
      }
      toResolve?.let {
        it.resolve(null)
        if (!listening) sensorManager.unregisterListener(this)
      }
    }, 3000)
  }

  @ReactMethod
  fun startListening() {
    val s = sensor ?: return
    if (listening) return
    listening = true
    sensorManager.registerListener(this, s, SensorManager.SENSOR_DELAY_NORMAL)
  }

  @ReactMethod
  fun stopListening() {
    listening = false
    if (pendingRead == null) sensorManager.unregisterListener(this)
  }

  // Required by NativeEventEmitter on the JS side.
  @ReactMethod fun addListener(eventName: String) {}
  @ReactMethod fun removeListeners(count: Int) {}

  private fun readingMap(event: SensorEvent): WritableMap {
    val map = Arguments.createMap()
    map.putDouble("count", event.values[0].toDouble())
    map.putDouble("bootTimeMs", (System.currentTimeMillis() - SystemClock.elapsedRealtime()).toDouble())
    map.putDouble("atMs", System.currentTimeMillis().toDouble())
    bootCount?.let { map.putInt("bootCount", it) }
    return map
  }

  override fun onSensorChanged(event: SensorEvent) {
    if (event.sensor.type != Sensor.TYPE_STEP_COUNTER) return
    var toResolve: Promise? = null
    synchronized(this) {
      if (pendingRead != null) {
        toResolve = pendingRead
        pendingRead = null
      }
    }
    toResolve?.let {
      it.resolve(readingMap(event))
      if (!listening) sensorManager.unregisterListener(this)
    }
    if (listening && ctx.hasActiveReactInstance()) {
      ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit("StepCounterUpdate", readingMap(event))
    }
  }

  override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

  override fun invalidate() {
    sensorManager.unregisterListener(this)
    super.invalidate()
  }
}
