package com.privatefit

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/** JS control of [DeviceLinkService]: start while the app is in the foreground, update the text, stop. */
class DeviceLinkModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {

  override fun getName(): String = "DeviceLinkModule"

  @ReactMethod
  fun start(title: String, text: String, promise: Promise) {
    try {
      DeviceLinkService.start(ctx, title, text)
      promise.resolve(true)
    } catch (e: Exception) {
      // Android 12+ refuses a foreground service started from the background; the next foreground retries.
      promise.resolve(false)
    }
  }

  @ReactMethod
  fun update(title: String, text: String) {
    DeviceLinkService.update(ctx, title, text)
  }

  @ReactMethod
  fun stop() {
    DeviceLinkService.stop(ctx)
  }

  @ReactMethod
  fun isRunning(promise: Promise) {
    promise.resolve(DeviceLinkService.running)
  }
}
