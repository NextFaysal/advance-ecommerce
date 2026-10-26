package com.advanceecommerce.smsforwarder

import kotlin.math.roundToLong

/**
 * On-device pre-filter — a Kotlin MIRROR of the server parser
 * `parseMerchantSms` in `apps/web/src/bd/sms-autoverify.ts`. Keep the two
 * in sync: the rules below are copied from that file (provider detection,
 * the TrxID label regex, the first Tk/Taka/৳ amount, the BD phone regex,
 * Bangla-digit folding).
 *
 * The server re-parses the raw text itself on ingest and is the only
 * authority. This mirror exists so the app forwards ONLY plausible
 * bKash/Nagad payment SMS — OTPs, bank alerts and personal messages never
 * leave the phone. If this filter accepts something the server rejects,
 * the server records it as REJECTED with no stored preview; nothing is
 * marked paid by forwarding alone.
 */
object MerchantSmsParser {

    enum class Provider(val wire: String) {
        BKASH("bkash"),
        NAGAD("nagad"),
    }

    data class Parsed(
        val provider: Provider,
        /** Normalised like the server: uppercase, spaces/dashes stripped. */
        val trxId: String,
        /** Integer poisha (1 taka = 100 poisha), like the server's toPoisha. */
        val amountPoisha: Long,
        /** First BD number found in the body, raw form, or null. */
        val senderPhone: String?,
    )

    sealed interface Result {
        data class Ok(val sms: Parsed) : Result
        data class Rejected(val reason: String) : Result
    }

    // Server: (?:trxid|txn\s*id|transaction\s*id)\s*[:.]?\s*([A-Za-z0-9-]{6,32})
    private val trxRegex =
        Regex("""(?:trxid|txn\s*id|transaction\s*id)\s*[:.]?\s*([A-Za-z0-9-]{6,32})""", RegexOption.IGNORE_CASE)

    // Server: (?:tk\.?|taka|৳)\s*([\d,]+(?:\.\d{1,2})?) — FIRST match is the received amount.
    private val amountRegex =
        Regex("""(?:tk\.?|taka|৳)\s*([\d,]+(?:\.\d{1,2})?)""", RegexOption.IGNORE_CASE)

    // Server: (?:\+?88)?01[3-9]\d{8}
    private val phoneRegex = Regex("""(?:\+?88)?01[3-9]\d{8}""")

    private val trxIdLabelRegex = Regex("""\btrxid\b""", RegexOption.IGNORE_CASE)
    private val txnIdLabelRegex = Regex("""\btxn\s*id\b""", RegexOption.IGNORE_CASE)

    /** Server: foldBanglaDigits (০১২৩৪৫৬৭৮৯ -> 0123456789) before any parsing. */
    fun foldBanglaDigits(text: String): String {
        val sb = StringBuilder(text.length)
        for (ch in text) {
            sb.append(if (ch in '০'..'৯') '0' + (ch - '০') else ch)
        }
        return sb.toString()
    }

    fun detectProvider(text: String, hint: Provider?): Provider? {
        if (hint != null) return hint
        val lower = text.lowercase()
        if (lower.contains("bkash") || lower.contains("বিকাশ")) return Provider.BKASH
        if (lower.contains("nagad") || lower.contains("নগদ")) return Provider.NAGAD
        // Weak signals, same as the server: the TrxID label implies bKash,
        // "Txn ID" implies Nagad.
        if (trxIdLabelRegex.containsMatchIn(text)) return Provider.BKASH
        if (txnIdLabelRegex.containsMatchIn(text)) return Provider.NAGAD
        return null
    }

    /**
     * Provider hint from the SMS sender address (e.g. the "bKash"
     * alphanumeric sender ID). Only a hint — body detection still applies
     * when the sender is a plain number.
     */
    fun hintFromSender(sender: String?): Provider? {
        val s = sender?.lowercase() ?: return null
        return when {
            s.contains("bkash") -> Provider.BKASH
            s.contains("nagad") -> Provider.NAGAD
            else -> null
        }
    }

    fun parse(raw: String, hint: Provider? = null): Result {
        val folded = foldBanglaDigits(raw.trim())
        if (folded.isEmpty()) return Result.Rejected("empty")
        val provider = detectProvider(folded, hint) ?: return Result.Rejected("no_provider")

        val trxMatch = trxRegex.find(folded) ?: return Result.Rejected("no_trxid")
        val trxId = trxMatch.groupValues[1].replace(Regex("""[\s-]"""), "").uppercase()

        val amountMatch = amountRegex.find(folded) ?: return Result.Rejected("no_amount")
        val taka = amountMatch.groupValues[1].replace(",", "").toDoubleOrNull()
            ?: return Result.Rejected("no_amount")
        if (taka <= 0) return Result.Rejected("no_amount")
        val amountPoisha = (taka * 100).roundToLong()

        val senderPhone = phoneRegex.find(folded)?.value
        return Result.Ok(Parsed(provider, trxId, amountPoisha, senderPhone))
    }
}
