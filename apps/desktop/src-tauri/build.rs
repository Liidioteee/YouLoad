use std::path::Path;

use sha2::{Digest, Sha256};

/// Files the elevated bypass helper is allowed to run. Their hashes are compiled into
/// the binary, so a swapped winws.exe in the (user-writable) install folder is refused.
const ZAPRET_BINARIES: &[&str] = &["winws.exe", "WinDivert.dll", "WinDivert64.sys", "cygwin1.dll"];

fn main() {
    let zapret = Path::new("resources/tools/zapret");
    let mut entries = Vec::new();
    for name in ZAPRET_BINARIES {
        let path = zapret.join(name);
        println!("cargo:rerun-if-changed={}", path.display());
        if let Ok(bytes) = std::fs::read(&path) {
            let hex: String = Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect();
            entries.push(format!("(\"{name}\", \"{hex}\")"));
        }
    }
    let out = Path::new(&std::env::var("OUT_DIR").unwrap()).join("zapret_hashes.rs");
    std::fs::write(out, format!("pub const ZAPRET_HASHES: &[(&str, &str)] = &[{}];\n", entries.join(", "))).unwrap();
    println!("cargo:rerun-if-changed=resources/tools/zapret/strategies.json");
    println!("cargo:rerun-if-changed=resources/app/youtube-hosts.txt");

    tauri_build::build()
}
