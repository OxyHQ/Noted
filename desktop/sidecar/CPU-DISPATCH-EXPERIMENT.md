# CPU dispatch experiment

This draft does not change the normal package or enable the Cargo feature. The
feature is solely for the diagnostic workflow. An opt-in x86_64 shell chooses
`whisper-avx2` next to the shell only when all six features required by the
experimental build are available; otherwise it uses the existing `whisper-cli`.
Other architectures keep the existing path and build, including their current
acceleration. `NOTED_WHISPER_CLI` still overrides selection. Failure of a
selected executable is reported; the shell does not silently retry a different
binary after a transcription has begun.

The workflow builds statically linked ggml/whisper variants and stages them in
a temporary Tauri `.deb`, then exercises both routes through the real shell.
System libraries remain dynamic. The build flags and source pin must remain in
sync with the feature checks, including compiler defaults and all transitive
instructions. A feature check alone does not establish binary compatibility.
Another isolated workflow builds the opt-in shell and temporary packages for
macOS ARM and Windows. It preserves the current ARM CMake defaults and executes
the packaged sidecars directly, but does not exercise the GUI or an installer.

This is not a release recipe: the normal build, staging and package config are
unchanged. The experimental path rejects a sidecar symlink at inspection time,
but the check and execution are separate and it does not verify the binary or
its parent directory. It has not established protected package
paths, signatures/notarization, old glibc or OS compatibility, macOS Intel,
native CPU fallback, or performance on user hardware. Missing-file fallback
does not prove a damaged optimized binary is safe to retry. The separate macOS
ARM diagnostic disabled Metal and therefore does not establish performance or
acceleration parity. Review and platform-specific packaged and signed tests are
required before the feature or a two-binary package can be enabled.
