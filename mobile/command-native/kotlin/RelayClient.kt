package dev.simplist.agentclient.mockup.command

import android.content.Context
import android.util.Log
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Minimal OkHttp poster used by the background command service to call the relay
 * with the mirrored device credentials. Synchronous by design — it runs inside
 * FirebaseMessagingService.onMessageReceived (already off the main thread) and
 * must finish before the process may be reclaimed.
 */
object RelayClient {
  private const val TAG = "CommandRelayClient"
  private val JSON = "application/json; charset=utf-8".toMediaType()
  private val client = OkHttpClient.Builder()
    .connectTimeout(10, TimeUnit.SECONDS)
    .readTimeout(15, TimeUnit.SECONDS)
    .build()

  /** POST a JSON body to `path` with Bearer <deviceSecret>. Returns true on 2xx. */
  fun post(context: Context, path: String, body: JSONObject): Boolean {
    val base = CommandStore.relayBase(context)
    val secret = CommandStore.deviceSecret(context)
    val deviceId = CommandStore.deviceId(context)
    if (base.isNullOrEmpty() || secret.isNullOrEmpty() || deviceId.isNullOrEmpty()) {
      Log.w(TAG, "missing credentials; cannot POST $path")
      return false
    }
    body.put("deviceId", deviceId)
    val req = Request.Builder()
      .url(base.trimEnd('/') + path)
      .addHeader("Authorization", "Bearer $secret")
      .post(body.toString().toRequestBody(JSON))
      .build()
    return try {
      client.newCall(req).execute().use { res ->
        if (!res.isSuccessful) Log.w(TAG, "POST $path -> ${res.code}")
        res.isSuccessful
      }
    } catch (e: Exception) {
      Log.w(TAG, "POST $path failed: ${e.message}")
      false
    }
  }
}
