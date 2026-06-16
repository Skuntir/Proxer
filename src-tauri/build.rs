fn main() {
    println!("cargo:rerun-if-changed=tauri.conf.json");
    println!("cargo:rerun-if-changed=windows/app.manifest");
    println!("cargo:rustc-check-cfg=cfg(desktop)");
    println!("cargo:rustc-cfg=desktop");
    println!("cargo:rustc-check-cfg=cfg(dev)");

    if std::env::var("PROFILE")
        .map(|p| p == "debug")
        .unwrap_or(false)
    {
        println!("cargo:rustc-cfg=dev");
    }

    if std::env::var("CARGO_CFG_TARGET_OS").ok().as_deref() == Some("windows") {
        let manifest = std::path::Path::new("windows/app.manifest")
            .canonicalize()
            .expect("windows/app.manifest is required for Windows builds");
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
        println!("cargo:rustc-link-arg=/WX");
    }
}
