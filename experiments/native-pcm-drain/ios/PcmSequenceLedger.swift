import Foundation

enum PcmLedgerError: Error, Equatable {
  case invalidConfiguration
  case failed(String)
  case stopped
}

/// Experimental producer ledger; it does not stop a microphone or emit events.
final class PcmSequenceLedger: @unchecked Sendable {
  private static let maxSequence: Int64 = 9_007_199_254_740_990
  private let lock = NSLock()
  private let operationId: String
  private let limit: Int
  private var awaiting: [Int64: Int] = [:]
  private var outstanding = 0
  private var next: Int64 = 0
  private var stopped = false
  private var failure: String?

  init(operationId: String, limit: Int) throws {
    guard !operationId.isEmpty, limit > 0 else { throw PcmLedgerError.invalidConfiguration }
    self.operationId = operationId
    self.limit = limit
  }

  /// Reserve before emission; acknowledgment only releases transport credit.
  func reserve(operation: String, bytes: Int) throws -> Int64 {
    lock.lock()
    defer { lock.unlock() }
    try check()
    guard !stopped else { throw PcmLedgerError.stopped }
    guard operation == operationId, bytes > 0, bytes <= limit - outstanding,
          next <= Self.maxSequence else { throw fail("Invalid or excessive PCM event") }
    let sequence = next
    next += 1
    awaiting[sequence] = bytes
    outstanding += bytes
    return sequence
  }

  func acknowledge(operation: String, sequence: Int64) throws {
    lock.lock()
    defer { lock.unlock() }
    try check()
    guard operation == operationId else { throw fail("Wrong PCM operation") }
    guard let bytes = awaiting.removeValue(forKey: sequence) else {
      throw fail("Unknown or duplicate PCM acknowledgement")
    }
    outstanding -= bytes
  }

  /// Call only after the real native producer has stopped and joined.
  func finish(operation: String) throws -> Int64 {
    lock.lock()
    defer { lock.unlock() }
    try check()
    guard operation == operationId, !stopped else { throw fail("Invalid PCM stop") }
    stopped = true
    return next - 1
  }

  private func check() throws {
    if let failure { throw PcmLedgerError.failed(failure) }
  }

  private func fail(_ message: String) -> PcmLedgerError {
    if failure == nil { failure = message }
    return .failed(failure ?? message)
  }
}
