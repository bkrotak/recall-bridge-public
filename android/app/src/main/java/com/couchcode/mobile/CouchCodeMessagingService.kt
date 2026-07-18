package com.couchcode.mobile

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class CouchCodeMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        if (message.data["action"] != "wake") return
        val expected = getSharedPreferences("bridge", MODE_PRIVATE).getString("deviceId", null)
        if (expected == null || message.data["deviceId"] != expected) return
        TermuxLauncher.startAgent(this).onFailure { Log.e("CouchCode", "Unable to start Termux", it) }
    }

    override fun onNewToken(token: String) {
        val preferences = getSharedPreferences("bridge", MODE_PRIVATE)
        preferences.edit().putString("fcmToken", token).apply()
        val relayUrl = preferences.getString("relayUrl", null)
        val deviceId = preferences.getString("deviceId", null)
        val secret = preferences.getString("deviceSecret", null)
        if (relayUrl != null && deviceId != null && secret != null) {
            Thread {
                runCatching { RelayClient.refreshToken(relayUrl, deviceId, secret, token) }
                    .onFailure { Log.e("CouchCode", "Token refresh failed", it) }
            }.start()
        }
        Log.i("CouchCode", "New FCM token ready for CouchCode setup")
    }
}
