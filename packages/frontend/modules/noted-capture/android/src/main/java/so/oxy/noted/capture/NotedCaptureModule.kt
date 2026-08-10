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

    // `if (context != null)` rather than `?: return@Function`, in both of these.
    // An early return makes the lambda's type the common supertype of Unit and
    // whatever the last call returns — `ComponentName?` here, `Boolean` below —
    // and Kotlin then rejects the valueless return against it. An `if` with no
    // `else` is Unit, which is what these actually are.
    Function("startCaptureService") { title: String, body: String ->
      val context = appContext.reactContext
      if (context != null) {
        val intent = Intent(context, NotedCaptureService::class.java).apply {
          putExtra(NotedCaptureService.EXTRA_TITLE, title)
          putExtra(NotedCaptureService.EXTRA_BODY, body)
        }
        // startForegroundService, not startService: the latter cannot promote to
        // a foreground service on Android 8+, and the call is only legal at all
        // because the app is in the foreground when the user presses record.
        context.startForegroundService(intent)
      }
    }

    Function("stopCaptureService") {
      val context = appContext.reactContext
      if (context != null) {
        context.stopService(Intent(context, NotedCaptureService::class.java))
      }
    }

    Function("isCaptureServiceRunning") {
      NotedCaptureService.isRunning
    }
  }
}
