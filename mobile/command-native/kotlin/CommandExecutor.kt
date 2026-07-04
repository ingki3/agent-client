package dev.simplist.agentclient.mockup.command

import android.content.Context
import android.util.Log
import org.json.JSONObject

/**
 * Dispatches a relay-issued command to its native handler and reports the result
 * back to the relay. Runs on the FCM background thread — keep each handler
 * synchronous and bounded.
 *
 * Phase 0: only "ping" (spike, replies to /debug/echo).
 * Phase 1+: real tools reply to /command/result with { correlationId, ok, result }.
 */
object CommandExecutor {
  private const val TAG = "CommandExecutor"

  fun execute(context: Context, tool: String, correlationId: String, argsJson: String) {
    Log.i(TAG, "execute tool=$tool corr=$correlationId")
    when (tool) {
      "ping" -> {
        RelayClient.post(context, "/debug/echo", JSONObject().put("correlationId", correlationId).put("note", "pong"))
      }
      else -> {
        reportError(context, correlationId, "unknown_tool:$tool")
      }
    }
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
