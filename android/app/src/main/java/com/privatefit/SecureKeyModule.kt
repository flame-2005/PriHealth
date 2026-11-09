package com.privatefit

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Generates a random secret once and keeps it wrapped by an AES key that lives in the
 * Android Keystore (hardware-backed where available). Used as the SQLCipher passphrase.
 */
class SecureKeyModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {

  override fun getName(): String = "SecureKeyModule"

  private val prefs get() = ctx.getSharedPreferences("privatefit_secure", Context.MODE_PRIVATE)

  private fun keystoreKey(alias: String): SecretKey {
    val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    if (!ks.containsAlias(alias)) {
      val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
      gen.init(
        KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
          .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
          .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
          .setKeySize(256)
          .build()
      )
      gen.generateKey()
    }
    return ks.getKey(alias, null) as SecretKey
  }

  @ReactMethod
  fun getOrCreateKey(alias: String, promise: Promise) {
    try {
      val key = keystoreKey(alias)
      val stored = prefs.getString("k_$alias", null)
      if (stored != null) {
        val raw = Base64.decode(stored, Base64.NO_WRAP)
        val iv = raw.copyOfRange(0, 12)
        val ct = raw.copyOfRange(12, raw.size)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, iv))
        promise.resolve(String(cipher.doFinal(ct), Charsets.UTF_8))
        return
      }
      val secret = ByteArray(32).also { SecureRandom().nextBytes(it) }
      val hex = secret.joinToString("") { "%02x".format(it) }
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.ENCRYPT_MODE, key)
      val ct = cipher.doFinal(hex.toByteArray(Charsets.UTF_8))
      prefs.edit().putString("k_$alias", Base64.encodeToString(cipher.iv + ct, Base64.NO_WRAP)).apply()
      promise.resolve(hex)
    } catch (e: Exception) {
      promise.reject("SECURE_KEY", e.message, e)
    }
  }

  @ReactMethod
  fun deleteKey(alias: String, promise: Promise) {
    try {
      prefs.edit().remove("k_$alias").apply()
      val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
      if (ks.containsAlias(alias)) ks.deleteEntry(alias)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("SECURE_KEY", e.message, e)
    }
  }
}
