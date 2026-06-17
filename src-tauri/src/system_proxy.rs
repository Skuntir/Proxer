use std::net::SocketAddr;

#[cfg(windows)]
pub fn enable_system_proxy(bind: SocketAddr) -> Result<(), String> {
    use windows_sys::Win32::Networking::WinInet::{
        InternetSetOptionW, INTERNET_OPTION_REFRESH, INTERNET_OPTION_SETTINGS_CHANGED,
    };
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WRITE};
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let internet = hkcu
        .open_subkey_with_flags(
            "Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
            KEY_READ | KEY_WRITE,
        )
        .map_err(|e| e.to_string())?;

    let backup_root = hkcu
        .create_subkey("Software\\Proxer\\ProxyBackup")
        .map_err(|e| e.to_string())?
        .0;

    let prev_enable: u32 = internet.get_value("ProxyEnable").unwrap_or(0);
    let prev_server: String = internet.get_value("ProxyServer").unwrap_or_default();
    let prev_override: String = internet.get_value("ProxyOverride").unwrap_or_default();

    let _ = backup_root.set_value("PrevProxyEnable", &prev_enable);
    let _ = backup_root.set_value("PrevProxyServer", &prev_server);
    let _ = backup_root.set_value("PrevProxyOverride", &prev_override);
    let _ = backup_root.set_value("Active", &1u32);

    let server = format!(
        "http=127.0.0.1:{};https=127.0.0.1:{}",
        bind.port(),
        bind.port()
    );
    internet
        .set_value("ProxyEnable", &1u32)
        .map_err(|e| e.to_string())?;
    internet
        .set_value("ProxyServer", &server)
        .map_err(|e| e.to_string())?;
    let _ = internet.set_value("ProxyOverride", &"<local>");

    unsafe {
        InternetSetOptionW(
            std::ptr::null_mut(),
            INTERNET_OPTION_SETTINGS_CHANGED,
            std::ptr::null_mut(),
            0,
        );
        InternetSetOptionW(
            std::ptr::null_mut(),
            INTERNET_OPTION_REFRESH,
            std::ptr::null_mut(),
            0,
        );
    }

    Ok(())
}

#[cfg(windows)]
pub fn disable_system_proxy() -> Result<(), String> {
    use windows_sys::Win32::Networking::WinInet::{
        InternetSetOptionW, INTERNET_OPTION_REFRESH, INTERNET_OPTION_SETTINGS_CHANGED,
    };
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WRITE};
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let internet = hkcu
        .open_subkey_with_flags(
            "Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
            KEY_READ | KEY_WRITE,
        )
        .map_err(|e| e.to_string())?;

    let backup = hkcu
        .open_subkey_with_flags("Software\\Proxer\\ProxyBackup", KEY_READ | KEY_WRITE)
        .or_else(|_| {
            hkcu.open_subkey_with_flags("Software\\Skuntir\\ProxyBackup", KEY_READ | KEY_WRITE)
        });
    if let Ok(backup) = backup {
        let active: u32 = backup.get_value("Active").unwrap_or(0);
        if active == 1 {
            let prev_enable: u32 = backup.get_value("PrevProxyEnable").unwrap_or(0);
            let prev_server: String = backup.get_value("PrevProxyServer").unwrap_or_default();
            let prev_override: String = backup.get_value("PrevProxyOverride").unwrap_or_default();

            let _ = internet.set_value("ProxyEnable", &prev_enable);
            let _ = internet.set_value("ProxyServer", &prev_server);
            let _ = internet.set_value("ProxyOverride", &prev_override);
            let _ = backup.set_value("Active", &0u32);
        } else {
            let _ = internet.set_value("ProxyEnable", &0u32);
        }
    } else {
        let _ = internet.set_value("ProxyEnable", &0u32);
    }

    unsafe {
        InternetSetOptionW(
            std::ptr::null_mut(),
            INTERNET_OPTION_SETTINGS_CHANGED,
            std::ptr::null_mut(),
            0,
        );
        InternetSetOptionW(
            std::ptr::null_mut(),
            INTERNET_OPTION_REFRESH,
            std::ptr::null_mut(),
            0,
        );
    }

    Ok(())
}

#[cfg(target_os = "linux")]
pub fn enable_system_proxy(bind: SocketAddr) -> Result<(), String> {
    ensure_gsettings()?;
    backup_gsettings_proxy()?;

    let port = bind.port().to_string();
    gsettings_set("org.gnome.system.proxy", "mode", "'manual'")?;
    gsettings_set("org.gnome.system.proxy.http", "host", "'127.0.0.1'")?;
    gsettings_set("org.gnome.system.proxy.http", "port", &port)?;
    gsettings_set("org.gnome.system.proxy.https", "host", "'127.0.0.1'")?;
    gsettings_set("org.gnome.system.proxy.https", "port", &port)?;
    Ok(())
}

#[cfg(target_os = "linux")]
pub fn disable_system_proxy() -> Result<(), String> {
    ensure_gsettings()?;
    let backup = read_linux_backup();
    if let Some(backup) = backup {
        gsettings_set(
            "org.gnome.system.proxy",
            "mode",
            &quote_gvariant(&backup.mode),
        )?;
        gsettings_set(
            "org.gnome.system.proxy.http",
            "host",
            &quote_gvariant(&backup.http_host),
        )?;
        gsettings_set(
            "org.gnome.system.proxy.http",
            "port",
            &backup.http_port.to_string(),
        )?;
        gsettings_set(
            "org.gnome.system.proxy.https",
            "host",
            &quote_gvariant(&backup.https_host),
        )?;
        gsettings_set(
            "org.gnome.system.proxy.https",
            "port",
            &backup.https_port.to_string(),
        )?;
        let _ = std::fs::remove_file(linux_backup_path()?);
    } else {
        gsettings_set("org.gnome.system.proxy", "mode", "'none'")?;
    }
    Ok(())
}

#[cfg(target_os = "linux")]
#[derive(Debug, serde::Deserialize, serde::Serialize)]
struct LinuxProxyBackup {
    mode: String,
    http_host: String,
    http_port: u16,
    https_host: String,
    https_port: u16,
}

#[cfg(target_os = "linux")]
fn ensure_gsettings() -> Result<(), String> {
    std::process::Command::new("gsettings")
        .arg("--version")
        .output()
        .map(|_| ())
        .map_err(|_| "gsettings is required to configure the Linux system proxy".into())
}

#[cfg(target_os = "linux")]
fn backup_gsettings_proxy() -> Result<(), String> {
    let path = linux_backup_path()?;
    if path.exists() {
        return Ok(());
    }

    let backup = LinuxProxyBackup {
        mode: gsettings_get_string("org.gnome.system.proxy", "mode")?,
        http_host: gsettings_get_string("org.gnome.system.proxy.http", "host")?,
        http_port: gsettings_get_u16("org.gnome.system.proxy.http", "port")?,
        https_host: gsettings_get_string("org.gnome.system.proxy.https", "host")?,
        https_port: gsettings_get_u16("org.gnome.system.proxy.https", "port")?,
    };

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string(&backup).map_err(|e| e.to_string())?;
    std::fs::write(path, raw).map_err(|e| e.to_string())
}

#[cfg(target_os = "linux")]
fn read_linux_backup() -> Option<LinuxProxyBackup> {
    let path = linux_backup_path().ok()?;
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

#[cfg(target_os = "linux")]
fn linux_backup_path() -> Result<std::path::PathBuf, String> {
    if let Some(config_home) = std::env::var_os("XDG_CONFIG_HOME") {
        return Ok(std::path::PathBuf::from(config_home).join("proxer/system-proxy-backup.json"));
    }
    let home = std::env::var_os("HOME").ok_or_else(|| "HOME is not set".to_string())?;
    Ok(std::path::PathBuf::from(home).join(".config/proxer/system-proxy-backup.json"))
}

#[cfg(target_os = "linux")]
fn gsettings_get_string(schema: &str, key: &str) -> Result<String, String> {
    let raw = gsettings_get(schema, key)?;
    Ok(unquote_gvariant(&raw))
}

#[cfg(target_os = "linux")]
fn gsettings_get_u16(schema: &str, key: &str) -> Result<u16, String> {
    let raw = gsettings_get(schema, key)?;
    raw.trim()
        .parse::<u16>()
        .map_err(|e| format!("invalid gsettings value for {schema}.{key}: {e}"))
}

#[cfg(target_os = "linux")]
fn gsettings_get(schema: &str, key: &str) -> Result<String, String> {
    let out = std::process::Command::new("gsettings")
        .args(["get", schema, key])
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[cfg(target_os = "linux")]
fn gsettings_set(schema: &str, key: &str, value: &str) -> Result<(), String> {
    let out = std::process::Command::new("gsettings")
        .args(["set", schema, key, value])
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

#[cfg(target_os = "linux")]
fn unquote_gvariant(raw: &str) -> String {
    raw.trim()
        .strip_prefix('\'')
        .and_then(|s| s.strip_suffix('\''))
        .unwrap_or(raw.trim())
        .replace("\\'", "'")
}

#[cfg(target_os = "linux")]
fn quote_gvariant(value: &str) -> String {
    format!("'{}'", value.replace('\'', "\\'"))
}

#[cfg(not(any(windows, target_os = "linux")))]
pub fn enable_system_proxy(_bind: SocketAddr) -> Result<(), String> {
    Ok(())
}

#[cfg(not(any(windows, target_os = "linux")))]
pub fn disable_system_proxy() -> Result<(), String> {
    Ok(())
}
