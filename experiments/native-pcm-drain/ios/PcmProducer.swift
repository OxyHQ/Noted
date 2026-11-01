import Foundation

protocol PcmExperimentalSource: AnyObject {
  /// Returns nil only after a requested stop.
  func read() throws -> Data?
  /// Must return promptly and cause a blocked read to return.
  func requestStop() throws
  func close() throws
}

enum PcmProducerError: Error {
  case invalidStop
  case unexpectedEnd
  case timeout
  case failed(Error)
}

/// Experimental controller; it is not connected to AudioQueue.
final class PcmProducer: @unchecked Sendable {
  typealias Emit = (String, Int64, Data) throws -> Void
  private let operationId: String
  private let source: PcmExperimentalSource
  private let emit: Emit
  private let ledger: PcmSequenceLedger
  private let condition = NSCondition()
  private var thread: Thread?
  private var started = false
  private var stopCalled = false
  private var stopping = false
  private var done = false
  private var failure: Error?

  init(operationId: String, maxOutstandingBytes: Int, source: PcmExperimentalSource,
       emit: @escaping Emit) throws {
    self.operationId = operationId
    self.source = source
    self.emit = emit
    self.ledger = try PcmSequenceLedger(operationId: operationId, limit: maxOutstandingBytes)
  }

  func start() throws {
    condition.lock()
    defer { condition.unlock() }
    guard !started, !stopCalled else { throw PcmProducerError.invalidStop }
    started = true
    let worker = Thread { [self] in run() }
    thread = worker
    worker.start()
  }

  func acknowledge(_ sequence: Int64) throws {
    try ledger.acknowledge(operation: operationId, sequence: sequence)
  }

  /// Call off the UI thread. A timed-out or failed producer yields no marker.
  func stopAndJoin(timeout: TimeInterval) throws -> Int64 {
    condition.lock()
    guard timeout > 0, started, !stopCalled, Thread.current !== thread else {
      condition.unlock()
      throw PcmProducerError.invalidStop
    }
    stopCalled = true
    stopping = true
    condition.unlock()
    do { try source.requestStop() } catch { record(error) }

    let deadline = Date(timeIntervalSinceNow: timeout)
    condition.lock()
    while !done {
      if !condition.wait(until: deadline) && !done {
        condition.unlock()
        throw PcmProducerError.timeout
      }
    }
    let error = failure
    condition.unlock()
    if let error { throw PcmProducerError.failed(error) }
    return try ledger.finish(operation: operationId)
  }

  private func run() {
    do {
      while true {
        guard let bytes = try source.read() else {
          condition.lock()
          let isStopping = stopping
          condition.unlock()
          if !isStopping { throw PcmProducerError.unexpectedEnd }
          break
        }
        let sequence = try ledger.reserve(operation: operationId, bytes: bytes.count)
        try emit(operationId, sequence, bytes)
      }
    } catch { record(error) }
    do { try source.close() } catch { record(error) }
    condition.lock()
    done = true
    condition.broadcast()
    condition.unlock()
  }

  private func record(_ error: Error) {
    condition.lock()
    if failure == nil { failure = error }
    condition.unlock()
  }
}
