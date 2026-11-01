import Foundation

protocol PcmExperimentalSource: AnyObject {
  /// Returns nil only after a requested stop.
  func read() throws -> Data?
  /// Requests that a blocked read return; the controller bounds its wait.
  func requestStop() throws
  func close() throws
}

enum PcmProducerError: Error {
  case invalidStop
  case unexpectedEnd
  case timeout
  case workerStart(Int32)
  case workerJoin(Int32)
  case failed(Error)
}

/// Experimental controller; it is not connected to AudioQueue.
final class PcmProducer: @unchecked Sendable {
  typealias Emit = (String, Int64, Data) throws -> Void
  private let operationId: String
  private let source: PcmExperimentalSource
  private let emit: Emit
  private let releaseAuthority: () throws -> Void
  private let ledger: PcmSequenceLedger
  private let condition = NSCondition()
  private var thread: OpaquePointer?
  private var started = false
  private var stopCalled = false
  private var stopping = false
  private var sourceClosed = false
  private var failure: Error?

  init(operationId: String, maxOutstandingBytes: Int, source: PcmExperimentalSource,
       releaseAuthority: @escaping () throws -> Void = {}, emit: @escaping Emit) throws {
    self.operationId = operationId
    self.source = source
    self.emit = emit
    self.releaseAuthority = releaseAuthority
    self.ledger = try PcmSequenceLedger(operationId: operationId, limit: maxOutstandingBytes)
  }

  func start() throws {
    condition.lock()
    defer { condition.unlock() }
    guard !started, !stopCalled else { throw PcmProducerError.invalidStop }
    let context = Unmanaged.passRetained(self).toOpaque()
    var code: Int32 = 0
    guard let worker = pcm_thread_start({ raw in
      guard let raw else { return }
      Unmanaged<PcmProducer>.fromOpaque(raw).takeRetainedValue().run()
    }, context, &code) else {
      Unmanaged<PcmProducer>.fromOpaque(context).release()
      throw PcmProducerError.workerStart(code)
    }
    thread = worker
    started = true
  }

  func acknowledge(_ sequence: Int64) throws {
    try ledger.acknowledge(operation: operationId, sequence: sequence)
  }

  /// Call off the UI thread. A timed-out or failed producer yields no marker.
  func stopAndJoin(timeout: TimeInterval) throws -> Int64 {
    condition.lock()
    guard timeout.isFinite, timeout > 0, timeout < Double(Int.max / 1_000_000_000),
          started, !stopCalled, let worker = thread, pcm_thread_is_current(worker) == 0 else {
      condition.unlock()
      throw PcmProducerError.invalidStop
    }
    stopCalled = true
    stopping = true
    condition.unlock()
    let nanos = max(1, Int(timeout * 1_000_000_000))
    let deadline = DispatchTime.now() + .nanoseconds(nanos)
    let requesterDone = DispatchGroup()
    requesterDone.enter()
    let requester = Thread { [self] in
      defer { requesterDone.leave() }
      do { try source.requestStop() } catch { record(error) }
    }
    requester.start()
    let cleanupDone = DispatchSemaphore(value: 0)
    let cleanup = Thread { [self] in
      requesterDone.wait()
      let joinCode = pcm_thread_join(worker)
      if joinCode != 0 {
        record(PcmProducerError.workerJoin(joinCode))
        cleanupDone.signal()
        return
      }
      condition.lock()
      let didClose = sourceClosed
      condition.unlock()
      if didClose {
        do { try releaseAuthority() } catch { record(error) }
      }
      condition.lock()
      thread = nil
      condition.unlock()
      cleanupDone.signal()
    }
    cleanup.start()
    guard cleanupDone.wait(timeout: deadline) == .success else {
      throw PcmProducerError.timeout
    }
    condition.lock()
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
        let snapshot = bytes.withUnsafeBytes { raw in
          Data(bytes: raw.baseAddress!, count: raw.count)
        }
        try emit(operationId, sequence, snapshot)
      }
    } catch { record(error) }
    do {
      try source.close()
      condition.lock()
      sourceClosed = true
      condition.unlock()
    } catch { record(error) }
  }

  private func record(_ error: Error) {
    condition.lock()
    if failure == nil { failure = error }
    condition.unlock()
  }
}
