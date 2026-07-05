package dev.simplist.agentclient.mockup.command

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Geocoder
import android.util.Log
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import com.google.android.gms.tasks.Tasks
import org.json.JSONObject
import java.util.Locale
import java.util.concurrent.TimeUnit

/**
 * Dispatches a relay-issued command to its native handler and reports the result
 * back to the relay. Runs on the FCM background thread — each handler is
 * synchronous and bounded (the process may be reclaimed once onMessageReceived
 * returns).
 *
 * Phase 0: "ping" (spike). Phase 1: "get_location".
 */
object CommandExecutor {
  private const val TAG = "CommandExecutor"

  fun execute(context: Context, tool: String, correlationId: String, argsJson: String) {
    Log.i(TAG, "execute tool=$tool corr=$correlationId")
    when (tool) {
      "ping" -> RelayClient.post(
        context,
        "/debug/echo",
        JSONObject().put("correlationId", correlationId).put("note", "pong"),
      )
      "get_location" -> handleGetLocation(context, correlationId)
      else -> reportError(context, correlationId, "unknown_tool:$tool")
    }
  }

  private fun handleGetLocation(context: Context, correlationId: String) {
    val fine = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION)
    val coarse = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION)
    if (fine != PackageManager.PERMISSION_GRANTED && coarse != PackageManager.PERMISSION_GRANTED) {
      reportError(context, correlationId, "location_permission_denied")
      return
    }
    val client = LocationServices.getFusedLocationProviderClient(context)
    val cts = CancellationTokenSource()
    val location = try {
      @Suppress("MissingPermission")
      Tasks.await(client.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, cts.token), 20, TimeUnit.SECONDS)
    } catch (e: Exception) {
      Log.w(TAG, "getCurrentLocation failed: ${e.message}")
      null
    }
    if (location == null) {
      reportError(context, correlationId, "location_unavailable")
      return
    }
    val result = JSONObject()
      .put("lat", location.latitude)
      .put("lon", location.longitude)
      .put("accuracy", location.accuracy.toDouble())
    val address = try {
      @Suppress("DEPRECATION")
      Geocoder(context, Locale.KOREA)
        .getFromLocation(location.latitude, location.longitude, 1)
        ?.firstOrNull()
        ?.getAddressLine(0)
    } catch (e: Exception) {
      null
    }
    if (address != null) result.put("address", address)
    reportResult(context, correlationId, result)
  }

  /** Report a successful tool result to /command/result. */
  fun reportResult(context: Context, correlationId: String, result: JSONObject) {
    RelayClient.post(
      context,
      "/command/result",
      JSONObject().put("correlationId", correlationId).put("ok", true).put("result", result),
    )
  }

  /** Report a tool failure to /command/result. */
  fun reportError(context: Context, correlationId: String, error: String) {
    RelayClient.post(
      context,
      "/command/result",
      JSONObject().put("correlationId", correlationId).put("ok", false).put("error", error),
    )
  }
}
