package com.privatefit

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class PrivateFitPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(
      StepCounterModule(reactContext),
      SecureKeyModule(reactContext),
      ExportFileModule(reactContext),
      BondedDevicesModule(reactContext),
      DeviceLinkModule(reactContext),
      NotificationRelayModule(reactContext),
    )

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
