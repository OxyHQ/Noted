import java.util.HashMap;
import java.util.Map;

/** Experimental producer ledger. This does not stop a microphone or emit events. */
public final class PcmSequenceLedger {
  private static final long MAX_SEQUENCE = 9_007_199_254_740_990L;
  private final String operationId;
  private final long limit;
  private final Map<Long, Integer> awaiting = new HashMap<>();
  private long outstanding;
  private long next;
  private boolean stopped;
  private String failure;

  public PcmSequenceLedger(String operationId, long limit) {
    if (operationId == null || operationId.isEmpty() || limit <= 0) {
      throw new IllegalArgumentException("Invalid PCM ledger configuration");
    }
    this.operationId = operationId;
    this.limit = limit;
  }

  /** Reserve a sequence before emitting its chunk; acknowledgement releases credit. */
  public synchronized long reserve(String operation, int bytes) {
    check();
    if (stopped) throw new IllegalStateException("PCM producer already stopped");
    if (!operationId.equals(operation) || bytes <= 0 || bytes > limit - outstanding || next > MAX_SEQUENCE) {
      throw fail("Invalid or excessive PCM event");
    }
    long sequence = next++;
    awaiting.put(sequence, bytes);
    outstanding += bytes;
    return sequence;
  }

  /** Acknowledgement is transport credit, not proof of durable storage. */
  public synchronized void acknowledge(String operation, long sequence) {
    check();
    if (!operationId.equals(operation)) throw fail("Wrong PCM operation");
    Integer bytes = awaiting.remove(sequence);
    if (bytes == null) throw fail("Unknown or duplicate PCM acknowledgement");
    outstanding -= bytes;
  }

  /** Call only after the real native producer has stopped and joined. */
  public synchronized long finish(String operation) {
    check();
    if (!operationId.equals(operation) || stopped) throw fail("Invalid PCM stop");
    stopped = true;
    return next - 1;
  }

  private void check() {
    if (failure != null) throw new IllegalStateException(failure);
  }

  private IllegalStateException fail(String message) {
    if (failure == null) failure = message;
    return new IllegalStateException(failure);
  }
}
