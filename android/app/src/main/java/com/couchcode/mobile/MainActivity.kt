package com.couchcode.mobile

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.google.firebase.messaging.FirebaseMessaging
import java.util.UUID

class MainActivity : Activity() {
    private lateinit var bridgeHealth: TextView
    private lateinit var status: TextView
    private lateinit var device: EditText

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestNotificationPermission()

        val preferences = getSharedPreferences("bridge", MODE_PRIVATE)
        val suggestedDeviceId = preferences.getString("deviceId", null)
            ?: "android-${UUID.randomUUID().toString().replace("-", "").take(12)}"
        val padding = (24 * resources.displayMetrics.density).toInt()

        val title = TextView(this).apply { text = "CouchCode Setup"; textSize = 30f }
        val detail = TextView(this).apply {
            text = "Complete each check once. Your Firebase and GitHub secrets stay outside this app."
            textSize = 16f
        }
        bridgeHealth = TextView(this).apply { textSize = 15f }
        status = TextView(this).apply {
            text = "Setup status: ready to check this phone"
            textSize = 15f
        }
        device = EditText(this).apply {
            hint = "Device ID"
            setText(suggestedDeviceId)
            isSingleLine = true
        }

        val allowTermux = Button(this).apply {
            text = "1. Allow Termux command control"
            setOnClickListener {
                requestPermissions(arrayOf(TERMUX_RUN_COMMAND_PERMISSION), REQUEST_TERMUX_PERMISSION)
            }
        }
        val openSettings = Button(this).apply {
            text = "Open Android app settings"
            setOnClickListener {
                startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
            }
        }
        val saveDevice = Button(this).apply {
            text = "2. Save device ID"
            setOnClickListener {
                saveDeviceId()?.let {
                    status.text = "Device ID saved: $it"
                    refreshHealth()
                }
            }
        }
        val copyToken = Button(this).apply {
            text = "3. Copy Firebase wake token"
            setOnClickListener {
                val deviceId = saveDeviceId() ?: return@setOnClickListener
                status.text = "Getting Firebase token…"
                FirebaseMessaging.getInstance().token
                    .addOnSuccessListener { token ->
                        preferences.edit()
                            .putString("fcmToken", token)
                            .putString("deviceId", deviceId)
                            .apply()
                        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                        clipboard.setPrimaryClip(ClipData.newPlainText("CouchCode Firebase token", token))
                        status.text = "Firebase token copied. Store it as COUCHCODE_FCM_TOKEN in GitHub Actions."
                        refreshHealth()
                    }
                    .addOnFailureListener { status.text = "Firebase token failed: ${it.message}" }
            }
        }
        val testTermux = Button(this).apply {
            text = "4. Test Termux connection"
            setOnClickListener {
                val result = TermuxLauncher.testConnection(this@MainActivity)
                status.text = result.fold(
                    onSuccess = { "Termux test requested. Wait a moment, then refresh checks." },
                    onFailure = { "Termux test blocked: ${it.message}" }
                )
            }
        }
        val refresh = Button(this).apply {
            text = "Refresh setup checks"
            setOnClickListener { refreshHealth() }
        }

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(padding, padding * 2, padding, padding)
            addView(title)
            addView(detail)
            addView(bridgeHealth)
            addView(allowTermux)
            addView(openSettings)
            addView(device)
            addView(saveDevice)
            addView(copyToken)
            addView(testTermux)
            addView(refresh)
            addView(status)
        }
        setContentView(ScrollView(this).apply {
            addView(content, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        })
        refreshHealth()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_TERMUX_PERMISSION) {
            status.text = if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
                "Termux command control allowed."
            } else {
                "Termux command control was not allowed."
            }
        }
        refreshHealth()
    }

    override fun onResume() {
        super.onResume()
        if (::bridgeHealth.isInitialized) refreshHealth()
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), REQUEST_NOTIFICATIONS)
        }
    }

    private fun saveDeviceId(): String? {
        val value = device.text.toString().trim()
        if (!DEVICE_ID.matches(value)) {
            status.text = "Device ID must be 8–100 letters, numbers, dots, colons, underscores, or dashes."
            return null
        }
        getSharedPreferences("bridge", MODE_PRIVATE).edit().putString("deviceId", value).apply()
        return value
    }

    private fun refreshHealth() {
        val preferences = getSharedPreferences("bridge", MODE_PRIVATE)
        val health = TermuxLauncher.health(this)
        val notificationsAllowed = Build.VERSION.SDK_INT < 33 ||
            checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        val lastResult = preferences.getString("lastTermuxResult", "No Termux receipt yet.")
        bridgeHealth.text = buildString {
            append("Setup checks\n")
            append("• Official Termux installed: ${yesNo(health.termuxInstalled)}\n")
            append("• Termux command API available: ${yesNo(health.runCommandDeclared)}\n")
            append("• Termux command control allowed: ${yesNo(health.runCommandGranted)}\n")
            append("• Notifications allowed: ${yesNo(notificationsAllowed)}\n")
            append("• Device ID saved: ${yesNo(health.deviceConfigured)}\n")
            append("• Firebase token saved: ${yesNo(!preferences.getString("fcmToken", "").isNullOrBlank())}\n")
            append("• Last Termux receipt: $lastResult")
        }
    }

    private fun yesNo(value: Boolean) = if (value) "yes" else "NO"

    companion object {
        private const val TERMUX_RUN_COMMAND_PERMISSION = "com.termux.permission.RUN_COMMAND"
        private const val REQUEST_NOTIFICATIONS = 100
        private const val REQUEST_TERMUX_PERMISSION = 101
        private val DEVICE_ID = Regex("^[a-zA-Z0-9._:-]{8,100}$")
    }
}
