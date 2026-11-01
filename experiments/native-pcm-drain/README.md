# Native PCM sequence ledger experiment

The Android/JVM and Swift implementations reserve a monotonically increasing
sequence for each producer chunk, bound outstanding unacknowledged bytes and
return the last reserved sequence when stopped. They reject duplicate or wrong
acknowledgements, overflow and operation mismatches. Acknowledgement is credit
for transport, not proof that a file has been written or persisted. Stop may
return before all reserved events reach JavaScript; the receiver must wait for
every sequence through the marker and fail if any are absent.

These are standalone experiments. They are not wired to either microphone or
the app, and passing their tests does not establish a native producer barrier.
The caller must first stop and join the actual producer and handle callbacks in
flight. The current `@fugood/react-native-audio-pcm-stream` stop methods expose
no usable promise: Android only flips a flag while the read thread may emit
again; iOS also exports a void method. A native stop implementation, lifecycle
cleanup, event emission and JS reception need integration tests on both systems.
Apple documents synchronous stopping with [`AudioQueueStop(..., true)`](https://developer.apple.com/documentation/audiotoolbox/audioqueuestop%28_%3A_%3A%29),
but that does not establish React Native event delivery. Android documents the
blocking and nonblocking read modes in [`AudioRecord`](https://developer.android.com/reference/android/media/AudioRecord);
the lifecycle and behavior on actual devices still need measurement.

Experimental controllers run an injected source on a worker thread. They
request stop, wait for the worker and its cleanup, and only then return the
ledger marker. Their test sources hold a read and an emission open, inject an
emission failure and simulate a worker that will not stop. The contract assumes
an injected authority-release callback; it is called only after the stop request
and producer thread have both terminated. The timeout also covers a blocked stop
request. After a timeout no marker is issued and authority remains held until
cleanup actually completes. If source close fails, the authority remains held;
this prototype has no recovery mechanism for that case. Android uses a timed latch and iOS a monotonic
`DispatchTime` deadline plus `pthread_join`. This mock callback is not an actual
microphone or account lease. These controllers are not connected to AudioRecord
or AudioQueue and do not prove their behavior.

After the marker is returned the ledger cannot revoke it if the native producer
incorrectly emits or fails later. A real producer must prevent that condition
before returning it, while the receiver detects gaps, duplicates and timeouts.
Credits must only be acknowledged after JS has accepted the chunk into a
bounded pipeline. Slow consumers must fail visibly rather than drop audio.
Account identity, exclusive destination ownership, crash recovery and file
durability remain separate unsolved requirements.

The CI workflow compiles/runs the Java ledger on a JVM and the Swift ledger on
macOS, including concurrent stop/reserve races. It does not compile Android
framework integration, run the iOS microphone, test a device or prove bridge
delivery ordering.
