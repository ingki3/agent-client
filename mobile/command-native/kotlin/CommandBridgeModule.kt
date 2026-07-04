package dev.simplist.agentclient.mockup.command

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.google.firebase.messaging.FirebaseMessaging

/**
 * JS→native bridge for the command pipe. Foreground-only (runs in the RN
 * context): the app calls setCredentials on login to mirror the relay
 * credentials into native storage, and getFcmToken to register the raw FCM
 * token with the relay.
 */
class CommandBridgeModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "CommandBridge"

  @ReactMethod
  fun setCredentials(relayBase: String, deviceSecret: String, deviceId: String, promise: Promise) {
    try {
      CommandStore.setCredentials(reactContext, relayBase, deviceSecret, deviceId)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("set_credentials_failed", e)
    }
  }

  @ReactMethod
  fun clearCredentials(promise: Promise) {
    try {
      CommandStore.clear(reactContext)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("clear_credentials_failed", e)
    }
  }

  @ReactMethod
  fun getFcmToken(promise: Promise) {
    FirebaseMessaging.getInstance().token
      .addOnSuccessListener { token -> promise.resolve(token) }
      .addOnFailureListener { e -> promise.reject("fcm_token_failed", e) }
  }
}
