package com.couchcode.mobile

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import java.util.concurrent.atomic.AtomicInteger

data class TermuxHealth(
    val termuxInstalled: Boolean,
    val runCommandDeclared: Boolean,
    val runCommandGranted: Boolean,
    val deviceConfigured: Boolean
)

object TermuxLauncher {
    private const val TERMUX_PACKAGE = "com.termux"
    private const val RUN_COMMAND_PERMISSION = "com.termux.permission.RUN_COMMAND"
    private const val ACTION = "com.termux.RUN_COMMAND"
    private const val SERVICE = "com.termux.app.RunCommandService"
    private const val SHELL = "/data/data/com.termux/files/usr/bin/sh"
    private const val WORKDIR = "/data/data/com.termux/files/home"
    private const val START_SCRIPT = "/data/data/com.termux/files/home/.couchcode/start-agent"
    private val requestIds = AtomicInteger(1)

    fun health(context: Context): TermuxHealth {
        val installed = runCatching {
            context.packageManager.getPackageInfo(TERMUX_PACKAGE, 0)
        }.isSuccess
        val declared = runCatching {
            context.packageManager.getPermissionInfo(RUN_COMMAND_PERMISSION, 0)
        }.isSuccess
        val granted = context.checkSelfPermission(RUN_COMMAND_PERMISSION) == PackageManager.PERMISSION_GRANTED
        val configured = !context.getSharedPreferences("bridge", Context.MODE_PRIVATE)
            .getString("deviceId", "").isNullOrBlank()
        return TermuxHealth(installed, declared, granted, configured)
    }

    fun testConnection(context: Context): Result<Unit> = runCatching {
        val current = health(context)
        require(current.termuxInstalled) { "Termux is not installed." }
        require(current.runCommandGranted) {
            "Allow ‘Run commands in Termux environment’ in CouchCode > Permissions > Additional permissions."
        }

        val requestId = requestIds.incrementAndGet()
        val callbackIntent = Intent(context, TermuxResultReceiver::class.java)
            .putExtra(TermuxResultReceiver.EXTRA_REQUEST_ID, requestId)
        val flags = PendingIntent.FLAG_ONE_SHOT or
            (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
        val callback = PendingIntent.getBroadcast(context, requestId, callbackIntent, flags)
        val intent = Intent(ACTION).apply {
            setClassName(TERMUX_PACKAGE, SERVICE)
            putExtra("com.termux.RUN_COMMAND_PATH", SHELL)
            putExtra("com.termux.RUN_COMMAND_ARGUMENTS", arrayOf("-c", "printf 'CouchCode Termux OK\\n'"))
            putExtra("com.termux.RUN_COMMAND_WORKDIR", WORKDIR)
            putExtra("com.termux.RUN_COMMAND_BACKGROUND", true)
            putExtra("com.termux.RUN_COMMAND_LABEL", "CouchCode connection test")
            putExtra("com.termux.RUN_COMMAND_DESCRIPTION", "Checks that CouchCode can run a Termux command.")
            putExtra("com.termux.RUN_COMMAND_PENDING_INTENT", callback)
        }
        context.startService(intent)
    }

    fun startAgent(context: Context): Result<Unit> = runCatching {
        val current = health(context)
        require(current.termuxInstalled) { "Termux is not installed." }
        require(current.runCommandDeclared) { "Install the official Termux package from F-Droid." }
        require(current.runCommandGranted) { "Allow Termux command control in CouchCode." }

        val preferences = context.getSharedPreferences("bridge", Context.MODE_PRIVATE)
        val deviceId = preferences.getString("deviceId", "") ?: ""
        require(deviceId.isNotBlank()) { "Save a device ID in CouchCode first." }

        val intent = Intent(ACTION).apply {
            setClassName(TERMUX_PACKAGE, SERVICE)
            putExtra("com.termux.RUN_COMMAND_PATH", SHELL)
            putExtra("com.termux.RUN_COMMAND_ARGUMENTS", arrayOf(START_SCRIPT))
            putExtra("com.termux.RUN_COMMAND_WORKDIR", WORKDIR)
            putExtra("com.termux.RUN_COMMAND_BACKGROUND", true)
            putExtra("com.termux.RUN_COMMAND_LABEL", "CouchCode agent")
            putExtra("com.termux.RUN_COMMAND_DESCRIPTION", "Starts the locally configured CouchCode agent.")
        }
        context.startService(intent)
    }
}
