package dev.simplist.agentclient.mockup.command

import android.Manifest
import android.content.ContentResolver
import android.content.ContentUris
import android.content.Context
import android.content.pm.PackageManager
import android.os.Bundle
import android.location.Geocoder
import android.net.Uri
import android.os.Build
import android.provider.ContactsContract
import android.provider.MediaStore
import android.telephony.SmsManager
import android.util.Base64
import android.util.Log
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import com.google.android.gms.tasks.Tasks
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale
import java.util.concurrent.TimeUnit

/**
 * Dispatches a relay-issued command to its native handler and reports the result
 * back to the relay. Runs on the FCM background thread — each handler is
 * synchronous and bounded (the process may be reclaimed once onMessageReceived
 * returns).
 *
 * Phase 0: "ping". Phase 1: "get_location". Phase 2 (SENSE): read_sms,
 * find_contact, list_media, fetch_media.
 */
object CommandExecutor {
  private const val TAG = "CommandExecutor"
  private const val MAX_FETCH_BYTES = 8 * 1024 * 1024 // fetch_media cap

  fun execute(context: Context, tool: String, correlationId: String, argsJson: String) {
    Log.i(TAG, "execute tool=$tool corr=$correlationId")
    val args = try {
      JSONObject(argsJson)
    } catch (e: Exception) {
      JSONObject()
    }
    when (tool) {
      "ping" -> RelayClient.post(
        context,
        "/debug/echo",
        JSONObject().put("correlationId", correlationId).put("note", "pong"),
      )
      "get_location" -> handleGetLocation(context, correlationId)
      "read_sms" -> handleReadSms(context, correlationId, args)
      "find_contact" -> handleFindContact(context, correlationId, args)
      "list_media" -> handleListMedia(context, correlationId, args)
      "fetch_media" -> handleFetchMedia(context, correlationId, args)
      "send_sms" -> handleSendSms(context, correlationId, args)
      else -> reportError(context, correlationId, "unknown_tool:$tool")
    }
  }

  private fun hasPerm(context: Context, perm: String): Boolean =
    ContextCompat.checkSelfPermission(context, perm) == PackageManager.PERMISSION_GRANTED

  private fun handleGetLocation(context: Context, correlationId: String) {
    if (!hasPerm(context, Manifest.permission.ACCESS_FINE_LOCATION) &&
      !hasPerm(context, Manifest.permission.ACCESS_COARSE_LOCATION)
    ) {
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

  private fun handleReadSms(context: Context, correlationId: String, args: JSONObject) {
    if (!hasPerm(context, Manifest.permission.READ_SMS)) {
      reportError(context, correlationId, "sms_permission_denied")
      return
    }
    val limit = args.optInt("limit", 20).coerceIn(1, 100)
    val address = args.optString("address", "").trim()
    val messages = JSONArray()
    try {
      val uri = Uri.parse("content://sms")
      val projection = arrayOf("address", "body", "date", "type")
      val selection = if (address.isNotEmpty()) "address LIKE ?" else null
      val selArgs = if (address.isNotEmpty()) arrayOf("%$address%") else null
      context.contentResolver.query(uri, projection, selection, selArgs, "date DESC LIMIT $limit")?.use { c ->
        val iA = c.getColumnIndex("address")
        val iB = c.getColumnIndex("body")
        val iD = c.getColumnIndex("date")
        val iT = c.getColumnIndex("type")
        while (c.moveToNext()) {
          messages.put(
            JSONObject()
              .put("address", if (iA >= 0) c.getString(iA) else null)
              .put("body", if (iB >= 0) c.getString(iB) else null)
              .put("date", if (iD >= 0) c.getLong(iD) else 0)
              .put("type", if (iT >= 0 && c.getInt(iT) == 2) "sent" else "inbox"),
          )
        }
      }
    } catch (e: Exception) {
      reportError(context, correlationId, "sms_query_failed:${e.message}")
      return
    }
    reportResult(context, correlationId, JSONObject().put("messages", messages))
  }

  private fun handleFindContact(context: Context, correlationId: String, args: JSONObject) {
    if (!hasPerm(context, Manifest.permission.READ_CONTACTS)) {
      reportError(context, correlationId, "contacts_permission_denied")
      return
    }
    val name = args.optString("name", "").trim()
    if (name.isEmpty()) {
      reportError(context, correlationId, "missing_name")
      return
    }
    val contacts = JSONArray()
    try {
      val projection = arrayOf(
        ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
        ContactsContract.CommonDataKinds.Phone.NUMBER,
      )
      context.contentResolver.query(
        ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
        projection,
        "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} LIKE ?",
        arrayOf("%$name%"),
        "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} ASC LIMIT 25",
      )?.use { c ->
        val iN = c.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME)
        val iP = c.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER)
        while (c.moveToNext()) {
          contacts.put(
            JSONObject()
              .put("name", if (iN >= 0) c.getString(iN) else null)
              .put("number", if (iP >= 0) c.getString(iP) else null),
          )
        }
      }
    } catch (e: Exception) {
      reportError(context, correlationId, "contacts_query_failed:${e.message}")
      return
    }
    reportResult(context, correlationId, JSONObject().put("contacts", contacts))
  }

  private fun mediaReadPermission(): String =
    if (Build.VERSION.SDK_INT >= 33) Manifest.permission.READ_MEDIA_IMAGES
    else Manifest.permission.READ_EXTERNAL_STORAGE

  private fun handleListMedia(context: Context, correlationId: String, args: JSONObject) {
    val type = args.optString("type", "image")
    val perm = if (type == "video" && Build.VERSION.SDK_INT >= 33)
      Manifest.permission.READ_MEDIA_VIDEO else mediaReadPermission()
    if (!hasPerm(context, perm)) {
      reportError(context, correlationId, "media_permission_denied")
      return
    }
    val limit = args.optInt("limit", 20).coerceIn(1, 100)
    val baseUri = if (type == "video") MediaStore.Video.Media.EXTERNAL_CONTENT_URI
    else MediaStore.Images.Media.EXTERNAL_CONTENT_URI
    val items = JSONArray()
    try {
      val projection = arrayOf(
        MediaStore.MediaColumns._ID,
        MediaStore.MediaColumns.DISPLAY_NAME,
        MediaStore.MediaColumns.MIME_TYPE,
        MediaStore.MediaColumns.SIZE,
        MediaStore.MediaColumns.DATE_ADDED,
      )
      // MediaStore on API 30+ rejects "LIMIT" in the sort string — use QUERY_ARG_*.
      val queryArgs = Bundle().apply {
        putStringArray(ContentResolver.QUERY_ARG_SORT_COLUMNS, arrayOf(MediaStore.MediaColumns.DATE_ADDED))
        putInt(ContentResolver.QUERY_ARG_SORT_DIRECTION, ContentResolver.QUERY_SORT_DIRECTION_DESCENDING)
        putInt(ContentResolver.QUERY_ARG_LIMIT, limit)
      }
      context.contentResolver.query(baseUri, projection, queryArgs, null)?.use { c ->
        val iId = c.getColumnIndex(MediaStore.MediaColumns._ID)
        val iName = c.getColumnIndex(MediaStore.MediaColumns.DISPLAY_NAME)
        val iMime = c.getColumnIndex(MediaStore.MediaColumns.MIME_TYPE)
        val iSize = c.getColumnIndex(MediaStore.MediaColumns.SIZE)
        val iDate = c.getColumnIndex(MediaStore.MediaColumns.DATE_ADDED)
        while (c.moveToNext()) {
          val id = c.getLong(iId)
          val ref = ContentUris.withAppendedId(baseUri, id).toString()
          items.put(
            JSONObject()
              .put("ref", ref)
              .put("name", if (iName >= 0) c.getString(iName) else null)
              .put("mime", if (iMime >= 0) c.getString(iMime) else null)
              .put("size", if (iSize >= 0) c.getLong(iSize) else 0)
              .put("dateAdded", if (iDate >= 0) c.getLong(iDate) else 0),
          )
        }
      }
    } catch (e: Exception) {
      reportError(context, correlationId, "media_query_failed:${e.message}")
      return
    }
    reportResult(context, correlationId, JSONObject().put("items", items))
  }

  private fun handleFetchMedia(context: Context, correlationId: String, args: JSONObject) {
    if (!hasPerm(context, mediaReadPermission()) &&
      !(Build.VERSION.SDK_INT >= 33 && hasPerm(context, Manifest.permission.READ_MEDIA_VIDEO))
    ) {
      reportError(context, correlationId, "media_permission_denied")
      return
    }
    val ref = args.optString("ref", "").trim()
    if (ref.isEmpty()) {
      reportError(context, correlationId, "missing_ref")
      return
    }
    try {
      val uri = Uri.parse(ref)
      var mime: String? = null
      var name: String? = null
      context.contentResolver.query(uri, arrayOf(MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.MIME_TYPE, MediaStore.MediaColumns.SIZE), null, null, null)?.use { c ->
        if (c.moveToFirst()) {
          val iName = c.getColumnIndex(MediaStore.MediaColumns.DISPLAY_NAME)
          val iMime = c.getColumnIndex(MediaStore.MediaColumns.MIME_TYPE)
          val iSize = c.getColumnIndex(MediaStore.MediaColumns.SIZE)
          if (iName >= 0) name = c.getString(iName)
          if (iMime >= 0) mime = c.getString(iMime)
          if (iSize >= 0 && c.getLong(iSize) > MAX_FETCH_BYTES) {
            reportError(context, correlationId, "media_too_large")
            return
          }
        }
      }
      val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
      if (bytes == null) {
        reportError(context, correlationId, "media_unreadable")
        return
      }
      if (bytes.size > MAX_FETCH_BYTES) {
        reportError(context, correlationId, "media_too_large")
        return
      }
      val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
      reportResult(
        context,
        correlationId,
        JSONObject().put("mime", mime).put("name", name).put("base64", b64),
      )
    } catch (e: Exception) {
      reportError(context, correlationId, "media_fetch_failed:${e.message}")
    }
  }

  private fun handleSendSms(context: Context, correlationId: String, args: JSONObject) {
    if (!hasPerm(context, Manifest.permission.SEND_SMS)) {
      reportError(context, correlationId, "sms_send_permission_denied")
      return
    }
    val to = args.optString("to", "").trim()
    val body = args.optString("body", "")
    if (to.isEmpty() || body.isEmpty()) {
      reportError(context, correlationId, "missing_to_or_body")
      return
    }
    try {
      val sms = context.getSystemService(SmsManager::class.java)
      val parts = sms.divideMessage(body)
      if (parts.size > 1) {
        sms.sendMultipartTextMessage(to, null, parts, null, null)
      } else {
        sms.sendTextMessage(to, null, body, null, null)
      }
      reportResult(context, correlationId, JSONObject().put("sent", true).put("to", to).put("parts", parts.size))
    } catch (e: Exception) {
      reportError(context, correlationId, "sms_send_failed:${e.message}")
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
