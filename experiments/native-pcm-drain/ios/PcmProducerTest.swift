import Foundation

private enum TestFailure: Error { case emission }

private final class Source: PcmExperimentalSource, @unchecked Sendable {
  let entered = DispatchSemaphore(value: 0)
  let stop = DispatchSemaphore(value: 0)
  let closed = DispatchSemaphore(value: 0)
  private var produced = false
  func read() throws -> Data? {
    entered.signal()
    stop.wait()
    if produced { return nil }
    produced = true
    // A second read must also observe the stop; a semaphore is not a broadcast.
    stop.signal()
    return Data([1, 2])
  }
  func requestStop() throws { stop.signal() }
  func close() throws { closed.signal() }
}

private final class StopResult: @unchecked Sendable {
  private let lock = NSLock()
  private var value: Int64?
  private var error: Error?
  let done = DispatchSemaphore(value: 0)
  func set(value: Int64) { lock.lock(); self.value = value; lock.unlock(); done.signal() }
  func set(error: Error) { lock.lock(); self.error = error; lock.unlock(); done.signal() }
  func snapshot() -> (Int64?, Error?) { lock.lock(); defer { lock.unlock() }; return (value, error) }
}

private final class StuckSource: PcmExperimentalSource, @unchecked Sendable {
  let entered = DispatchSemaphore(value: 0)
  let release = DispatchSemaphore(value: 0)
  let closed = DispatchSemaphore(value: 0)
  func read() throws -> Data? { entered.signal(); release.wait(); return nil }
  func requestStop() throws {}
  func close() throws { closed.signal() }
}

private final class SlowStopSource: PcmExperimentalSource, @unchecked Sendable {
  let readEntered = DispatchSemaphore(value: 0)
  let stopEntered = DispatchSemaphore(value: 0)
  let allowStop = DispatchSemaphore(value: 0)
  let finishRead = DispatchSemaphore(value: 0)
  func read() throws -> Data? { readEntered.signal(); finishRead.wait(); return nil }
  func requestStop() throws { stopEntered.signal(); allowStop.wait(); finishRead.signal() }
  func close() throws {}
}

private final class SlowCloseSource: PcmExperimentalSource, @unchecked Sendable {
  let readEntered = DispatchSemaphore(value: 0)
  let stopRequested = DispatchSemaphore(value: 0)
  let closeEntered = DispatchSemaphore(value: 0)
  let allowClose = DispatchSemaphore(value: 0)
  func read() throws -> Data? { readEntered.signal(); stopRequested.wait(); return nil }
  func requestStop() throws { stopRequested.signal() }
  func close() throws { closeEntered.signal(); allowClose.wait() }
}

private final class FailCloseSource: PcmExperimentalSource, @unchecked Sendable {
  let readEntered = DispatchSemaphore(value: 0)
  let stopRequested = DispatchSemaphore(value: 0)
  func read() throws -> Data? { readEntered.signal(); stopRequested.wait(); return nil }
  func requestStop() throws { stopRequested.signal() }
  func close() throws { throw TestFailure.emission }
}

private final class ReusedSource: PcmExperimentalSource, @unchecked Sendable {
  let stopped = DispatchSemaphore(value: 0)
  let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: 2)
  private var reads = 0
  init() { buffer.initialize(repeating: 0, count: 2) }
  deinit { buffer.deinitialize(count: 2); buffer.deallocate() }
  func read() throws -> Data? {
    reads += 1
    if reads <= 2 {
      buffer[0] = reads == 1 ? 1 : 3
      buffer[1] = 2
      return Data(bytesNoCopy: UnsafeMutableRawPointer(buffer), count: 2, deallocator: .none)
    }
    stopped.wait()
    return nil
  }
  func requestStop() throws { stopped.signal() }
  func close() throws {}
}

private final class CapturedEvents: @unchecked Sendable {
  private let lock = NSLock()
  private var events: [Data] = []
  let received = DispatchSemaphore(value: 0)
  func add(_ data: Data) { lock.lock(); events.append(data); lock.unlock(); received.signal() }
  func firstBytes() -> [UInt8] { lock.lock(); defer { lock.unlock() }; return events.map { $0[0] } }
}

@main
struct PcmProducerTest {
  static func main() throws {
    let source = Source()
    let emitting = DispatchSemaphore(value: 0)
    let allowEmit = DispatchSemaphore(value: 0)
    let producer = try PcmProducer(operationId: "A", maxOutstandingBytes: 16, source: source) {
      operation, sequence, bytes in
      precondition(operation == "A" && sequence == 0 && bytes == Data([1, 2]))
      emitting.signal()
      allowEmit.wait()
    }
    do { _ = try producer.stopAndJoin(timeout: 1); fatalError("Stop before start succeeded") }
    catch PcmProducerError.invalidStop {}
    try producer.start()
    precondition(source.entered.wait(timeout: .now() + 2) == .success)
    let result = StopResult()
    DispatchQueue.global().async {
      do { result.set(value: try producer.stopAndJoin(timeout: 2)) }
      catch { result.set(error: error) }
    }
    precondition(emitting.wait(timeout: .now() + 2) == .success)
    precondition(result.done.wait(timeout: .now() + 0.05) == .timedOut)
    allowEmit.signal()
    precondition(result.done.wait(timeout: .now() + 2) == .success)
    let (marker, error) = result.snapshot()
    precondition(marker == 0 && error == nil)
    precondition(source.closed.wait(timeout: .now() + 2) == .success)
    try producer.acknowledge(0)

    let failedSource = Source()
    let broken = try PcmProducer(operationId: "B", maxOutstandingBytes: 16, source: failedSource) {
      _, _, _ in throw TestFailure.emission
    }
    try broken.start()
    precondition(failedSource.entered.wait(timeout: .now() + 2) == .success)
    do { _ = try broken.stopAndJoin(timeout: 2); fatalError("Emission failure lost") }
    catch PcmProducerError.failed(_) {}
    precondition(failedSource.closed.wait(timeout: .now() + 2) == .success)

    let stuckSource = StuckSource()
    let authorityReleased = DispatchSemaphore(value: 0)
    let stuck = try PcmProducer(operationId: "C", maxOutstandingBytes: 16, source: stuckSource,
                                releaseAuthority: { authorityReleased.signal() }) {
      _, _, _ in fatalError("Unexpected event")
    }
    try stuck.start()
    precondition(stuckSource.entered.wait(timeout: .now() + 2) == .success)
    do { _ = try stuck.stopAndJoin(timeout: 0.05); fatalError("Unjoined producer returned a marker") }
    catch PcmProducerError.timeout {}
    precondition(authorityReleased.wait(timeout: .now()) == .timedOut)
    stuckSource.release.signal()
    precondition(stuckSource.closed.wait(timeout: .now() + 2) == .success)
    precondition(authorityReleased.wait(timeout: .now() + 2) == .success)

    let slowSource = SlowStopSource()
    let slowAuthority = DispatchSemaphore(value: 0)
    let slow = try PcmProducer(operationId: "D", maxOutstandingBytes: 16, source: slowSource,
                               releaseAuthority: { slowAuthority.signal() }) { _, _, _ in }
    try slow.start()
    precondition(slowSource.readEntered.wait(timeout: .now() + 2) == .success)
    do { _ = try slow.stopAndJoin(timeout: 0.05); fatalError("Blocked stop returned a marker") }
    catch PcmProducerError.timeout {}
    precondition(slowSource.stopEntered.wait(timeout: .now()) == .success)
    precondition(slowAuthority.wait(timeout: .now()) == .timedOut)
    slowSource.allowStop.signal()
    precondition(slowAuthority.wait(timeout: .now() + 2) == .success)

    let closeSource = SlowCloseSource()
    let closeAuthority = DispatchSemaphore(value: 0)
    let closing = try PcmProducer(operationId: "E", maxOutstandingBytes: 16, source: closeSource,
                                  releaseAuthority: { closeAuthority.signal() }) { _, _, _ in }
    try closing.start()
    precondition(closeSource.readEntered.wait(timeout: .now() + 2) == .success)
    do { _ = try closing.stopAndJoin(timeout: 0.05); fatalError("Blocked cleanup returned a marker") }
    catch PcmProducerError.timeout {}
    precondition(closeSource.closeEntered.wait(timeout: .now()) == .success)
    precondition(closeAuthority.wait(timeout: .now()) == .timedOut)
    closeSource.allowClose.signal()
    precondition(closeAuthority.wait(timeout: .now() + 2) == .success)

    let failedCloseSource = FailCloseSource()
    let failedCloseAuthority = DispatchSemaphore(value: 0)
    let failedClose = try PcmProducer(operationId: "F", maxOutstandingBytes: 16,
                                      source: failedCloseSource,
                                      releaseAuthority: { failedCloseAuthority.signal() }) { _, _, _ in }
    try failedClose.start()
    precondition(failedCloseSource.readEntered.wait(timeout: .now() + 2) == .success)
    do { _ = try failedClose.stopAndJoin(timeout: 2); fatalError("Failed close returned a marker") }
    catch PcmProducerError.failed(_) {}
    precondition(failedCloseAuthority.wait(timeout: .now()) == .timedOut)

    let reusedSource = ReusedSource()
    let events = CapturedEvents()
    let reused = try PcmProducer(operationId: "G", maxOutstandingBytes: 16, source: reusedSource) {
      _, _, bytes in events.add(bytes)
    }
    try reused.start()
    precondition(events.received.wait(timeout: .now() + 2) == .success)
    precondition(events.received.wait(timeout: .now() + 2) == .success)
    let reusedMarker = try reused.stopAndJoin(timeout: 2)
    precondition(reusedMarker == 1 && events.firstBytes() == [1, 3])
    print("PCM producer Swift tests passed")
  }
}
