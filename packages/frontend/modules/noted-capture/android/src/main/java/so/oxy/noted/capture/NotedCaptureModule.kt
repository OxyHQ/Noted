package so.oxy.noted.capture

import android.content.Intent
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * JS bridge for {@link NotedCaptureService}.
 *
 * Deliberately thin: three synchronous calls and no state of its own. The
 * service's own lifecycle is the source of truth for whether it is running, so
 * this module cannot drift out of step with it.
 */
class NotedCaptureModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NotedCapture")

    Function("startCaptureService") { title: String, body: String ->
      val context = appContext.reactContext ?: return@Function
      val intent = Intent(context, NotedCaptureService::class.java).apply {
        putExtra(NotedCaptureService.EXTRA_TITLE, title)
        putExtra(NotedCaptureService.EXTRA_BODY, body)
      }
      // startForegroundService, not startService: the latter cannot promote to a
      // foreground service on Android 8+, and the call is only legal at all
      // because the app is in the foreground when the user presses record.
      context.startForegroundService(intent)
    }

    Function("stopCaptureService") {
      val context = appContext.reactContext ?: return@Function
      context.stopService(Intent(context, NotedCaptureService::class.java))
    }

    Function("isCaptureServiceRunning") {
      NotedCaptureService.isRunning
    }
  }
}
