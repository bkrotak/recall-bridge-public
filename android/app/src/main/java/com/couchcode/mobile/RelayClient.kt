package com.couchcode.mobile

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

object RelayClient {
    data class PairResult(val deviceId: String, val deviceSecret: String)

    fun pair(relayUrl: String, deviceId: String, code: String, fcmToken: String): PairResult {
        val connection = open(relayUrl, "/v1/pair/exchange")
        val body = JSONObject()
            .put("deviceId", deviceId)
            .put("name", "Android device")
            .put("code", code.trim().uppercase())
            .put("fcmToken", fcmToken)
        connection.outputStream.use { it.write(body.toString().toByteArray()) }
        val response = read(connection)
        return PairResult(response.getString("deviceId"), response.getString("deviceSecret"))
    }

    fun refreshToken(relayUrl: String, deviceId: String, secret: String, fcmToken: String) {
        val connection = open(relayUrl, "/v1/device/token").apply {
            setRequestProperty("Authorization", "Bearer $secret")
        }
        val body = JSONObject().put("deviceId", deviceId).put("fcmToken", fcmToken)
        connection.outputStream.use { it.write(body.toString().toByteArray()) }
        read(connection)
    }

    private fun open(base: String, path: String): HttpURLConnection {
        require(base.startsWith("https://")) { "Relay URL must use HTTPS" }
        return (URL(base.trimEnd('/') + path).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 15_000
            readTimeout = 15_000
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
        }
    }

    private fun read(connection: HttpURLConnection): JSONObject {
        val stream = if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
        val text = stream.bufferedReader().use { it.readText() }
        if (connection.responseCode !in 200..299) error(JSONObject(text).optString("error", text))
        return JSONObject(text)
    }
}
