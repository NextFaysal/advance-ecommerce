package com.advanceecommerce.smsforwarder

import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * The server contract, implemented exactly as the code defines it.
 * There is NO device-token API on the server — these are the facts the
 * app is built against:
 *
 *  - Sign-in: POST /api/v1/admin/auth/login { identifier, password }
 *    (apps/web/app/api/v1/admin/auth/login/route.ts). On success the
 *    response body is { data: { status: "ok" } } and the session token
 *    arrives ONLY as an `admin_session` Set-Cookie (HttpOnly, 7-day
 *    maxAge — STAFF_SESSION_TTL_MS in apps/web/src/lib/auth.ts). The
 *    account must hold the `payments.verify_manual` permission.
 *    Login is rate-limited (5 attempts / 15 min per IP+identifier) and
 *    accounts lock after repeated failures — so this client NEVER
 *    auto-retries a login; only the user signs in, from the app screen.
 *  - Ingest: POST /api/v1/admin/bd/sms-ingest
 *    (apps/web/app/api/v1/admin/bd/sms-ingest/route.ts), guarded by the
 *    admin_session cookie via requireAdmin("payments.verify_manual")
 *    (apps/web/src/reports/guard.ts). Body is one item
 *    { smsText, source, receivedAt?, providerHint? } or a batch
 *    { items: [...] } (max 50) — schema: ingestSmsItemSchema in
 *    apps/web/src/bd/sms-ingestion.ts. `source` is the literal string
 *    "android_forwarder". Success is HTTP 201; a repeated (provider,
 *    TrxID) returns the original record with `duplicate: true`.
 */
class ApiClient(private val baseUrl: String) {

    sealed interface LoginResult {
        data class Ok(val sessionToken: String) : LoginResult

        /** Account has TOTP 2FA on: the app cannot complete that step. */
        object Needs2fa : LoginResult
        data class Failed(val message: String) : LoginResult
    }

    sealed interface IngestResult {
        /** HTTP 201 — [summary] is the server's per-outcome counts. */
        data class Ok(val summary: String) : IngestResult

        /** 401 — session expired/revoked; the user must sign in again. */
        object Unauthorized : IngestResult

        /** 403 — signed in, but the account lacks payments.verify_manual. */
        object Forbidden : IngestResult
        data class Failed(val message: String, val retryable: Boolean) : IngestResult
    }

    fun login(identifier: String, password: String): LoginResult {
        val body = JSONObject()
            .put("identifier", identifier)
            .put("password", password)
        val (code, responseBody, cookies) = try {
            post("/api/v1/admin/auth/login", body, sessionToken = null, readCookies = true)
        } catch (e: IOException) {
            return LoginResult.Failed("Network error: ${e.message}")
        }
        val json = parseJson(responseBody)
        val status = json?.optJSONObject("data")?.optString("status")
        if (code == 200 && status == "needs_2fa") return LoginResult.Needs2fa
        val token = cookies.firstOrNull { it.startsWith("admin_session=") }
            ?.substringAfter("admin_session=")
            ?.substringBefore(";")
            ?.trim()
        return if (code == 200 && status == "ok" && !token.isNullOrEmpty()) {
            LoginResult.Ok(token)
        } else {
            val errCode = json?.optJSONObject("error")?.optString("code")
            LoginResult.Failed(
                when (errCode) {
                    "RATE_LIMITED" -> "Too many login attempts — wait 15 minutes."
                    "INVALID_CREDENTIALS" -> "Wrong identifier or password."
                    else -> "Login failed (HTTP $code${errCode?.let { ", $it" } ?: ""})."
                },
            )
        }
    }

    /** POST a batch of queued SMS (server accepts at most 50 per call). */
    fun ingestBatch(sessionToken: String, items: List<QueueStore.PendingSms>): IngestResult {
        val arr = JSONArray()
        for (item in items) {
            val obj = JSONObject()
                .put("smsText", item.smsText)
                .put("source", "android_forwarder")
                .put("receivedAt", item.receivedAtIso)
            if (item.providerHint != null) obj.put("providerHint", item.providerHint)
            arr.put(obj)
        }
        val body = JSONObject().put("items", arr)
        val (code, responseBody, _) = try {
            post("/api/v1/admin/bd/sms-ingest", body, sessionToken, readCookies = false)
        } catch (e: IOException) {
            return IngestResult.Failed("Network error: ${e.message}", retryable = true)
        }
        return when (code) {
            201 -> {
                val counts = parseJson(responseBody)
                    ?.optJSONObject("data")
                    ?.optJSONObject("counts")
                val summary = if (counts != null && counts.length() > 0) {
                    counts.keys().asSequence()
                        .joinToString(", ") { "$it: ${counts.optInt(it)}" }
                } else {
                    "accepted"
                }
                IngestResult.Ok(summary)
            }
            401 -> IngestResult.Unauthorized
            403 -> IngestResult.Forbidden
            in 500..599 -> IngestResult.Failed("Server error (HTTP $code)", retryable = true)
            else -> IngestResult.Failed("Unexpected response (HTTP $code)", retryable = false)
        }
    }

    /** Returns (httpCode, body, setCookieHeaders). Throws IOException on network failure. */
    private fun post(
        path: String,
        jsonBody: JSONObject,
        sessionToken: String?,
        readCookies: Boolean,
    ): Triple<Int, String, List<String>> {
        val conn = URL(baseUrl.trimEnd('/') + path).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 15_000
            conn.readTimeout = 20_000
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("Accept", "application/json")
            conn.setRequestProperty("User-Agent", "AdvanceSmsForwarder/1.0 (Android)")
            if (sessionToken != null) {
                conn.setRequestProperty("Cookie", "admin_session=$sessionToken")
            }
            conn.outputStream.use { it.write(jsonBody.toString().toByteArray(Charsets.UTF_8)) }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            val cookies = if (readCookies) {
                conn.headerFields.entries
                    .filter { it.key?.equals("Set-Cookie", ignoreCase = true) == true }
                    .flatMap { it.value }
            } else {
                emptyList()
            }
            return Triple(code, text, cookies)
        } finally {
            conn.disconnect()
        }
    }

    private fun parseJson(text: String): JSONObject? = try {
        JSONObject(text)
    } catch (e: Exception) {
        null
    }
}
