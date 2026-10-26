package com.advanceecommerce.smsforwarder

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit

/**
 * Drains the local queue to the server in batches of up to 50 (the
 * server's batch cap — ingestSmsBatchSchema in
 * apps/web/src/bd/sms-ingestion.ts), via WorkManager so delivery
 * survives reboot, no network, and the app being swiped away.
 *
 * Credential: the per-device token when one is paired (primary), else
 * the legacy staff session token. See Prefs / ApiClient.
 *
 * Retry policy:
 *  - Network failure / server 5xx -> Result.retry() with exponential
 *    backoff (WorkManager). The queue is untouched, nothing is lost.
 *  - 401 on the DEVICE-TOKEN path (token revoked/invalid) -> TERMINAL:
 *    Result.failure(), the needs-repair flag is set, and every later
 *    run fails fast WITHOUT calling the server until a person pairs a
 *    fresh token. A revoked token must never become a retry loop
 *    hammering the ingest endpoint. The queue is kept — once
 *    re-paired, the waiting SMS forward normally.
 *  - 401 on the legacy session path (session expired — it lives 7
 *    days) or 403 (the account lacks payments.verify_manual) -> STOP:
 *    Result.failure(), status shown in the app; a human must sign in
 *    again.
 *  - Success -> the sent items are removed from the queue and the
 *    outcome counts the server returned are saved as the status line.
 */
class ForwardWorker(context: Context, params: WorkerParameters) :
    CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val prefs = Prefs.get(applicationContext)
        val queue = QueueStore(applicationContext)

        // A revoked/invalid device token is terminal until a person
        // re-pairs: fail fast, never touch the network. (The status
        // line was set when the 401 arrived; keep it as-is.)
        if (prefs.needsRepair) return Result.failure()

        val baseUrl = prefs.baseUrl
        val deviceToken = prefs.deviceToken
        val sessionToken = prefs.sessionToken
        if (baseUrl.isEmpty() || (deviceToken.isEmpty() && sessionToken.isEmpty())) {
            prefs.lastStatus =
                "Not paired — open the app and enter the device token from " +
                    "Admin → BD Tools → ডিভাইস টোকেন (or sign in with a staff account)."
            return Result.failure()
        }

        val batch = queue.peek(BATCH_SIZE)
        if (batch.isEmpty()) return Result.success()

        val client = ApiClient(baseUrl)
        val result = if (deviceToken.isNotEmpty()) {
            client.ingestBatchWithDeviceToken(deviceToken, batch)
        } else {
            client.ingestBatch(sessionToken, batch)
        }

        return when (result) {
            is ApiClient.IngestResult.Ok -> {
                queue.remove(batch.map { it.dedupeKey }.toSet())
                prefs.lastForwardAtMillis = System.currentTimeMillis()
                prefs.lastStatus = "Forwarded ${batch.size} SMS (${result.summary})"
                // More than one batch queued? Chain the next one.
                if (queue.size() > 0) schedule(applicationContext)
                Result.success()
            }
            ApiClient.IngestResult.DeviceTokenInvalid -> {
                // Terminal — do NOT retry, do NOT clear the queue.
                // Only a fresh token (paired by a person) resumes
                // forwarding; MainActivity clears this flag on pairing.
                prefs.needsRepair = true
                prefs.lastStatus = REPAIR_STATUS
                Result.failure()
            }
            ApiClient.IngestResult.Unauthorized -> {
                prefs.clearSession()
                prefs.lastStatus = "Session expired — sign in again to resume forwarding."
                Result.failure()
            }
            ApiClient.IngestResult.Forbidden -> {
                prefs.lastStatus =
                    "This staff account lacks the payments.verify_manual permission — forwarding paused."
                Result.failure()
            }
            is ApiClient.IngestResult.Failed -> {
                prefs.lastStatus = "Last attempt failed: ${result.message}"
                if (result.retryable) Result.retry() else Result.failure()
            }
        }
    }

    companion object {
        private const val WORK_NAME = "sms-forward"
        private const val BATCH_SIZE = 50

        /**
         * Shown (in MainActivity and here) when the device token is
         * rejected: the phone must be re-paired with a fresh token.
         * Shared so the worker and the UI never disagree.
         */
        const val REPAIR_STATUS =
            "টোকেন বাতিল/ভুল — আবার পেয়ার করুন। Device token revoked or invalid: " +
                "create a new token in Admin → BD Tools → ডিভাইস টোকেন and enter it in " +
                "the app. Forwarding is paused; queued SMS are kept, not lost."

        fun schedule(context: Context) {
            val request = OneTimeWorkRequestBuilder<ForwardWorker>()
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build(),
                )
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context)
                .enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.APPEND_OR_REPLACE, request)
        }
    }
}

/** "27 Oct 2026, 14:32" — for the status line in MainActivity. */
fun formatTimestamp(millis: Long): String =
    SimpleDateFormat("d MMM yyyy, HH:mm", Locale.ENGLISH).format(Date(millis))
