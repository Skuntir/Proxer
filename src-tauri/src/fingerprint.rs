use serde::{Deserialize, Serialize};

use crate::error::{AppError, Result};

pub const TLS_FINGERPRINT_PROFILES: &[&str] = &[
    "chrome_144",
    "chrome_145",
    "chrome_146",
    "chrome_147",
    "chrome_148",
    "chrome",
    "safari_18.5",
    "safari_26",
    "safari_26.3",
    "safari",
    "edge_144",
    "edge_145",
    "edge_146",
    "edge_147",
    "edge_148",
    "edge",
    "firefox_140",
    "firefox_146",
    "firefox_147",
    "firefox_148",
    "firefox",
    "opera_126",
    "opera_127",
    "opera_128",
    "opera_129",
    "opera_130",
    "opera_131",
    "opera",
    "random",
];

pub const TLS_FINGERPRINT_OS: &[&str] = &["android", "ios", "linux", "macos", "windows", "random"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FingerprintOptions {
    pub profiles: Vec<String>,
    pub operating_systems: Vec<String>,
    pub reference: String,
}

pub fn options() -> FingerprintOptions {
    FingerprintOptions {
        profiles: TLS_FINGERPRINT_PROFILES
            .iter()
            .map(|s| (*s).to_string())
            .collect(),
        operating_systems: TLS_FINGERPRINT_OS
            .iter()
            .map(|s| (*s).to_string())
            .collect(),
        reference: "https://github.com/deedy5/primp".into(),
    }
}

pub fn validate_profile(profile: &str) -> Result<()> {
    if TLS_FINGERPRINT_PROFILES.iter().any(|p| *p == profile) {
        Ok(())
    } else {
        Err(AppError::InvalidInput(format!(
            "unsupported TLS fingerprint profile: {profile}"
        )))
    }
}

pub fn validate_os(os: &str) -> Result<()> {
    if TLS_FINGERPRINT_OS.iter().any(|p| *p == os) {
        Ok(())
    } else {
        Err(AppError::InvalidInput(format!(
            "unsupported TLS fingerprint OS: {os}"
        )))
    }
}

pub fn primp_profile(profile: &str) -> Result<primp::Impersonate> {
    Ok(match profile {
        "chrome_144" => primp::Impersonate::ChromeV144,
        "chrome_145" => primp::Impersonate::ChromeV145,
        "chrome_146" => primp::Impersonate::ChromeV146,
        "chrome_147" => primp::Impersonate::ChromeV147,
        "chrome_148" => primp::Impersonate::ChromeV148,
        "chrome" => primp::Impersonate::Chrome,
        "safari_18.5" => primp::Impersonate::SafariV18_5,
        "safari_26" => primp::Impersonate::SafariV26,
        "safari_26.3" => primp::Impersonate::SafariV26_3,
        "safari" => primp::Impersonate::Safari,
        "edge_144" => primp::Impersonate::EdgeV144,
        "edge_145" => primp::Impersonate::EdgeV145,
        "edge_146" => primp::Impersonate::EdgeV146,
        "edge_147" => primp::Impersonate::EdgeV147,
        "edge_148" => primp::Impersonate::EdgeV148,
        "edge" => primp::Impersonate::Edge,
        "firefox_140" => primp::Impersonate::FirefoxV140,
        "firefox_146" => primp::Impersonate::FirefoxV146,
        "firefox_147" => primp::Impersonate::FirefoxV147,
        "firefox_148" => primp::Impersonate::FirefoxV148,
        "firefox" => primp::Impersonate::Firefox,
        "opera_126" => primp::Impersonate::OperaV126,
        "opera_127" => primp::Impersonate::OperaV127,
        "opera_128" => primp::Impersonate::OperaV128,
        "opera_129" => primp::Impersonate::OperaV129,
        "opera_130" => primp::Impersonate::OperaV130,
        "opera_131" => primp::Impersonate::OperaV131,
        "opera" => primp::Impersonate::Opera,
        "random" => primp::Impersonate::Random,
        _ => {
            return Err(AppError::InvalidInput(format!(
                "unsupported TLS fingerprint profile: {profile}"
            )))
        }
    })
}

pub fn primp_os(os: &str) -> Result<primp::ImpersonateOS> {
    Ok(match os {
        "android" => primp::ImpersonateOS::Android,
        "ios" => primp::ImpersonateOS::IOS,
        "linux" => primp::ImpersonateOS::Linux,
        "macos" => primp::ImpersonateOS::MacOS,
        "windows" => primp::ImpersonateOS::Windows,
        "random" => primp::ImpersonateOS::Random,
        _ => {
            return Err(AppError::InvalidInput(format!(
                "unsupported TLS fingerprint OS: {os}"
            )))
        }
    })
}
