package so.oxy.noted.audio

import android.os.ParcelFileDescriptor
import android.system.ErrnoException
import android.system.Os
import android.system.OsConstants
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.IOException

class NotedAudioErasureModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NotedAudioErasure")

    AsyncFunction("eraseCaptureAudio") { ownerKey: String, captureId: String, extension: String ->
      require(OWNER_KEY.matches(ownerKey)) { "Invalid account namespace" }
      requireCaptureId(captureId)
      require(extension == "wav" || extension == "m4a") { "Unsupported audio extension" }
      withCaptureDirectory(ownerKey, captureId) { directory ->
        removeFile(directory, "audio.$extension")
      }
    }
  }

  private fun withCaptureDirectory(ownerKey: String, id: String, block: (ParcelFileDescriptor) -> Unit) {
    val document = openDirectory(appContext.persistentFilesDirectory.absolutePath, missingIsOkay = false)
      ?: throw IOException("Document directory is unavailable")
    document.use { doc ->
      val root = openDirectory("${fdPath(doc)}/captures-v2", missingIsOkay = true) ?: return
      root.use { rootDir ->
        val owner = openDirectory("${fdPath(rootDir)}/$ownerKey", missingIsOkay = true) ?: return
        owner.use { ownerDir ->
          val capture = openDirectory("${fdPath(ownerDir)}/$id", missingIsOkay = true) ?: return
          capture.use(block)
        }
      }
    }
  }

  private fun openDirectory(path: String, missingIsOkay: Boolean): ParcelFileDescriptor? {
    val descriptor = try {
      Os.open(path, OsConstants.O_RDONLY or OsConstants.O_NOFOLLOW or OsConstants.O_CLOEXEC, 0)
    } catch (error: ErrnoException) {
      if (missingIsOkay && error.errno == OsConstants.ENOENT) return null
      throw error
    }
    try {
      if (!OsConstants.S_ISDIR(Os.fstat(descriptor).st_mode)) {
        throw IOException("Capture path is not a directory")
      }
      return ParcelFileDescriptor.dup(descriptor)
    } finally {
      Os.close(descriptor)
    }
  }

  private fun removeFile(directory: ParcelFileDescriptor, name: String) {
    val path = "${fdPath(directory)}/$name"
    try {
      if (!OsConstants.S_ISREG(Os.lstat(path).st_mode)) {
        throw IOException("Capture audio entry is not a regular file")
      }
      Os.remove(path)
    } catch (error: ErrnoException) {
      if (error.errno != OsConstants.ENOENT) throw error
    }
  }

  private fun fdPath(directory: ParcelFileDescriptor): String = "/proc/self/fd/${directory.fd}"

  private fun requireCaptureId(id: String) {
    require(CAPTURE_ID.matches(id)) { "Invalid capture identifier" }
  }

  companion object {
    private val CAPTURE_ID = Regex("^[A-Za-z0-9_-]{1,128}$")
    private val OWNER_KEY = Regex("^[a-f0-9]{64}$")
  }
}
