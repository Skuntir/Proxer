fn main() {
    println!("cargo:rerun-if-changed=tauri.conf.json");
    println!("cargo:rerun-if-changed=windows/app.manifest");
    println!("cargo:rustc-check-cfg=cfg(desktop)");
    println!("cargo:rustc-cfg=desktop");
    println!("cargo:rustc-check-cfg=cfg(dev)");

    if std::env::var("PROFILE").map(|p| p == "debug").unwrap_or(false) {
        println!("cargo:rustc-cfg=dev");
    }

    if std::env::var("CARGO_CFG_TARGET_OS").ok().as_deref() == Some("windows") {
        let manifest = std::fs::read("windows/app.manifest").unwrap_or_default();
        let profile = std::env::var("PROFILE").unwrap_or_else(|_| "debug".into());
        let out = std::path::PathBuf::from("target")
            .join(&profile)
            .join("proxer.exe.manifest");
        let _ = std::fs::create_dir_all(out.parent().unwrap());
        let _ = std::fs::write(out, manifest);
    }
}
