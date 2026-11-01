import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

public final class PcmProducerTest {
  private static void check(boolean value, String message) {
    if (!value) throw new AssertionError(message);
  }
  private static final class Source implements PcmProducer.Source {
    final CountDownLatch entered = new CountDownLatch(1);
    final CountDownLatch stop = new CountDownLatch(1);
    final AtomicBoolean closed = new AtomicBoolean();
    private boolean produced;
    public byte[] read() throws InterruptedException {
      entered.countDown();
      stop.await();
      if (produced) return null;
      produced = true;
      return new byte[] {1, 2};
    }
    public void requestStop() { stop.countDown(); }
    public void close() { closed.set(true); }
  }

  public static void main(String[] args) throws Exception {
    Source source = new Source();
    CountDownLatch emitting = new CountDownLatch(1);
    CountDownLatch allowEmit = new CountDownLatch(1);
    AtomicInteger count = new AtomicInteger();
    PcmProducer producer = new PcmProducer("A", 16, source, (operation, sequence, bytes) -> {
      check(operation.equals("A") && sequence == 0 && bytes.length == 2, "event payload");
      count.incrementAndGet();
      emitting.countDown();
      allowEmit.await();
    });
    try { producer.stopAndJoin(100); throw new AssertionError("stop before start succeeded"); }
    catch (IllegalStateException expected) { check(expected.getMessage().contains("stop"), "stop error"); }
    producer.start();
    check(source.entered.await(2, TimeUnit.SECONDS), "reader started");
    ExecutorService executor = Executors.newSingleThreadExecutor();
    Future<Long> stopped = executor.submit(() -> producer.stopAndJoin(2000));
    check(emitting.await(2, TimeUnit.SECONDS), "last event entered emission");
    check(!stopped.isDone(), "stop must wait for the producer to exit");
    allowEmit.countDown();
    check(stopped.get(2, TimeUnit.SECONDS) == 0, "final marker");
    check(count.get() == 1 && source.closed.get(), "event and cleanup");
    producer.acknowledge(0);
    executor.shutdown();

    Source brokenSource = new Source();
    PcmProducer broken = new PcmProducer("B", 16, brokenSource, (operation, sequence, bytes) -> {
      throw new IllegalStateException("emitter failed");
    });
    broken.start();
    check(brokenSource.entered.await(2, TimeUnit.SECONDS), "broken reader started");
    try { broken.stopAndJoin(2000); throw new AssertionError("emission failure lost"); }
    catch (IllegalStateException expected) { check(expected.getCause() != null, "failure preserved"); }
    check(brokenSource.closed.get(), "failed producer closed");

    CountDownLatch blockedRead = new CountDownLatch(1);
    CountDownLatch releaseRead = new CountDownLatch(1);
    CountDownLatch cleanup = new CountDownLatch(1);
    PcmProducer stuck = new PcmProducer("C", 16, new PcmProducer.Source() {
      public byte[] read() throws InterruptedException {
        blockedRead.countDown();
        releaseRead.await();
        return null;
      }
      public void requestStop() {}
      public void close() { cleanup.countDown(); }
    }, (operation, sequence, bytes) -> {});
    stuck.start();
    check(blockedRead.await(2, TimeUnit.SECONDS), "stuck reader started");
    try { stuck.stopAndJoin(10); throw new AssertionError("unjoined producer returned a marker"); }
    catch (IllegalStateException expected) { check(expected.getMessage().contains("did not stop"), "timeout"); }
    releaseRead.countDown();
    check(cleanup.await(2, TimeUnit.SECONDS), "timed-out producer eventually closed");
    System.out.println("PCM producer JVM tests passed");
  }
}
