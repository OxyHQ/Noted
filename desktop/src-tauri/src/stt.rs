//! On-device transcription for the desktop shell, by running `whisper.cpp` as a
//! sidecar process.
//!
//! The webview cannot do this itself: WebKitGTK has no WebGPU and no threads, so
//! the web build's in-browser Whisper would be slow WASM (see
//! `docs/desktop-audio.mdx`). The phones run whisper.cpp natively; this runs the
//! same engine as a command-line binary and hands the webview back what the app
//! stores: text, with millisecond offsets.
//!
//! Audio never leaves the machine. The samples go to a temporary WAV, `whisper-cli`
//! reads it, and both the file and its JSON result are deleted afterwards.
//!
//! Everything below the Tauri command is a plain function so it can be tested
//! without a window; `desktop/sidecar/verify.mjs` and the `Whisper sidecar`
//! workflow check the real binary and the real model.

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicU64, Ordering},
};
use tauri::{AppHandle, Manager};

/// What whisper models expect.
pub const SAMPLE_RATE: u32 = 16_000;

/// One stretch of speech, as the app's `transcript_segments` table keeps it.
#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub text: String,
    pub start_ms: u64,
    pub end_ms: u64,
}

#[derive(Deserialize)]
struct Output {
    transcription: Vec<Item>,
}

#[derive(Deserialize)]
struct Item {
    text: String,
    offsets: Offsets,
}

#[derive(Deserialize)]
struct Offsets {
    from: i64,
    to: i64,
}

/// Read the JSON `whisper-cli -oj` writes. Empty segments are dropped (whisper
/// emits blank ones for silence) and negative offsets clamp to zero.
pub fn parse_output(json: &str) -> Result<Vec<Segment>, String> {
    let output: Output = serde_json::from_str(json).map_err(|error| error.to_string())?;
    Ok(output
        .transcription
        .into_iter()
        .filter_map(|item| {
            let text = item.text.trim().to_string();
            if text.is_empty() {
                return None;
            }
            Some(Segment {
                text,
                start_ms: item.offsets.from.max(0) as u64,
                end_ms: item.offsets.to.max(0) as u64,
            })
        })
        .collect())
}

/// A 16 kHz, mono, 16-bit PCM WAV of `samples` (floats in -1..1).
pub fn wav_bytes(samples: &[f32]) -> Vec<u8> {
    let data_len = (samples.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + samples.len() * 2);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVE");
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes()); // size of the fmt chunk
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&1u16.to_le_bytes()); // mono
    out.extend_from_slice(&SAMPLE_RATE.to_le_bytes());
    out.extend_from_slice(&(SAMPLE_RATE * 2).to_le_bytes()); // bytes per second
    out.extend_from_slice(&2u16.to_le_bytes()); // bytes per frame
    out.extend_from_slice(&16u16.to_le_bytes()); // bits per sample
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for sample in samples {
        // NaN becomes silence rather than a click; anything out of range clamps.
        let value = if sample.is_nan() { 0.0 } else { sample.clamp(-1.0, 1.0) };
        out.extend_from_slice(&((value * 32_767.0).round() as i16).to_le_bytes());
    }
    out
}

/// Samples as the webview sends them: base64 of little-endian `f32`s.
pub fn decode_samples(encoded: &str) -> Result<Vec<f32>, String> {
    let bytes = STANDARD.decode(encoded).map_err(|error| error.to_string())?;
    if bytes.len() % 4 != 0 {
        return Err("samples are not a whole number of 32-bit floats".to_string());
    }
    Ok(bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect())
}

/// `auto`, or a two- or three-letter language code. The value reaches a command
/// line, so nothing else gets through.
pub fn valid_language(language: &str) -> bool {
    language == "auto"
        || ((2..=3).contains(&language.len()) && language.chars().all(|c| c.is_ascii_lowercase()))
}

static RUNS: AtomicU64 = AtomicU64::new(0);

/// Run `binary` on `wav` with `model` and return the segments.
pub fn transcribe_wav(
    binary: &Path,
    model: &Path,
    wav: &Path,
    language: &str,
) -> Result<Vec<Segment>, String> {
    if !valid_language(language) {
        return Err("invalid language".to_string());
    }
    let workdir = std::env::temp_dir().join(format!(
        "noted-stt-{}-{}",
        std::process::id(),
        RUNS.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(&workdir).map_err(|error| error.to_string())?;
    let result = run_in(&workdir, binary, model, wav, language);
    // The recording's words are in that JSON: never leave it behind.
    let _ = fs::remove_dir_all(&workdir);
    result
}

fn run_in(
    workdir: &Path,
    binary: &Path,
    model: &Path,
    wav: &Path,
    language: &str,
) -> Result<Vec<Segment>, String> {
    let out_base = workdir.join("result");
    let output = Command::new(binary)
        .arg("-m")
        .arg(model)
        .arg("-f")
        .arg(wav)
        .args(["-l", language, "-oj", "-of"])
        .arg(&out_base)
        .output()
        .map_err(|error| format!("could not start the transcriber: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "the transcriber failed ({}): {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let json = fs::read_to_string(out_base.with_extension("json"))
        .map_err(|error| format!("the transcriber wrote no result: {error}"))?;
    parse_output(&json)
}

/// Where the sidecar lives: next to the app's own executable, which is where Tauri
/// puts an `externalBin`. `NOTED_WHISPER_CLI` overrides it, for development and tests.
fn sidecar_path() -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("NOTED_WHISPER_CLI") {
        return Ok(PathBuf::from(path));
    }
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let name = if cfg!(windows) { "whisper-cli.exe" } else { "whisper-cli" };
    Ok(executable
        .parent()
        .ok_or_else(|| "the app has no directory".to_string())?
        .join(name))
}

/// Transcribe `samples` (base64 of 16 kHz mono `f32`s) with a model the app has
/// already downloaded into its data directory. Downloading is not done here.
#[tauri::command]
pub async fn stt_transcribe(
    app: AppHandle,
    samples: String,
    language: String,
    model: String,
) -> Result<Vec<Segment>, String> {
    if !crate::db::valid_name(&model) {
        return Err("invalid model name".to_string());
    }
    if !valid_language(&language) {
        return Err("invalid language".to_string());
    }
    let pcm = decode_samples(&samples)?;
    let binary = sidecar_path()?;
    let model_path = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("models")
        .join(&model);
    if !model_path.exists() {
        return Err("model_missing".to_string());
    }

    // The model takes seconds: keep it off the async runtime's workers.
    tauri::async_runtime::spawn_blocking(move || {
        let directory = std::env::temp_dir().join(format!(
            "noted-stt-input-{}-{}",
            std::process::id(),
            RUNS.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
        let wav = directory.join("input.wav");
        let outcome = fs::write(&wav, wav_bytes(&pcm))
            .map_err(|error| error.to_string())
            .and_then(|()| transcribe_wav(&binary, &model_path, &wav, &language));
        let _ = fs::remove_dir_all(&directory);
        outcome
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_OUTPUT: &str = r#"{
      "systeminfo": "ignored",
      "model": {"type": "tiny"},
      "result": {"language": "en"},
      "transcription": [
        {"timestamps": {"from": "00:00:00,000", "to": "00:00:03,000"},
         "offsets": {"from": 0, "to": 3000}, "text": " Hello there."},
        {"timestamps": {"from": "00:00:03,000", "to": "00:00:03,500"},
         "offsets": {"from": 3000, "to": 3500}, "text": "   "},
        {"timestamps": {"from": "00:00:03,500", "to": "00:00:05,000"},
         "offsets": {"from": 3500, "to": 5000}, "text": " General Kenobi."}
      ]
    }"#;

    #[test]
    fn parses_whispers_json_into_the_segments_the_app_stores() {
        let segments = parse_output(SAMPLE_OUTPUT).unwrap();
        assert_eq!(
            segments,
            vec![
                Segment { text: "Hello there.".into(), start_ms: 0, end_ms: 3000 },
                Segment { text: "General Kenobi.".into(), start_ms: 3500, end_ms: 5000 },
            ]
        );
    }

    #[test]
    fn clamps_negative_offsets_and_rejects_garbage() {
        let json = r#"{"transcription":[{"offsets":{"from":-20,"to":10},"text":"x"}]}"#;
        assert_eq!(parse_output(json).unwrap()[0].start_ms, 0);
        assert!(parse_output("not json").is_err());
        assert!(parse_output("{}").is_err());
    }

    #[test]
    fn writes_a_well_formed_16k_mono_wav() {
        let wav = wav_bytes(&[0.0, 1.0, -1.0, 0.5]);
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(u32::from_le_bytes(wav[4..8].try_into().unwrap()), 36 + 8);
        assert_eq!(u16::from_le_bytes(wav[22..24].try_into().unwrap()), 1); // mono
        assert_eq!(u32::from_le_bytes(wav[24..28].try_into().unwrap()), 16_000);
        assert_eq!(u16::from_le_bytes(wav[34..36].try_into().unwrap()), 16); // bits
        assert_eq!(&wav[36..40], b"data");
        assert_eq!(u32::from_le_bytes(wav[40..44].try_into().unwrap()), 8);
        let value = |i: usize| i16::from_le_bytes(wav[44 + i * 2..46 + i * 2].try_into().unwrap());
        assert_eq!((value(0), value(1), value(2), value(3)), (0, 32_767, -32_767, 16_384));
    }

    #[test]
    fn out_of_range_and_nan_samples_do_not_wrap_around() {
        let wav = wav_bytes(&[5.0, -5.0, f32::NAN]);
        let value = |i: usize| i16::from_le_bytes(wav[44 + i * 2..46 + i * 2].try_into().unwrap());
        assert_eq!((value(0), value(1), value(2)), (32_767, -32_767, 0));
    }

    #[test]
    fn decodes_what_the_webview_sends() {
        let floats = [0.25f32, -0.5, 1.0];
        let bytes: Vec<u8> = floats.iter().flat_map(|f| f.to_le_bytes()).collect();
        let encoded = STANDARD.encode(bytes);
        assert_eq!(decode_samples(&encoded).unwrap(), floats);
        assert!(decode_samples("!!!not base64").is_err());
        assert!(decode_samples(&STANDARD.encode([1u8, 2, 3])).is_err());
    }

    #[test]
    fn only_a_language_code_or_auto_reaches_the_command_line() {
        for ok in ["auto", "en", "es", "yue"] {
            assert!(valid_language(ok), "{ok:?}");
        }
        for bad in ["", "e", "english", "EN", "en;rm", "-l", "../x", "e n"] {
            assert!(!valid_language(bad), "{bad:?}");
        }
    }

    #[test]
    fn a_missing_transcriber_is_an_error_not_a_panic() {
        let nowhere = Path::new("/definitely/not/here/whisper-cli");
        let result = transcribe_wav(nowhere, nowhere, nowhere, "en");
        assert!(result.unwrap_err().contains("could not start"));
    }

    /// Reads a 16-bit PCM WAV's samples, finding the `data` chunk rather than
    /// assuming a 44-byte header.
    fn read_wav(path: &Path) -> Vec<f32> {
        let bytes = fs::read(path).unwrap();
        let mut at = 12;
        while at + 8 <= bytes.len() {
            let size = u32::from_le_bytes(bytes[at + 4..at + 8].try_into().unwrap()) as usize;
            if &bytes[at..at + 4] == b"data" {
                return bytes[at + 8..(at + 8 + size).min(bytes.len())]
                    .chunks_exact(2)
                    .map(|c| i16::from_le_bytes([c[0], c[1]]) as f32 / 32_768.0)
                    .collect();
            }
            at += 8 + size + (size % 2);
        }
        panic!("no data chunk in {path:?}");
    }

    /// Runs the REAL binary and model, when CI provides them
    /// (`.github/workflows/whisper-sidecar.yml`); skipped everywhere else.
    #[test]
    fn transcribes_a_real_sample_through_the_whole_path() {
        let (Ok(binary), Ok(model), Ok(sample)) = (
            std::env::var("WHISPER_CLI"),
            std::env::var("WHISPER_MODEL"),
            std::env::var("WHISPER_SAMPLE_WAV"),
        ) else {
            eprintln!("skipped: WHISPER_CLI, WHISPER_MODEL and WHISPER_SAMPLE_WAV are not set");
            return;
        };

        // The sample goes through the very path the webview's audio does: floats →
        // our WAV writer → the binary → our JSON parser.
        let wav = std::env::temp_dir().join("noted-stt-test-input.wav");
        fs::write(&wav, wav_bytes(&read_wav(Path::new(&sample)))).unwrap();
        let segments =
            transcribe_wav(Path::new(&binary), Path::new(&model), &wav, "en").unwrap();
        let _ = fs::remove_file(&wav);

        let text = segments.iter().map(|s| s.text.as_str()).collect::<Vec<_>>().join(" ");
        assert!(
            text.to_lowercase().contains("ask not what your country can do for you"),
            "unexpected transcript: {text}"
        );
        assert!(segments.iter().all(|s| s.end_ms > s.start_ms));
        let end = segments.last().unwrap().end_ms;
        assert!((9_000..=13_000).contains(&end), "ends at {end} ms");
    }
}
