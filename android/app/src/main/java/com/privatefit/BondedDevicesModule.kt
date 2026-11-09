package com.privatefit

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.content.Context
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Lists the Bluetooth LE devices this phone is already paired with or holds a GATT connection to.
 * A watch that is connected to its vendor app stops advertising, so a scan alone never finds it;
 * the Devices screen offers these alongside scan results. This reads the phone's own Bluetooth
 * settings (BLUETOOTH_CONNECT) and nothing is written or sent anywhere.
 */
class BondedDevicesModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {

  override fun getName(): String = "BondedDevicesModule"

  /** Resolves [{ id, name, connected, serviceUuids }], connected devices first; [] without Bluetooth or permission. */
  @SuppressLint("MissingPermission")
  @ReactMethod
  fun list(promise: Promise) {
    val result = Arguments.createArray()
    try {
      val manager = ctx.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
      val adapter = manager?.adapter
      if (manager == null || adapter == null || !adapter.isEnabled) {
        promise.resolve(result)
        return
      }
      val connected = manager.getConnectedDevices(BluetoothProfile.GATT)
      val connectedAddresses = connected.map { it.address }.toSet()
      val seen = HashSet<String>()
      for (d in connected + adapter.bondedDevices) {
        if (!seen.add(d.address)) continue
        // A classic-only entry (a watch's phone-call profile, headphones) has no GATT to read.
        if (d.type == BluetoothDevice.DEVICE_TYPE_CLASSIC) continue
        val map = Arguments.createMap()
        map.putString("id", d.address)
        map.putString("name", d.name)
        map.putBoolean("connected", d.address in connectedAddresses)
        val uuids = Arguments.createArray()
        d.uuids?.forEach { uuids.pushString(it.uuid.toString()) }
        map.putArray("serviceUuids", uuids)
        result.pushMap(map)
      }
      promise.resolve(result)
    } catch (e: SecurityException) {
      // Nearby-devices permission not granted; the screen asks for it before scanning anyway.
      promise.resolve(Arguments.createArray())
    }
  }
}
