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
    let stuck = try PcmProducer(operationId: "C", maxOutstandingBytes: 16, source: stuckSource) {
      _, _, _ in fatalError("Unexpected event")
    }
    try stuck.start()
    precondition(stuckSource.entered.wait(timeout: .now() + 2) == .success)
    do { _ = try stuck.stopAndJoin(timeout: 0.05); fatalError("Unjoined producer returned a marker") }
    catch PcmProducerError.timeout {}
    stuckSource.release.signal()
    precondition(stuckSource.closed.wait(timeout: .now() + 2) == .success)
    print("PCM producer Swift tests passed")
  }
}
