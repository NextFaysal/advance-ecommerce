package com.advanceecommerce.smsforwarder

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.time.Instant

/**
 * Local retry queue + dedupe set, stored as JSON inside the (encrypted)
 * preferences — a handful of pending SMS never justifies a database.
 *
 * Two layers of duplicate protection:
 *  1. LOCAL (this class): every accepted SMS gets a stable dedupe key —
 *     SHA-256 of (body + SMS timestamp). Android can redeliver a
 *     broadcast, and the receiver must not queue the same SMS twice. The
 *     last [MAX_SEEN] keys are remembered.
 *  2. SERVER (authoritative): ingest dedupes by (provider, TrxID) parsed
 *     from the body, backed by the sms_ingestions UNIQUE(provider, trxId)
 *     constraint — re-POSTing a TrxID returns the original record with
 *     `duplicate: true` and creates nothing new
 *     (apps/web/src/bd/sms-ingestion.ts). So even if the local layer is
 *     cleared, a re-forward can never double-count money.
 */
class QueueStore(context: Context) {

    private val prefs = Prefs.get(context)

    data class PendingSms(
        val smsText: String,
        /** ISO-8601 instant the SMS was received on the phone. */
        val receivedAtIso: String,
        /** "bkash" | "nagad" | null — forwarded as the server's providerHint. */
        val providerHint: String?,
        val dedupeKey: String,
    )

    @Synchronized
    fun enqueue(smsText: String, receivedAtMillis: Long, providerHint: String?): Boolean {
        val key = dedupeKey(smsText, receivedAtMillis)
        val seen = seenKeys()
        if (key in seen) return false
        seen.add(key)
        while (seen.size > MAX_SEEN) seen.removeAt(0)
        saveSeenKeys(seen)

        val items = readQueue()
        items.add(
            PendingSms(
                smsText = smsText,
                receivedAtIso = Instant.ofEpochMilli(receivedAtMillis).toString(),
                providerHint = providerHint,
                dedupeKey = key,
            ),
        )
        writeQueue(items)
        return true
    }

    @Synchronized
    fun peek(max: Int): List<PendingSms> = readQueue().take(max)

    @Synchronized
    fun remove(keys: Set<String>) {
        if (keys.isEmpty()) return
        writeQueue(readQueue().filterNot { it.dedupeKey in keys })
    }

    @Synchronized
    fun size(): Int = readQueue().size

    private fun readQueue(): MutableList<PendingSms> {
        val raw = prefs.raw().getString(KEY_QUEUE, null) ?: return mutableListOf()
        val arr = try {
            JSONArray(raw)
        } catch (e: Exception) {
            return mutableListOf()
        }
        val out = mutableListOf<PendingSms>()
        for (i in 0 until arr.length()) {
            val obj = arr.optJSONObject(i) ?: continue
            out.add(
                PendingSms(
                    smsText = obj.optString("smsText"),
                    receivedAtIso = obj.optString("receivedAtIso"),
                    providerHint = obj.optString("providerHint").ifEmpty { null },
                    dedupeKey = obj.optString("dedupeKey"),
                ),
            )
        }
        return out
    }

    private fun writeQueue(items: List<PendingSms>) {
        val arr = JSONArray()
        for (item in items) {
            arr.put(
                JSONObject()
                    .put("smsText", item.smsText)
                    .put("receivedAtIso", item.receivedAtIso)
                    .put("providerHint", item.providerHint ?: "")
                    .put("dedupeKey", item.dedupeKey),
            )
        }
        prefs.raw().edit().putString(KEY_QUEUE, arr.toString()).apply()
    }

    private fun seenKeys(): MutableList<String> {
        val raw = prefs.raw().getString(KEY_SEEN, null) ?: return mutableListOf()
        val arr = try {
            JSONArray(raw)
        } catch (e: Exception) {
            return mutableListOf()
        }
        return MutableList(arr.length()) { arr.optString(it) }
    }

    private fun saveSeenKeys(keys: List<String>) {
        prefs.raw().edit().putString(KEY_SEEN, JSONArray(keys).toString()).apply()
    }

    companion object {
        private const val KEY_QUEUE = "pending_queue_json"
        private const val KEY_SEEN = "seen_dedupe_keys_json"
        private const val MAX_SEEN = 500

        fun dedupeKey(smsText: String, receivedAtMillis: Long): String {
            val digest = MessageDigest.getInstance("SHA-256")
                .digest("$smsText|$receivedAtMillis".toByteArray(Charsets.UTF_8))
            return digest.joinToString("") { "%02x".format(it) }
        }
    }
}
