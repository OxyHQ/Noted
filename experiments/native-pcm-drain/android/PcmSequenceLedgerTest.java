import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

public final class PcmSequenceLedgerTest {
  private static void check(boolean value, String message) {
    if (!value) throw new AssertionError(message);
  }
  private static void fails(Runnable runnable) {
    try { runnable.run(); } catch (IllegalStateException expected) { return; }
    throw new AssertionError("Expected failure");
  }
  public static void main(String[] args) throws Exception {
    PcmSequenceLedger ledger = new PcmSequenceLedger("A", 4);
    check(ledger.reserve("A", 2) == 0, "first sequence");
    check(ledger.reserve("A", 2) == 1, "second sequence");
    ledger.acknowledge("A", 0);
    check(ledger.reserve("A", 2) == 2, "credit released");
    check(ledger.finish("A") == 2, "final sequence");
    ledger.acknowledge("A", 1);
    ledger.acknowledge("A", 2);
    fails(() -> ledger.reserve("A", 1));

    PcmSequenceLedger overflow = new PcmSequenceLedger("A", 1);
    overflow.reserve("A", 1);
    fails(() -> overflow.reserve("A", 1));
    fails(() -> overflow.finish("A"));
    PcmSequenceLedger duplicate = new PcmSequenceLedger("A", 10);
    duplicate.reserve("A", 1);
    duplicate.acknowledge("A", 0);
    fails(() -> duplicate.acknowledge("A", 0));
    fails(() -> duplicate.finish("A"));
    PcmSequenceLedger wrong = new PcmSequenceLedger("A", 10);
    fails(() -> wrong.reserve("B", 1));
    fails(() -> wrong.finish("A"));

    for (int iteration = 0; iteration < 100; iteration++) {
      PcmSequenceLedger concurrent = new PcmSequenceLedger("A", 100_000);
      List<Long> issued = Collections.synchronizedList(new ArrayList<>());
      CountDownLatch start = new CountDownLatch(1);
      ExecutorService pool = Executors.newFixedThreadPool(5);
      List<Future<?>> tasks = new ArrayList<>();
      for (int thread = 0; thread < 4; thread++) {
        tasks.add(pool.submit(() -> {
          start.await();
          for (int i = 0; i < 1000; i++) {
            try { issued.add(concurrent.reserve("A", 1)); }
            catch (IllegalStateException stopped) {
              check(stopped.getMessage().equals("PCM producer already stopped"), "unexpected failure");
              break;
            }
          }
          return null;
        }));
      }
      Future<Long> stop = pool.submit(() -> { start.await(); return concurrent.finish("A"); });
      start.countDown();
      long last = stop.get();
      for (Future<?> task : tasks) task.get();
      pool.shutdown();
      Collections.sort(issued);
      check(last == issued.size() - 1, "stop includes every reservation");
      for (int i = 0; i < issued.size(); i++) check(issued.get(i) == i, "contiguous sequences");
    }
    System.out.println("PCM ledger Java tests passed");
  }
}
