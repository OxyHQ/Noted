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
