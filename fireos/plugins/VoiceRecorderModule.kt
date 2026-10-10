package com.selene.fireos

import android.Manifest
import android.content.pm.PackageManager
import android.media.AudioManager
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import androidx.core.content.ContextCompat
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager
import java.io.File

// Records an app-accessible microphone, never the system-owned Alexa remote button.
class VoiceRecorderModule(private val context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context), LifecycleEventListener {
  private val main = Handler(Looper.getMainLooper())
  private var recorder: MediaRecorder? = null
  private var file: File? = null
  private var result: Promise? = null
  private var foreground = false
  private val deadline = Runnable { finish() }

  init { context.addLifecycleEventListener(this) }
  override fun getName() = "SeleneVoiceRecorder"

  @ReactMethod
  fun record(consent: Boolean, promise: Promise) { main.post {
    if (!consent) { promise.reject("consent", "Recording, external transcription and local speaker matching require consent."); return@post }
    if (!foreground || context.currentActivity == null) { promise.reject("background", "Open Selene before recording."); return@post }
    if (result != null) { promise.reject("busy", "A recording is already active."); return@post }
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      promise.reject("permission", "Microphone permission is required."); return@post
    }
    val audio = context.getSystemService(android.content.Context.AUDIO_SERVICE) as AudioManager
    if (audio.getDevices(AudioManager.GET_DEVICES_INPUTS).isEmpty()) {
      promise.reject("microphone", "No app-accessible microphone. Use the paired phone; the Alexa remote microphone belongs to system voice search."); return@post
    }
    result = promise
    try {
      file = File.createTempFile("selene-voice-", ".m4a", context.cacheDir)
      @Suppress("DEPRECATION")
      val active = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(context) else MediaRecorder()
      recorder = active
      active.setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION)
      active.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
      active.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
      active.setAudioChannels(1)
      active.setAudioSamplingRate(16000)
      active.setAudioEncodingBitRate(64000)
      active.setOutputFile(file!!.absolutePath)
      active.setMaxDuration(19000)
      active.setMaxFileSize(4L * 1024 * 1024)
      active.setOnInfoListener { _, what, _ ->
        if (what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED || what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_FILESIZE_REACHED) main.post { if (recorder === active) finish() }
      }
      active.setOnErrorListener { _, _, _ -> main.post { if (recorder === active) discard("recording", "Microphone recording failed. Try the paired phone.") } }
      active.prepare()
      active.start()
      main.postDelayed(deadline, 19000)
    } catch (error: Exception) {
      discard("microphone", "This device cannot expose microphone audio to Selene. Use an app-accessible microphone or the paired phone.")
    }
  } }

  @ReactMethod
  fun stop(promise: Promise) { main.post { finish(); promise.resolve(null) } }

  @ReactMethod
  fun cancel(promise: Promise) { main.post { discard("cancelled", "Recording cancelled."); promise.resolve(null) } }

  private fun finish() {
    val pending = result ?: return
    try {
      recorder?.stop()
      recorder?.release(); recorder = null
      val source = file ?: throw IllegalStateException("Recording is missing")
      if (source.length() !in 12L..(4L * 1024 * 1024)) throw IllegalStateException("Invalid recording size")
      val value = Arguments.createMap().apply {
        putString("audio", Base64.encodeToString(source.readBytes(), Base64.NO_WRAP))
        putString("format", "m4a")
      }
      cleanup()
      pending.resolve(value)
    } catch (error: Exception) {
      discard("recording", "Record at least two seconds of clear speech, then try again.")
    }
  }

  private fun cleanup() {
    main.removeCallbacks(deadline)
    recorder?.release(); recorder = null
    file?.delete(); file = null
    result = null
  }
  private fun discard(code: String, message: String) {
    val pending = result
    cleanup()
    pending?.reject(code, message)
  }
  override fun onHostResume() { foreground = true }
  override fun onHostPause() { foreground = false; main.post { discard("cancelled", "Recording cancelled.") } }
  override fun onHostDestroy() { foreground = false; main.post { discard("cancelled", "Recording cancelled.") } }
  override fun invalidate() {
    context.removeLifecycleEventListener(this)
    main.post { discard("cancelled", "Recording cancelled.") }
    super.invalidate()
  }
}

class VoiceRecorderPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(VoiceRecorderModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}

// Delay Select only on the question field, so a long hold cannot open the keyboard first.
class VoiceQuestionKeys(private val activity: android.app.Activity, private val emit: () -> Unit) {
  private val main = Handler(Looper.getMainLooper())
  private var down: android.view.KeyEvent? = null
  private var target: android.view.View? = null
  private var held = false
  private val longPress = Runnable {
    if (down != null && !held && activity.hasWindowFocus() && activity.currentFocus === target) {
      held = true
      emit()
    }
  }

  fun dispatch(event: android.view.KeyEvent, fallback: (android.view.KeyEvent) -> Boolean): Boolean {
    if (event.keyCode != android.view.KeyEvent.KEYCODE_DPAD_CENTER && event.keyCode != android.view.KeyEvent.KEYCODE_ENTER) return fallback(event)
    if (event.action == android.view.KeyEvent.ACTION_UP && down != null) {
      main.removeCallbacks(longPress)
      val original = down!!
      val shortPress = !held && !event.isCanceled && activity.currentFocus === target
      down = null; target = null; held = false
      if (shortPress) { fallback(original); fallback(event) }
      return true
    }
    if (activity.currentFocus?.getTag(com.facebook.react.R.id.view_tag_native_id) != "selene-voice-question") return fallback(event)
    if (event.action == android.view.KeyEvent.ACTION_DOWN) {
      if (event.repeatCount == 0) {
        down = android.view.KeyEvent(event); target = activity.currentFocus; held = false
        main.postDelayed(longPress, android.view.ViewConfiguration.getLongPressTimeout().toLong())
      } else if (event.isLongPress) longPress.run()
      return true
    }
    return fallback(event)
  }
}
