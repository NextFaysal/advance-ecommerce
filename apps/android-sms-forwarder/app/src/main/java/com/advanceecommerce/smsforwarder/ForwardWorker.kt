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
 * Retry policy:
 *  - Network failure / server 5xx -> Result.retry() with exponential
 *    backoff (WorkManager). The queue is untouched, nothing is lost.
 *  - 401 (session expired — the token lives 7 days) or 403 (the account
 *    lacks payments.verify_manual) -> STOP: Result.failure(), status
 *    shown in the app. Retrying auth failures would just hammer the
 *    login-protected endpoint; a human must sign in again.
 *  - Success -> the sent items are removed from the queue and the
 *    outcome counts the server returned are saved as the status line.
 */
class ForwardWorker(context: Context, params: WorkerParameters) :
    CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val prefs = Prefs.get(applicationContext)
        val queue = QueueStore(applicationContext)

        val baseUrl = prefs.baseUrl
        val token = prefs.sessionToken
        if (baseUrl.isEmpty() || token.isEmpty()) {
            prefs.lastStatus = "Not signed in — open the app and sign in."
            return Result.failure()
        }

        val batch = queue.peek(BATCH_SIZE)
        if (batch.isEmpty()) return Result.success()

        return when (val result = ApiClient(baseUrl).ingestBatch(token, batch)) {
            is ApiClient.IngestResult.Ok -> {
                queue.remove(batch.map { it.dedupeKey }.toSet())
                prefs.lastForwardAtMillis = System.currentTimeMillis()
                prefs.lastStatus = "Forwarded ${batch.size} SMS (${result.summary})"
                // More than one batch queued? Chain the next one.
                if (queue.size() > 0) schedule(applicationContext)
                Result.success()
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
