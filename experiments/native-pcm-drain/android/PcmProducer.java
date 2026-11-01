import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/** Experimental source controller. It is not connected to Android AudioRecord. */
public final class PcmProducer {
  public interface Source {
    /** Returns null only after a requested stop. */
    byte[] read() throws Exception;
    /** Requests that a blocked read return; the controller bounds its wait. */
    void requestStop() throws Exception;
    void close() throws Exception;
  }
  public interface Emitter {
    void emit(String operationId, long sequence, byte[] bytes) throws Exception;
  }

  private final String operationId;
  private final Source source;
  private final Emitter emitter;
  private final Runnable releaseAuthority;
  private final PcmSequenceLedger ledger;
  private final AtomicBoolean stopping = new AtomicBoolean();
  private final AtomicReference<Throwable> failure = new AtomicReference<>();
  private final Thread thread;
  private boolean started;
  private boolean stopCalled;
  private volatile boolean sourceClosed;

  public PcmProducer(String operationId, long maxOutstandingBytes, Source source, Emitter emitter) {
    this(operationId, maxOutstandingBytes, source, emitter, () -> {});
  }

  public PcmProducer(String operationId, long maxOutstandingBytes, Source source, Emitter emitter,
                     Runnable releaseAuthority) {
    this.operationId = operationId;
    this.source = source;
    this.emitter = emitter;
    this.releaseAuthority = releaseAuthority;
    this.ledger = new PcmSequenceLedger(operationId, maxOutstandingBytes);
    this.thread = new Thread(this::run, "pcm-producer-experiment");
    this.thread.setDaemon(true);
  }

  public synchronized void start() {
    if (started || stopCalled) throw new IllegalStateException("PCM producer already started or stopped");
    thread.start();
    started = true;
  }

  public void acknowledge(long sequence) { ledger.acknowledge(operationId, sequence); }

  /** Call off the UI thread. A timed-out or failed producer yields no marker. */
  public long stopAndJoin(long timeoutMillis) throws Exception {
    synchronized (this) {
      if (timeoutMillis <= 0 || !started || stopCalled || Thread.currentThread() == thread) {
        throw new IllegalStateException("Invalid or repeated stop");
      }
      stopCalled = true;
      stopping.set(true);
    }
    Thread requester = new Thread(() -> {
      try { source.requestStop(); } catch (Throwable error) { failure.compareAndSet(null, error); }
    }, "pcm-stop-experiment");
    requester.setDaemon(true);
    requester.start();
    CountDownLatch cleanupDone = new CountDownLatch(1);
    Thread cleanup = new Thread(() -> {
      try {
        requester.join();
        thread.join();
        if (sourceClosed) releaseAuthority.run();
      } catch (Throwable error) { failure.compareAndSet(null, error); }
      finally { cleanupDone.countDown(); }
    }, "pcm-cleanup-experiment");
    cleanup.setDaemon(true);
    cleanup.start();
    if (!cleanupDone.await(timeoutMillis, TimeUnit.MILLISECONDS)) {
      throw new IllegalStateException("PCM producer did not stop");
    }
    Throwable error = failure.get();
    if (error != null) throw new IllegalStateException("PCM producer failed", error);
    return ledger.finish(operationId);
  }

  private void run() {
    try {
      while (true) {
        byte[] bytes = source.read();
        if (bytes == null) {
          if (!stopping.get()) throw new IllegalStateException("Unexpected PCM end");
          break;
        }
        long sequence = ledger.reserve(operationId, bytes.length);
        emitter.emit(operationId, sequence, bytes);
      }
    } catch (Throwable error) {
      failure.compareAndSet(null, error);
    } finally {
      try { source.close(); sourceClosed = true; }
      catch (Throwable error) { failure.compareAndSet(null, error); }
    }
  }
}
