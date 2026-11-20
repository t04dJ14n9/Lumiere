//! Links that leave Lumière: a note's web or mail link opens in the system's
//! browser or mail app.
//!
//! The page opens one with `window.open` (host-node's page/ui.ts, after
//! `safeExternalHref`), and a link with `target="_blank"` asks the same way.
//! A web view asks its app for a new window then; without an answer WKWebView
//! opens nothing. The app has one window, so every such request is refused,
//! and a web or mail address is handed to the system instead.

use std::process::Command;
use tauri::webview::NewWindowResponse;
use tauri::{Runtime, Url};

/// The schemes handed to the system: the web and mail. Anything else (a
/// script, a local file, another app's scheme) is not opened from a note.
const OPENED_SCHEMES: [&str; 3] = ["http", "https", "mailto"];

/// The answer to the page's request for a new window at `url`.
pub fn on_new_window<R: Runtime>(url: Url) -> NewWindowResponse<R> {
    if let Some(url) = openable(&url) {
        if let Err(error) = open_with_system(url) {
            eprintln!("Lumière: could not open {url}: {error}");
        }
    }
    NewWindowResponse::Deny
}

/// `url` when the system should open it.
pub fn openable(url: &Url) -> Option<&Url> {
    OPENED_SCHEMES.contains(&url.scheme()).then_some(url)
}

/// The system's own opener. The address is one argument and begins with its
/// scheme, so it is never read as an option.
fn open_with_system(url: &Url) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    let mut command = Command::new("/usr/bin/open");
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("rundll32");
        command.arg("url.dll,FileProtocolHandler");
        command
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = Command::new("xdg-open");
    let mut child = command.arg(url.as_str()).spawn()?;
    // Reap the opener when it exits, so it leaves no zombie behind.
    std::thread::spawn(move || child.wait());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::openable;
    use tauri::Url;

    fn opens(address: &str) -> bool {
        openable(&Url::parse(address).unwrap()).is_some()
    }

    #[test]
    fn web_and_mail_links_open_in_the_system() {
        assert!(opens("https://example.com/a?b#c"));
        assert!(opens("http://localhost:3000/"));
        assert!(opens("mailto:someone@example.com"));
    }

    #[test]
    fn scripts_files_and_other_schemes_do_not() {
        for address in [
            "javascript:alert(1)",
            "file:///etc/passwd",
            "blob:http://127.0.0.1:1234/abc",
            "data:text/html,hi",
            "vscode://file/a",
            "smb://server/share",
        ] {
            assert!(!opens(address), "{address}");
        }
    }
}
