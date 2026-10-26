package com.advanceecommerce.smsforwarder

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony

/**
 * Handles android.provider.Telephony.SMS_RECEIVED.
 *
 * Flow: reassemble the (possibly multi-part) SMS -> pre-filter with the
 * mirrored server parser -> if it parses as a bKash/Nagad payment SMS,
 * enqueue it and schedule the [ForwardWorker]. Everything else — OTPs,
 * bank alerts, personal messages, marketing — is dropped HERE, on the
 * phone, and never transmitted anywhere.
 *
 * The raw body is forwarded verbatim when it does pass: the server
 * re-parses it, stores only a SHA-256 hash + parsed fields (never the
 * raw text), and matches it against orders as a PROPOSAL for staff
 * review (apps/web/src/bd/sms-ingestion.ts).
 */
class SmsReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

        val prefs = Prefs.get(context)
        if (!prefs.forwardingEnabled) return

        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
        if (messages.isNullOrEmpty()) return

        // All PDUs in one intent are parts of a single SMS from one sender.
        val body = buildString {
            for (part in messages) append(part.displayMessageBody ?: "")
        }
        val sender = messages[0].displayOriginatingAddress
        val receivedAtMillis = messages[0].timestampMillis

        val hint = MerchantSmsParser.hintFromSender(sender)
        val result = MerchantSmsParser.parse(body, hint)
        if (result !is MerchantSmsParser.Result.Ok) return // not a payment SMS — ignore

        val queue = QueueStore(context)
        val added = queue.enqueue(
            smsText = body,
            receivedAtMillis = receivedAtMillis,
            providerHint = hint?.wire ?: result.sms.provider.wire,
        )
        if (added) {
            ForwardWorker.schedule(context)
        }
    }
}
