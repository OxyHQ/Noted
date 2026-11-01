import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.ArrayList;
import java.util.List;

public final class PcmProducerTest {
  private static void check(boolean value, String message) {
    if (!value) throw new AssertionError(message);
  }
  private static class Source implements PcmProducer.Source {
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
    CountDownLatch authorityReleased = new CountDownLatch(1);
    AtomicReference<Thread> actualProducerThread = new AtomicReference<>();
    PcmProducer stuck = new PcmProducer("C", 16, new PcmProducer.Source() {
      public byte[] read() throws InterruptedException {
        actualProducerThread.set(Thread.currentThread());
        blockedRead.countDown();
        releaseRead.await();
        return null;
      }
      public void requestStop() {}
      public void close() { cleanup.countDown(); }
    }, (operation, sequence, bytes) -> {}, () -> {
      check(!actualProducerThread.get().isAlive(), "authority released while producer thread alive");
      authorityReleased.countDown();
    });
    stuck.start();
    check(blockedRead.await(2, TimeUnit.SECONDS), "stuck reader started");
    try { stuck.stopAndJoin(10); throw new AssertionError("unjoined producer returned a marker"); }
    catch (IllegalStateException expected) { check(expected.getMessage().contains("did not stop"), "timeout"); }
    check(authorityReleased.getCount() == 1, "authority retained while worker lives");
    releaseRead.countDown();
    check(cleanup.await(2, TimeUnit.SECONDS), "timed-out producer eventually closed");
    check(authorityReleased.await(2, TimeUnit.SECONDS), "authority released after worker exit");

    CountDownLatch stopEntered = new CountDownLatch(1);
    CountDownLatch allowStop = new CountDownLatch(1);
    CountDownLatch stopAuthority = new CountDownLatch(1);
    Source stoppedSlowly = new Source() {
      public void requestStop() {
        stopEntered.countDown();
        try { allowStop.await(); } catch (InterruptedException error) { throw new RuntimeException(error); }
        stop.countDown();
      }
    };
    PcmProducer slowStop = new PcmProducer("D", 16, stoppedSlowly,
        (operation, sequence, bytes) -> {}, stopAuthority::countDown);
    slowStop.start();
    check(stoppedSlowly.entered.await(2, TimeUnit.SECONDS), "slow stop reader started");
    try { slowStop.stopAndJoin(10); throw new AssertionError("blocked stop returned a marker"); }
    catch (IllegalStateException expected) { check(expected.getMessage().contains("did not stop"), "stop timeout"); }
    check(stopEntered.getCount() == 0 && stopAuthority.getCount() == 1, "authority retained during requestStop");
    allowStop.countDown();
    check(stopAuthority.await(2, TimeUnit.SECONDS), "authority released after requestStop and worker finish");

    CountDownLatch failedCloseAuthority = new CountDownLatch(1);
    Source failedCloseSource = new Source() {
      public void close() { throw new IllegalStateException("close failed"); }
    };
    PcmProducer failedClose = new PcmProducer("E", 16, failedCloseSource,
        (operation, sequence, bytes) -> {}, failedCloseAuthority::countDown);
    failedClose.start();
    check(failedCloseSource.entered.await(2, TimeUnit.SECONDS), "failed-close reader started");
    try { failedClose.stopAndJoin(2000); throw new AssertionError("failed close returned a marker"); }
    catch (IllegalStateException expected) { check(expected.getCause() != null, "close error preserved"); }
    check(failedCloseAuthority.getCount() == 1, "authority retained after failed close");

    CountDownLatch twoEvents = new CountDownLatch(2);
    CountDownLatch finishReused = new CountDownLatch(1);
    List<byte[]> emitted = new ArrayList<>();
    PcmProducer reused = new PcmProducer("F", 16, new PcmProducer.Source() {
      private final byte[] buffer = new byte[] {1, 2};
      private int reads;
      public byte[] read() throws InterruptedException {
        if (reads++ == 0) return buffer;
        if (reads == 2) { buffer[0] = 3; return buffer; }
        finishReused.await();
        return null;
      }
      public void requestStop() { finishReused.countDown(); }
      public void close() {}
    }, (operation, sequence, bytes) -> { emitted.add(bytes); twoEvents.countDown(); });
    reused.start();
    check(twoEvents.await(2, TimeUnit.SECONDS), "reused buffer events");
    check(reused.stopAndJoin(2000) == 1, "reused buffer marker");
    check(emitted.get(0)[0] == 1 && emitted.get(1)[0] == 3, "each event owns a stable snapshot");
    System.out.println("PCM producer JVM tests passed");
  }
}
