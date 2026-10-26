package com.advanceecommerce.smsforwarder

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The whole UI: store address, device-token pairing, legacy staff
 * sign-in, on/off switch, permission state, and the last-forward
 * status. Plain views on purpose — there is nothing here that needs a
 * UI framework.
 *
 * PAIRING (primary): the merchant pastes the per-device token created
 * in Admin → BD Tools → ডিভাইস টোকেন. No password ever touches the
 * phone, the token does not expire, and staff can revoke it instantly
 * from the same admin card — a revoked token puts the app into the
 * needs-repair state (see ForwardWorker) instead of retrying.
 *
 * SIGN-IN (legacy fallback, kept for installs not yet using device
 * tokens): calls the store's normal staff login (see ApiClient) and
 * keeps ONLY the session token. If the account has TOTP 2FA enabled
 * the login answers needs_2fa, which this app cannot complete — the
 * README tells the merchant to use a dedicated staff account for the
 * forwarder phone (with the payments.verify_manual permission) instead.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var prefs: Prefs
    private lateinit var baseUrlInput: EditText
    private lateinit var deviceTokenInput: EditText
    private lateinit var pairingStatus: TextView
    private lateinit var removeTokenButton: Button
    private lateinit var identifierInput: EditText
    private lateinit var passwordInput: EditText
    private lateinit var sessionStatus: TextView
    private lateinit var permissionStatus: TextView
    private lateinit var grantPermissionButton: Button
    private lateinit var statusText: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        prefs = Prefs.get(this)

        baseUrlInput = findViewById(R.id.baseUrlInput)
        deviceTokenInput = findViewById(R.id.deviceTokenInput)
        pairingStatus = findViewById(R.id.pairingStatus)
        removeTokenButton = findViewById(R.id.removeTokenButton)
        identifierInput = findViewById(R.id.identifierInput)
        passwordInput = findViewById(R.id.passwordInput)
        sessionStatus = findViewById(R.id.sessionStatus)
        permissionStatus = findViewById(R.id.permissionStatus)
        grantPermissionButton = findViewById(R.id.grantPermissionButton)
        statusText = findViewById(R.id.statusText)

        baseUrlInput.setText(prefs.baseUrl)
        identifierInput.setText(prefs.identifier)
        val enabledSwitch = findViewById<Switch>(R.id.enabledSwitch)
        enabledSwitch.isChecked = prefs.forwardingEnabled
        enabledSwitch.setOnCheckedChangeListener { _, checked ->
            prefs.forwardingEnabled = checked
            refreshStatus()
        }

        findViewById<Button>(R.id.pairTokenButton).setOnClickListener { pairWithToken() }
        removeTokenButton.setOnClickListener { removeToken() }
        findViewById<Button>(R.id.signInButton).setOnClickListener { signIn() }
        grantPermissionButton.setOnClickListener {
            ActivityCompat.requestPermissions(
                this,
                arrayOf(Manifest.permission.RECEIVE_SMS),
                REQUEST_SMS_PERMISSION,
            )
        }
        findViewById<Button>(R.id.forwardNowButton).setOnClickListener {
            ForwardWorker.schedule(this)
            Toast.makeText(this, "Forwarding queued SMS…", Toast.LENGTH_SHORT).show()
            refreshStatus()
        }
    }

    override fun onResume() {
        super.onResume()
        refreshStatus()
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_SMS_PERMISSION) refreshStatus()
    }

    /**
     * Pair with a per-device token. The token is validated for shape
     * only (ae_dev_… — the server is the authority and answers 401 if
     * it is wrong/revoked); it is then stored in encrypted prefs and
     * the input field is cleared so the secret does not sit on screen.
     */
    private fun pairWithToken() {
        val baseUrl = baseUrlInput.text.toString().trim()
        val token = deviceTokenInput.text.toString().trim()
        if (baseUrl.isEmpty() || token.isEmpty()) {
            Toast.makeText(this, "Fill in the store address and the device token.", Toast.LENGTH_LONG).show()
            return
        }
        if (!baseUrl.startsWith("https://")) {
            // The token is a credential — never send it over HTTP.
            Toast.makeText(this, "Store address must start with https://", Toast.LENGTH_LONG).show()
            return
        }
        if (!token.startsWith("ae_dev_")) {
            Toast.makeText(
                this,
                "That does not look like a device token — it starts with ae_dev_. " +
                    "Copy it exactly from Admin → BD Tools → ডিভাইস টোকেন.",
                Toast.LENGTH_LONG,
            ).show()
            return
        }
        prefs.baseUrl = baseUrl
        prefs.deviceToken = token
        prefs.needsRepair = false
        deviceTokenInput.text.clear()
        prefs.lastStatus = "Paired with a device token. Waiting for payment SMS."
        // Anything queued while unpaired can go now.
        ForwardWorker.schedule(this)
        Toast.makeText(this, "Paired.", Toast.LENGTH_SHORT).show()
        refreshStatus()
    }

    private fun removeToken() {
        prefs.clearDeviceToken()
        prefs.needsRepair = false
        prefs.lastStatus = "Device token removed. Pair a new token or sign in to resume forwarding."
        refreshStatus()
    }

    private fun signIn() {
        val baseUrl = baseUrlInput.text.toString().trim()
        val identifier = identifierInput.text.toString().trim()
        val password = passwordInput.text.toString()
        if (baseUrl.isEmpty() || identifier.isEmpty() || password.isEmpty()) {
            Toast.makeText(this, "Fill in store address, identifier and password.", Toast.LENGTH_LONG).show()
            return
        }
        if (!baseUrl.startsWith("https://")) {
            // The session token is a credential — never send it over HTTP.
            Toast.makeText(this, "Store address must start with https://", Toast.LENGTH_LONG).show()
            return
        }
        prefs.baseUrl = baseUrl
        sessionStatus.text = "Signing in…"
        lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) {
                ApiClient(baseUrl).login(identifier, password)
            }
            when (result) {
                is ApiClient.LoginResult.Ok -> {
                    prefs.sessionToken = result.sessionToken
                    prefs.identifier = identifier
                    passwordInput.text.clear()
                    prefs.lastStatus = "Signed in. Waiting for payment SMS."
                    // Anything queued while signed out can go now.
                    ForwardWorker.schedule(this@MainActivity)
                    Toast.makeText(this@MainActivity, "Signed in.", Toast.LENGTH_SHORT).show()
                }
                ApiClient.LoginResult.Needs2fa -> {
                    sessionStatus.text =
                        "This account has two-factor authentication (TOTP) enabled, which the " +
                            "forwarder cannot complete. Use a dedicated staff account without " +
                            "TOTP for this phone (it still needs payments.verify_manual)."
                }
                is ApiClient.LoginResult.Failed -> {
                    sessionStatus.text = result.message
                }
            }
            refreshStatus()
        }
    }

    private fun refreshStatus() {
        // Pairing state (primary credential). The stored token itself
        // is never rendered back onto the screen — paired state only.
        val paired = prefs.deviceToken.isNotEmpty()
        pairingStatus.text = when {
            prefs.needsRepair -> ForwardWorker.REPAIR_STATUS
            paired ->
                "Paired with a device token (ae_dev_•••). This is the credential used " +
                    "for forwarding — it does not expire; staff can revoke it in " +
                    "Admin → BD Tools."
            else ->
                "Not paired. Paste the token from Admin → BD Tools → ডিভাইস টোকেন " +
                    "(shown once when the device is created)."
        }
        removeTokenButton.visibility = if (paired) View.VISIBLE else View.GONE

        val signedIn = prefs.sessionToken.isNotEmpty()
        val standbyNote =
            if (paired) " (Standby only — the device token is in use.)" else ""
        sessionStatus.text = when {
            signedIn && prefs.identifier.isNotEmpty() ->
                "Signed in as ${prefs.identifier}. Session lasts 7 days; " +
                    "sign in again when it expires.$standbyNote"
            signedIn ->
                "Signed in. Session lasts 7 days; sign in again when it expires.$standbyNote"
            else -> "Not signed in."
        }

        val granted = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.RECEIVE_SMS,
        ) == PackageManager.PERMISSION_GRANTED
        permissionStatus.text = if (granted) {
            "SMS permission: granted."
        } else {
            "SMS permission: NOT granted — the app cannot see incoming SMS without it."
        }
        grantPermissionButton.visibility = if (granted) View.GONE else View.VISIBLE

        val queued = QueueStore(this).size()
        val lastAt = prefs.lastForwardAtMillis
        statusText.text = buildString {
            append("Queued SMS waiting: ").append(queued).append('\n')
            if (lastAt > 0) append("Last forward: ").append(formatTimestamp(lastAt)).append('\n')
            if (prefs.lastStatus.isNotEmpty()) append(prefs.lastStatus)
        }
    }

    companion object {
        private const val REQUEST_SMS_PERMISSION = 42
    }
}
