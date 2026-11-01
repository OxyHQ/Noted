//! Diagnostic only. This is not used by Noted or a release launcher.
use std::{env, path::Path, process::{self, Command}};

#[derive(Clone, Copy, Debug, Default)]
struct Features {
    sse42: bool,
    avx: bool,
    avx2: bool,
    bmi2: bool,
    fma: bool,
    f16c: bool,
}

#[derive(Debug, PartialEq, Eq)]
enum Variant { Baseline, Avx2 }

fn choose(features: Features, avx2_present: bool) -> Variant {
    if avx2_present && features.sse42 && features.avx && features.avx2 && features.bmi2 && features.fma && features.f16c {
        Variant::Avx2
    } else {
        Variant::Baseline
    }
}

#[cfg(target_arch = "x86_64")]
fn features() -> Features {
    Features {
        sse42: std::is_x86_feature_detected!("sse4.2"),
        avx: std::is_x86_feature_detected!("avx"),
        avx2: std::is_x86_feature_detected!("avx2"),
        bmi2: std::is_x86_feature_detected!("bmi2"),
        fma: std::is_x86_feature_detected!("fma"),
        f16c: std::is_x86_feature_detected!("f16c"),
    }
}
#[cfg(not(target_arch = "x86_64"))]
fn features() -> Features { Features::default() }

fn run(args: Vec<std::ffi::OsString>, directory: &Path) -> Result<i32, String> {
    let force_baseline = args.first().is_some_and(|arg| arg == "--probe-force-baseline");
    let report_only = args.first().is_some_and(|arg| arg == "--probe-select");
    let variant = if force_baseline { Variant::Baseline } else { choose(features(), directory.join("whisper-avx2").is_file()) };
    let name = match variant { Variant::Baseline => "whisper-baseline", Variant::Avx2 => "whisper-avx2" };
    if report_only { println!("selected={name}"); return Ok(0); }
    eprintln!("diagnostic selected={name}");
    let skip = if force_baseline { 1 } else { 0 };
    let status = Command::new(directory.join(name)).args(args.into_iter().skip(skip)).status().map_err(|error| error.to_string())?;
    Ok(status.code().unwrap_or(1))
}

fn main() {
    let result = env::current_exe().map_err(|error| error.to_string()).and_then(|exe| {
        let dir = exe.parent().ok_or_else(|| "no executable directory".to_string())?;
        run(env::args_os().skip(1).collect(), dir)
    });
    match result { Ok(code) => process::exit(code), Err(error) => { eprintln!("{error}"); process::exit(1); } }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn all() -> Features { Features { sse42:true, avx:true, avx2:true, bmi2:true, fma:true, f16c:true } }
    #[test]
    fn no_features_and_missing_binary_use_baseline() {
        assert_eq!(choose(Features::default(), true), Variant::Baseline);
        assert_eq!(choose(all(), false), Variant::Baseline);
        assert_eq!(choose(all(), true), Variant::Avx2);
    }
    #[test]
    fn every_missing_required_feature_uses_baseline() {
        for feature in 0..6 {
            let mut f=all();
            match feature { 0=>f.sse42=false, 1=>f.avx=false, 2=>f.avx2=false, 3=>f.bmi2=false, 4=>f.fma=false, _=>f.f16c=false }
            assert_eq!(choose(f,true),Variant::Baseline);
        }
    }
}
