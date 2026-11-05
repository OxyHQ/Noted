import Foundation

private func expectFailure(_ body: () throws -> Void) {
  do { try body(); fatalError("Expected failure") } catch {}
}

private final class Results: @unchecked Sendable {
  private let lock = NSLock()
  private var sequences: [Int64] = []
  private var errors: [String] = []
  private var finalSequence: Int64?
  func add(_ sequence: Int64) { lock.lock(); defer { lock.unlock() }; sequences.append(sequence) }
  func fail(_ error: Error) { lock.lock(); defer { lock.unlock() }; errors.append("\(error)") }
  func setFinal(_ value: Int64) { lock.lock(); defer { lock.unlock() }; finalSequence = value }
  func snapshot() -> ([Int64], [String], Int64?) {
    lock.lock(); defer { lock.unlock() }; return (sequences.sorted(), errors, finalSequence)
  }
}

@main
struct PcmSequenceLedgerTest {
  static func main() throws {
    let ledger = try PcmSequenceLedger(operationId: "A", limit: 4)
    let first = try ledger.reserve(operation: "A", bytes: 2)
    let second = try ledger.reserve(operation: "A", bytes: 2)
    precondition(first == 0 && second == 1)
    try ledger.acknowledge(operation: "A", sequence: 0)
    let third = try ledger.reserve(operation: "A", bytes: 2)
    let final = try ledger.finish(operation: "A")
    precondition(third == 2 && final == 2)
    try ledger.acknowledge(operation: "A", sequence: 1)
    try ledger.acknowledge(operation: "A", sequence: 2)
    expectFailure { _ = try ledger.reserve(operation: "A", bytes: 1) }

    let overflow = try PcmSequenceLedger(operationId: "A", limit: 1)
    _ = try overflow.reserve(operation: "A", bytes: 1)
    expectFailure { _ = try overflow.reserve(operation: "A", bytes: 1) }
    expectFailure { _ = try overflow.finish(operation: "A") }
    let duplicate = try PcmSequenceLedger(operationId: "A", limit: 10)
    _ = try duplicate.reserve(operation: "A", bytes: 1)
    try duplicate.acknowledge(operation: "A", sequence: 0)
    expectFailure { try duplicate.acknowledge(operation: "A", sequence: 0) }
    expectFailure { _ = try duplicate.finish(operation: "A") }
    let wrong = try PcmSequenceLedger(operationId: "A", limit: 10)
    expectFailure { _ = try wrong.reserve(operation: "B", bytes: 1) }
    expectFailure { _ = try wrong.finish(operation: "A") }

    for _ in 0..<100 {
      let concurrent = try PcmSequenceLedger(operationId: "A", limit: 100_000)
      let results = Results()
      let group = DispatchGroup()
      let start = DispatchSemaphore(value: 0)
      let queue = DispatchQueue(label: "pcm-ledger-test", attributes: .concurrent)
      for _ in 0..<4 {
        group.enter()
        queue.async {
          defer { group.leave() }
          start.wait()
          for _ in 0..<1000 {
            do { results.add(try concurrent.reserve(operation: "A", bytes: 1)) }
            catch PcmLedgerError.stopped { break }
            catch { results.fail(error); break }
          }
        }
      }
      group.enter()
      queue.async {
        defer { group.leave() }
        start.wait()
        do { results.setFinal(try concurrent.finish(operation: "A")) }
        catch { results.fail(error) }
      }
      for _ in 0..<5 { start.signal() }
      group.wait()
      let (sequences, errors, last) = results.snapshot()
      precondition(errors.isEmpty && last == Int64(sequences.count - 1))
      precondition(sequences == sequences.indices.map { Int64($0) })
    }
    print("PCM ledger Swift tests passed")
  }
}
