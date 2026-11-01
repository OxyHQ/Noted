import Darwin
import ExpoModulesCore
import Foundation

public final class NotedAudioErasureModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NotedAudioErasure")

    AsyncFunction("eraseCaptureAudio") { (ownerKey: String, captureId: String, fileExtension: String) in
      try self.validateOwnerKey(ownerKey)
      try self.validateCaptureId(captureId)
      guard fileExtension == "wav" || fileExtension == "m4a" else {
        throw AudioErasureError.invalidReference
      }
      try self.withCaptureDirectory(ownerKey, captureId) { directory in
        try self.removeFile(directory, "audio.\(fileExtension)")
      }
    }
  }

  private func withCaptureDirectory(
    _ ownerKey: String, _ captureId: String, _ body: (Int32) throws -> Void
  ) throws {
    guard let documentPath = appContext?.config.documentDirectory?.path else {
      throw AudioErasureError.documentUnavailable
    }
    let document = open(documentPath, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
    guard document >= 0 else { throw posixError() }
    defer { close(document) }
    guard let root = try openChild(document, "captures-v2") else { return }
    defer { close(root) }
    guard let owner = try openChild(root, ownerKey) else { return }
    defer { close(owner) }
    guard let capture = try openChild(owner, captureId) else { return }
    defer { close(capture) }
    try body(capture)
  }

  private func openChild(_ parent: Int32, _ name: String) throws -> Int32? {
    let descriptor = openat(parent, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
    if descriptor >= 0 { return descriptor }
    if errno == ENOENT { return nil }
    throw posixError()
  }

  private func removeFile(_ directory: Int32, _ name: String) throws {
    var information = stat()
    if fstatat(directory, name, &information, AT_SYMLINK_NOFOLLOW) != 0 {
      if errno == ENOENT { return }
      throw posixError()
    }
    guard (information.st_mode & mode_t(S_IFMT)) == mode_t(S_IFREG) else {
      throw AudioErasureError.unexpectedEntry
    }
    if unlinkat(directory, name, 0) != 0 && errno != ENOENT { throw posixError() }
  }

  private func validateCaptureId(_ id: String) throws {
    let bytes = Array(id.utf8)
    guard !bytes.isEmpty, bytes.count <= 128, bytes.allSatisfy({ byte in
      (65...90).contains(byte) || (97...122).contains(byte) || (48...57).contains(byte) || byte == 45 || byte == 95
    }) else {
      throw AudioErasureError.invalidReference
    }
  }

  private func validateOwnerKey(_ key: String) throws {
    let bytes = Array(key.utf8)
    guard bytes.count == 64, bytes.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else {
      throw AudioErasureError.invalidReference
    }
  }

  private func posixError() -> NSError {
    NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
  }
}

private enum AudioErasureError: Error {
  case documentUnavailable
  case invalidReference
  case unexpectedEntry
}
