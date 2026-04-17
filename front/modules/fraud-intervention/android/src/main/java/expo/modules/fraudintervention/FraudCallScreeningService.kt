package expo.modules.fraudintervention

import android.content.Context
import android.net.Uri
import android.telecom.Call
import android.telecom.CallScreeningService
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.os.bundleOf
import org.json.JSONObject
import java.io.BufferedReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

class FraudCallScreeningService : CallScreeningService() {
  override fun onScreenCall(callDetails: Call.Details) {
    val phoneNumber = callDetails.handle?.schemeSpecificPart ?: "unknown"
    val risk = lookupBackendRisk(phoneNumber) ?: evaluateNumber(phoneNumber)
    val callId = UUID.randomUUID().toString()

    FraudInterventionRegistry.emitIncomingRisk(
      bundleOf(
        "callId" to callId,
        "phoneNumber" to phoneNumber,
        "riskLevel" to risk.level,
        "labels" to risk.labels.toTypedArray(),
        "message" to risk.message,
        "suggestedAction" to "manual_recording"
      )
    )

    if (risk.level != "low") {
      showIncomingWarningNotification(
        context = this,
        callId = callId,
        riskLevel = risk.level,
        phoneNumber = phoneNumber,
        message = risk.message
      )
      if (FraudCallDetectionHelper.canDrawOverlays(this)) {
        FraudOverlayController.showRiskWarningOverlay(this, callId, risk.level, phoneNumber, risk.message)
      }
    }

    respondToCall(
      callDetails,
      CallResponse.Builder()
        .setDisallowCall(false)
        .setRejectCall(false)
        .setSilenceCall(false)
        .setSkipCallLog(false)
        .setSkipNotification(false)
        .build()
    )
  }

  private fun lookupBackendRisk(phoneNumber: String): RiskResult? {
    val baseUrl = FraudRuntimeConfig.getLookupBaseUrl(this) ?: return null
    val connection =
      (URL("${baseUrl.trimEnd('/')}/api/call-intervention/risk/lookup-number").openConnection() as? HttpURLConnection)
        ?: return null

    return try {
      connection.requestMethod = "POST"
      connection.connectTimeout = 1500
      connection.readTimeout = 1500
      connection.doOutput = true
      connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
      connection.setRequestProperty("Accept", "application/json")

      OutputStreamWriter(connection.outputStream, Charsets.UTF_8).use { writer ->
        writer.write(JSONObject().put("phone_number", phoneNumber).toString())
      }

      if (connection.responseCode !in 200..299) {
        return null
      }

      val body = connection.inputStream.bufferedReader(Charsets.UTF_8).use(BufferedReader::readText)
      if (body.isBlank()) {
        return null
      }
      parseRiskResult(body)
    } catch (_: Exception) {
      null
    } finally {
      connection.disconnect()
    }
  }

  private fun parseRiskResult(body: String): RiskResult? {
    val json = JSONObject(body)
    val level = json.optString("risk_level").trim()
    if (level.isBlank()) {
      return null
    }

    val labels = buildList {
      val array = json.optJSONArray("labels")
      if (array != null) {
        for (index in 0 until array.length()) {
          val value = array.optString(index).trim()
          if (value.isNotBlank()) {
            add(value)
          }
        }
      }
    }

    val message = json.optString("suggestion").trim().ifBlank {
      json.optString("message").trim().ifBlank { "检测到异常来电，建议谨慎接听" }
    }

    return RiskResult(level, labels, message)
  }

  private fun evaluateNumber(phoneNumber: String): RiskResult {
    val normalized = phoneNumber.replace(Regex("[^0-9+]"), "")
    return when {
      normalized.startsWith("170") ||
        normalized.startsWith("171") ||
        normalized.startsWith("+86170") ||
        normalized.startsWith("+86171") ->
        RiskResult(
          "high",
          listOf("高频营销号段", "虚拟运营商"),
          "疑似诈骗来电，请勿透露验证码，建议立即开始录音取证。"
        )

      normalized.startsWith("95") || normalized.startsWith("+8695") ->
        RiskResult(
          "medium",
          listOf("客服号段", "需人工核验"),
          "号码存在营销或客服特征，建议先核验身份。"
        )

      normalized.startsWith("+44") ||
        normalized.startsWith("+60") ||
        normalized.startsWith("+84") ||
        normalized.startsWith("+63") ->
        RiskResult("medium", listOf("境外来电"), "检测到境外来电，建议先核验身份再继续通话。")

      else -> RiskResult("low", emptyList(), "暂未命中高风险号码特征")
    }
  }

  data class RiskResult(val level: String, val labels: List<String>, val message: String)

  companion object {
    fun showIncomingWarningNotification(
      context: Context,
      callId: String?,
      riskLevel: String,
      phoneNumber: String?,
      message: String
    ) {
      FraudNotificationHelper.ensureChannels(context)
      val notification = NotificationCompat.Builder(context, FraudNotificationHelper.WARNING_CHANNEL_ID)
        .setSmallIcon(android.R.drawable.stat_sys_warning)
        .setContentTitle(if (riskLevel == "high") "疑似诈骗来电" else "来电风险提醒")
        .setContentText(message)
        .setStyle(NotificationCompat.BigTextStyle().bigText(message))
        .setPriority(NotificationCompat.PRIORITY_MAX)
        .setCategory(NotificationCompat.CATEGORY_CALL)
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        .setAutoCancel(true)
        .setContentIntent(PendingIntentFactory.launchApp(context, callId, riskLevel, phoneNumber))
        .build()
      NotificationManagerCompat.from(context).notify(FraudNotificationHelper.WARNING_NOTIFICATION_ID, notification)
    }
  }
}

object PendingIntentFactory {
  fun launchApp(
    context: Context,
    callId: String?,
    riskLevel: String?,
    phoneNumber: String?
  ): android.app.PendingIntent {
    val deepLink = Uri.parse(
      buildString {
        append("myapp://call-intervention")
        val query = mutableListOf<String>()
        if (!callId.isNullOrBlank()) query += "callId=$callId"
        if (!riskLevel.isNullOrBlank()) query += "riskLevel=$riskLevel"
        if (!phoneNumber.isNullOrBlank()) query += "phoneNumber=$phoneNumber"
        if (query.isNotEmpty()) append("?${query.joinToString("&")}")
      }
    )
    val intent = android.content.Intent(android.content.Intent.ACTION_VIEW, deepLink).apply {
      addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK or android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP)
      setPackage(context.packageName)
    }
    val flags =
      android.app.PendingIntent.FLAG_UPDATE_CURRENT or
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
          android.app.PendingIntent.FLAG_IMMUTABLE
        } else {
          0
        }
    return android.app.PendingIntent.getActivity(context, 11, intent, flags)
  }
}
