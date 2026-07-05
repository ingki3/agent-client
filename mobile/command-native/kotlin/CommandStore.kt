package dev.simplist.agentclient.mockup.command

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Native-readable mirror of the relay credentials.
 *
 * The JS side keeps deviceSecret in Expo SecureStore (Keystore-backed), which
 * native code cannot read. On login the app calls CommandBridgeModule.setCredentials
 * to mirror { relayBase, deviceSecret, deviceId } into EncryptedSharedPreferences,
 * so the background FCM command service can authenticate its result callbacks
 * even when no JS runtime is alive.
 */
object CommandStore {
  private const val PREFS = "agentclient_command_creds"

  private fun prefs(context: Context) = EncryptedSharedPreferences.create(
    context.applicationContext,
    PREFS,
    MasterKey.Builder(context.applicationContext).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
  )

  fun setCredentials(context: Context, relayBase: String, deviceSecret: String, deviceId: String) {
    prefs(context).edit()
      .putString("relayBase", relayBase)
      .putString("deviceSecret", deviceSecret)
      .putString("deviceId", deviceId)
      .apply()
  }

  fun clear(context: Context) {
    prefs(context).edit().clear().apply()
  }

  fun relayBase(context: Context): String? = prefs(context).getString("relayBase", null)
  fun deviceSecret(context: Context): String? = prefs(context).getString("deviceSecret", null)
  fun deviceId(context: Context): String? = prefs(context).getString("deviceId", null)
}
