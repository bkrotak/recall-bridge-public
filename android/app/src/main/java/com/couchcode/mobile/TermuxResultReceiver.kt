package com.couchcode.mobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Bundle

class TermuxResultReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val result = intent.getBundleExtra("result")
        val exitCode = result?.getInt("exitCode", Int.MIN_VALUE)
        val error = result?.getString("errmsg", "")?.trim().orEmpty()
        val stderr = result?.getString("stderr", "")?.trim().orEmpty()
        val stdout = result?.getString("stdout", "")?.trim().orEmpty()
        val summary = when {
            !error.isBlank() -> "Termux error: $error"
            exitCode != Int.MIN_VALUE && exitCode != 0 -> "Termux exit $exitCode: ${stderr.ifBlank { stdout }.take(180)}"
            exitCode == 0 -> "Termux accepted launch (exit 0)"
            else -> "Termux returned an unreadable receipt"
        }
        context.getSharedPreferences("bridge", Context.MODE_PRIVATE)
            .edit()
            .putString("lastTermuxResult", summary)
            .apply()
    }

    companion object {
        const val EXTRA_REQUEST_ID = "couchcode_request_id"
    }
}
