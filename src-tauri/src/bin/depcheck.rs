use libloading::{Library, Symbol};

fn main() {
    println!("proxer depcheck");
    println!("exe: {:?}", std::env::current_exe().ok());
    println!("cwd: {:?}", std::env::current_dir().ok());
    println!();

    check_webview2_loader();
    println!();
    check_vc_runtime();
}

fn check_webview2_loader() {
    println!("[WebView2Loader]");

    let candidates = [
        "WebView2Loader.dll",
        "webview2loader.dll",
        "WebView2Loader.dll",
    ];

    for name in candidates {
        match unsafe { Library::new(name) } {
            Ok(lib) => {
                println!("loaded: {name}");
                unsafe {
                    let sym: std::result::Result<Symbol<unsafe extern "system" fn()>, _> =
                        lib.get(b"CreateCoreWebView2EnvironmentWithOptions\0");
                    match sym {
                        Ok(_) => println!("export OK: CreateCoreWebView2EnvironmentWithOptions"),
                        Err(e) => println!("export MISSING: CreateCoreWebView2EnvironmentWithOptions ({e})"),
                    }
                }
                return;
            }
            Err(_) => {}
        }
    }

    println!("failed to load WebView2Loader.dll from DLL search path");
}

fn check_vc_runtime() {
    println!("[MSVC runtime]");

    for dll in ["VCRUNTIME140.dll", "VCRUNTIME140_1.dll", "MSVCP140.dll"] {
        match unsafe { Library::new(dll) } {
            Ok(_) => println!("loaded: {dll}"),
            Err(e) => println!("missing: {dll} ({e})"),
        }
    }

    if let Ok(path) = std::env::var("PATH") {
        let first = path.split(';').take(8).collect::<Vec<_>>();
        println!("PATH head: {}", first.join(";"));
    }
}
