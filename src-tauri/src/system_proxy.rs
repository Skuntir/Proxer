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

    let server = format!("127.0.0.1:{}", bind.port());
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

#[cfg(not(windows))]
pub fn enable_system_proxy(_bind: SocketAddr) -> Result<(), String> {
    Ok(())
}

#[cfg(not(windows))]
pub fn disable_system_proxy() -> Result<(), String> {
    Ok(())
}
