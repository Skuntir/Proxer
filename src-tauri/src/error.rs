use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("invalid input: {0}")]
    InvalidInput(String),

    #[error("proxy is already running")]
    ProxyAlreadyRunning,

    #[error("proxy is not running")]
    ProxyNotRunning,

    #[error("TLS MITM is enabled but no CA has been generated yet")]
    MitmNoCa,

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("HTTP error: {0}")]
    Http(#[from] http::Error),

    #[error("request error: {0}")]
    Reqwest(#[from] reqwest::Error),

    #[error("database error: {0}")]
    Sqlx(#[from] sqlx::Error),

    #[error("TLS error: {0}")]
    Tls(String),

    #[error("{0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, AppError>;

impl From<AppError> for String {
    fn from(value: AppError) -> Self {
        value.to_string()
    }
}
