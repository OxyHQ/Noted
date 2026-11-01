//! Speech model files for the desktop shell.
//!
//! The webview downloads a model (it already speaks HTTP, proxies and TLS) and hands
//! the bytes here in chunks; Rust owns the file. A model is only ever visible under
//! its final name after its size and sha256 have been checked against the catalogue
//! (`lib/stt/models.ts`), because a truncated model makes whisper.cpp crash rather
//! than fail: the download goes to `<name>.part` and is renamed on success.
//!
//! The pure functions take the directory so they are tested against a temp dir.

use base64::{engine::general_purpose::STANDARD, Engine};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

const PART: &str = ".part";

fn checked(name: &str) -> Result<(), String> {
    if !crate::db::valid_name(name) || name.ends_with(PART) {
        return Err("invalid model name".to_string());
    }
    Ok(())
}

fn part_path(dir: &Path, name: &str) -> PathBuf {
    dir.join(format!("{name}{PART}"))
}

/// Append `bytes` to the partial download; `reset` starts it afresh.
pub fn write_part(dir: &Path, name: &str, bytes: &[u8], reset: bool) -> Result<(), String> {
    checked(name)?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let mut options = OpenOptions::new();
    options.create(true).write(true);
    if reset {
        options.truncate(true);
    } else {
        options.append(true);
    }
    options
        .open(part_path(dir, name))
        .and_then(|mut file| file.write_all(bytes))
        .map_err(|e| e.to_string())
}

fn sha256_hex(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1 << 20];
    loop {
        let read = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// Verify the partial download and give it its final name. Confirmed size or
/// digest mismatches are deleted; I/O failures leave the partial for retry.
pub fn commit(dir: &Path, name: &str, bytes: u64, sha256: &str) -> Result<(), String> {
    checked(name)?;
    let part = part_path(dir, name);
    let size = fs::metadata(&part).map_err(|e| e.to_string())?.len();
    if size != bytes {
        let _ = fs::remove_file(&part);
        return Err(format!("size mismatch: got {size} bytes, expected {bytes}"));
    }
    let digest = sha256_hex(&part)?;
    if !digest.eq_ignore_ascii_case(sha256) {
        let _ = fs::remove_file(&part);
        return Err("sha256 mismatch".to_string());
    }
    fs::rename(&part, dir.join(name)).map_err(|e| e.to_string())
}

/// How much of a download is already on disk, so it can resume instead of restarting.
pub fn partial_size(dir: &Path, name: &str) -> Result<u64, String> {
    checked(name)?;
    match fs::metadata(part_path(dir, name)) {
        Ok(metadata) => Ok(metadata.len()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(0),
        Err(error) => Err(error.to_string()),
    }
}

/// Size of a finished model, if there is one.
pub fn size_of(dir: &Path, name: &str) -> Result<Option<u64>, String> {
    checked(name)?;
    match fs::metadata(dir.join(name)) {
        Ok(metadata) => Ok(Some(metadata.len())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

pub fn remove(dir: &Path, name: &str) -> Result<(), String> {
    checked(name)?;
    for path in [dir.join(name), part_path(dir, name)] {
        match fs::remove_file(path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(())
}

pub fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("models"))
}

#[tauri::command]
pub fn model_write(app: AppHandle, name: String, chunk: String, reset: bool) -> Result<(), String> {
    let bytes = STANDARD.decode(chunk).map_err(|e| e.to_string())?;
    write_part(&models_dir(&app)?, &name, &bytes, reset)
}

#[tauri::command]
pub async fn model_commit(
    app: AppHandle,
    name: String,
    bytes: u64,
    sha256: String,
) -> Result<(), String> {
    let dir = models_dir(&app)?;
    // Hashing a few hundred MB: off the async workers.
    tauri::async_runtime::spawn_blocking(move || commit(&dir, &name, bytes, &sha256))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn model_status(app: AppHandle, name: String) -> Result<Option<u64>, String> {
    size_of(&models_dir(&app)?, &name)
}

#[tauri::command]
pub fn model_partial(app: AppHandle, name: String) -> Result<u64, String> {
    partial_size(&models_dir(&app)?, &name)
}

#[tauri::command]
pub fn model_remove(app: AppHandle, name: String) -> Result<(), String> {
    remove(&models_dir(&app)?, &name)
}

#[cfg(test)]
mod tests {
    use super::*;

    // sha256("hello world")
    const HELLO: &str = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";

    fn scratch(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("noted-models-{label}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn a_verified_download_appears_only_under_its_final_name() {
        let dir = scratch("ok");
        write_part(&dir, "m.bin", b"hello ", true).unwrap();
        assert_eq!(size_of(&dir, "m.bin").unwrap(), None, "not visible while partial");
        write_part(&dir, "m.bin", b"world", false).unwrap();
        commit(&dir, "m.bin", 11, HELLO).unwrap();
        assert_eq!(size_of(&dir, "m.bin").unwrap(), Some(11));
        assert!(!part_path(&dir, "m.bin").exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn reset_starts_over_instead_of_appending_to_an_old_attempt() {
        let dir = scratch("reset");
        write_part(&dir, "m.bin", b"junkjunk", true).unwrap();
        write_part(&dir, "m.bin", b"hello world", true).unwrap();
        commit(&dir, "m.bin", 11, HELLO).unwrap();
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_wrong_size_or_hash_is_refused_and_leaves_nothing_behind() {
        let dir = scratch("bad");
        write_part(&dir, "m.bin", b"hello world", true).unwrap();
        assert!(commit(&dir, "m.bin", 12, HELLO).unwrap_err().contains("size"));
        assert!(!part_path(&dir, "m.bin").exists());

        write_part(&dir, "m.bin", b"hello worle", true).unwrap();
        assert!(commit(&dir, "m.bin", 11, HELLO).unwrap_err().contains("sha256"));
        assert!(!part_path(&dir, "m.bin").exists());
        assert_eq!(size_of(&dir, "m.bin").unwrap(), None);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn verified_partial_survives_a_publish_failure() {
        let dir = scratch("publish-failure");
        write_part(&dir, "m.bin", b"hello world", true).unwrap();
        fs::create_dir(dir.join("m.bin")).unwrap();
        assert!(commit(&dir, "m.bin", 11, HELLO).is_err());
        assert_eq!(fs::read(part_path(&dir, "m.bin")).unwrap(), b"hello world");
        fs::remove_dir(dir.join("m.bin")).unwrap();
        commit(&dir, "m.bin", 11, HELLO).unwrap();
        assert_eq!(size_of(&dir, "m.bin").unwrap(), Some(11));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn unreadable_partial_survives_a_hash_read_failure() {
        use std::os::unix::fs::PermissionsExt;

        let dir = scratch("hash-read-failure");
        write_part(&dir, "m.bin", b"hello world", true).unwrap();
        let part = part_path(&dir, "m.bin");
        fs::set_permissions(&part, fs::Permissions::from_mode(0o000)).unwrap();
        if File::open(&part).is_ok() {
            // Some environments, such as a root-run container, bypass permission bits.
            fs::set_permissions(&part, fs::Permissions::from_mode(0o600)).unwrap();
            fs::remove_dir_all(&dir).unwrap();
            return;
        }
        let result = commit(&dir, "m.bin", 11, HELLO);
        let retained = part.exists();
        if retained {
            fs::set_permissions(&part, fs::Permissions::from_mode(0o600)).unwrap();
        }
        fs::remove_dir_all(&dir).unwrap();
        assert!(result.is_err());
        assert!(retained, "a hash read failure must not delete the partial");
    }

    #[test]
    fn a_partial_download_reports_its_size_so_it_can_resume() {
        let dir = scratch("partial");
        assert_eq!(partial_size(&dir, "m.bin").unwrap(), 0);
        write_part(&dir, "m.bin", b"hello ", true).unwrap();
        assert_eq!(partial_size(&dir, "m.bin").unwrap(), 6);
        write_part(&dir, "m.bin", b"world", false).unwrap();
        assert_eq!(partial_size(&dir, "m.bin").unwrap(), 11);
        // Resuming stitches the halves into the same file a full download would make.
        commit(&dir, "m.bin", 11, HELLO).unwrap();
        assert_eq!(partial_size(&dir, "m.bin").unwrap(), 0);
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn inaccessible_partial_is_not_reported_as_missing() {
        use std::os::unix::fs::PermissionsExt;

        let dir = scratch("partial-metadata-failure");
        write_part(&dir, "m.bin", b"hello", true).unwrap();
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o000)).unwrap();
        if fs::metadata(part_path(&dir, "m.bin")).is_ok() {
            // A root-run environment can bypass directory permission bits.
            fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
            fs::remove_dir_all(&dir).unwrap();
            return;
        }
        let result = partial_size(&dir, "m.bin");
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
        let retained = fs::read(part_path(&dir, "m.bin")).unwrap();
        fs::remove_dir_all(&dir).unwrap();
        assert!(result.is_err(), "metadata failure must not look like a missing file");
        assert_eq!(retained, b"hello");
    }

    #[cfg(unix)]
    #[test]
    fn inaccessible_model_is_not_reported_as_missing() {
        use std::os::unix::fs::PermissionsExt;

        let dir = scratch("model-metadata-failure");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("m.bin"), b"model").unwrap();
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o000)).unwrap();
        if fs::metadata(dir.join("m.bin")).is_ok() {
            // A root-run environment can bypass directory permission bits.
            fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
            fs::remove_dir_all(&dir).unwrap();
            return;
        }
        let result = size_of(&dir, "m.bin");
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
        let retained = fs::read(dir.join("m.bin")).unwrap();
        fs::remove_dir_all(&dir).unwrap();
        assert!(result.is_err(), "metadata failure must not look like a missing file");
        assert_eq!(retained, b"model");
    }

    #[test]
    fn remove_clears_the_model_and_a_stray_partial_and_tolerates_absence() {
        let dir = scratch("rm");
        write_part(&dir, "m.bin", b"hello world", true).unwrap();
        commit(&dir, "m.bin", 11, HELLO).unwrap();
        write_part(&dir, "m.bin", b"x", true).unwrap();
        remove(&dir, "m.bin").unwrap();
        assert_eq!(size_of(&dir, "m.bin").unwrap(), None);
        assert!(!part_path(&dir, "m.bin").exists());
        remove(&dir, "m.bin").unwrap();
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn names_cannot_escape_the_directory_or_aim_at_partials() {
        let dir = scratch("names");
        for bad in ["", "../x", "a/b", ".hidden", "m.bin.part", "a b"] {
            assert!(write_part(&dir, bad, b"x", true).is_err(), "{bad:?}");
            assert!(size_of(&dir, bad).is_err(), "{bad:?}");
        }
        let _ = fs::remove_dir_all(&dir);
    }
}
