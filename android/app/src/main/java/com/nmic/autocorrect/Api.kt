package com.nmic.autocorrect

import org.json.JSONArray
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/** Thin client for the web app's routes. Requests run on a small thread pool; callbacks come back on the caller's handler. */
class Api(private val prefs: Prefs) {
    val pool = Executors.newFixedThreadPool(3)

    fun post(path: String, body: JSONObject, timeoutMs: Int = 6000): JSONObject? {
        return try {
            val c = URL(prefs.apiBase.trimEnd('/') + path).openConnection() as HttpURLConnection
            c.requestMethod = "POST"
            c.connectTimeout = timeoutMs
            c.readTimeout = timeoutMs
            c.setRequestProperty("content-type", "application/json")
            c.doOutput = true
            OutputStreamWriter(c.outputStream, Charsets.UTF_8).use { it.write(body.toString()) }
            val text = (if (c.responseCode < 400) c.inputStream else c.errorStream)?.bufferedReader()?.readText() ?: "{}"
            JSONObject(text).put("_status", c.responseCode)
        } catch (e: Exception) {
            null
        }
    }

    fun get(path: String): JSONObject? = try {
        val c = URL(prefs.apiBase.trimEnd('/') + path).openConnection() as HttpURLConnection
        c.connectTimeout = 6000; c.readTimeout = 6000
        JSONObject(c.inputStream.bufferedReader().readText())
    } catch (e: Exception) { null }

    fun arr(vararg items: JSONObject) = JSONArray().apply { items.forEach { put(it) } }
}
