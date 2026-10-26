package com.advanceecommerce.smsforwarder

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * App storage. Everything lives in EncryptedSharedPreferences (AES-256,
 * key in the Android Keystore): the staff session token is a credential,
 * and queued SMS bodies are payment data, so neither belongs in plain
 * preferences.
 *
 * If encrypted prefs cannot be created (rare — a broken keystore on an
 * old device), we fall back to plain SharedPreferences so the app still
 * works; the token is then only as safe as the device itself. That
 * trade-off is called out in the README.
 *
 * The staff PASSWORD is never stored — only the `admin_session` token
 * returned by the login call, which the server expires after 7 days
 * (STAFF_SESSION_TTL_MS in apps/web/src/lib/auth.ts).
 */
class Prefs private constructor(private val sp: SharedPreferences) {

    var baseUrl: String
        get() = sp.getString(KEY_BASE_URL, "") ?: ""
        set(value) = sp.edit().putString(KEY_BASE_URL, value.trim().trimEnd('/')).apply()

    /** The admin_session cookie value. Empty = not signed in. */
    var sessionToken: String
        get() = sp.getString(KEY_SESSION_TOKEN, "") ?: ""
        set(value) = sp.edit().putString(KEY_SESSION_TOKEN, value).apply()

    /** Identifier used at sign-in, kept for display only. */
    var identifier: String
        get() = sp.getString(KEY_IDENTIFIER, "") ?: ""
        set(value) = sp.edit().putString(KEY_IDENTIFIER, value).apply()

    var forwardingEnabled: Boolean
        get() = sp.getBoolean(KEY_ENABLED, true)
        set(value) = sp.edit().putBoolean(KEY_ENABLED, value).apply()

    /** Human-readable status of the last forward attempt, shown in the UI. */
    var lastStatus: String
        get() = sp.getString(KEY_LAST_STATUS, "") ?: ""
        set(value) = sp.edit().putString(KEY_LAST_STATUS, value).apply()

    var lastForwardAtMillis: Long
        get() = sp.getLong(KEY_LAST_FORWARD_AT, 0L)
        set(value) = sp.edit().putLong(KEY_LAST_FORWARD_AT, value).apply()

    fun clearSession() {
        sp.edit().remove(KEY_SESSION_TOKEN).apply()
    }

    fun raw(): SharedPreferences = sp

    companion object {
        private const val FILE_NAME = "forwarder-secure"
        private const val KEY_BASE_URL = "base_url"
        private const val KEY_SESSION_TOKEN = "session_token"
        private const val KEY_IDENTIFIER = "identifier"
        private const val KEY_ENABLED = "forwarding_enabled"
        private const val KEY_LAST_STATUS = "last_status"
        private const val KEY_LAST_FORWARD_AT = "last_forward_at"

        @Volatile
        private var instance: Prefs? = null

        fun get(context: Context): Prefs {
            return instance ?: synchronized(this) {
                instance ?: Prefs(create(context.applicationContext)).also { instance = it }
            }
        }

        private fun create(context: Context): SharedPreferences {
            return try {
                val masterKey = MasterKey.Builder(context)
                    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                    .build()
                EncryptedSharedPreferences.create(
                    context,
                    FILE_NAME,
                    masterKey,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
                )
            } catch (e: Exception) {
                // Fallback: plain prefs (see class doc). Never crash the
                // receiver because the keystore is unhappy.
                context.getSharedPreferences("$FILE_NAME-plain", Context.MODE_PRIVATE)
            }
        }
    }
}
