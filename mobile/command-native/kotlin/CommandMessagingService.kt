package dev.simplist.agentclient.mockup.command

import android.util.Log
import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.service.ExpoFirebaseMessagingService

/**
 * FCM entry point for the phone-command pipe.
 *
 * Extends Expo's messaging service so that ALL non-command messages (the app's
 * user-visible chat push notifications) keep flowing through Expo unchanged via
 * super.onMessageReceived. We only intercept DATA-ONLY command messages (those
 * carrying a "tool" key) and execute them natively — this runs even when the app
 * is backgrounded or swiped away, with no JS runtime and no banner.
 *
 * Registered in AndroidManifest.xml BEFORE Expo's service so Firebase dispatches
 * to us first.
 */
class CommandMessagingService : ExpoFirebaseMessagingService() {
  override fun onMessageReceived(remoteMessage: RemoteMessage) {
    val tool = remoteMessage.data["tool"]
    if (tool.isNullOrEmpty()) {
      // Not our command — let Expo handle notifications as before.
      super.onMessageReceived(remoteMessage)
      return
    }
    val correlationId = remoteMessage.data["correlationId"] ?: ""
    val args = remoteMessage.data["args"] ?: "{}"
    Log.i("CommandMessagingService", "command received tool=$tool corr=$correlationId")
    try {
      CommandExecutor.execute(applicationContext, tool, correlationId, args)
    } catch (e: Exception) {
      Log.e("CommandMessagingService", "command failed: ${e.message}")
      if (correlationId.isNotEmpty()) {
        CommandExecutor.reportError(applicationContext, correlationId, "exception:${e.message}")
      }
    }
  }
}
