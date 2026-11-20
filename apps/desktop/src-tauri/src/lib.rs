//! Lumière's desktop app: a native window around Lumière's own server.
//!
//! The app does three things and nothing more (docs/HOSTS_PLAN.md, M4):
//! 1. start the server (`server.rs`, the contract in
//!    packages/app/src/server/contract.ts) and open its page in a window;
//! 2. give that page what a browser cannot: a folder picker, a menu, files
//!    opened from Finder or Explorer, and web links opened in the system's
//!    browser (`menu.rs`, `opening.rs`, `external.rs`);
//! 3. stop the server when the app quits, so unsaved notes are written.
//!
//! Everything else (vaults, files, editing, settings) belongs to the server
//! and its page. When a feature seems to need Rust, put it in the server
//! first; the page is the same in a browser and in this window.

mod external;
mod menu;
mod opening;
mod server;

use tauri::{AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder};

/// The one window's label; capabilities/shell.json grants it the shell's calls.
pub const MAIN_WINDOW: &str = "main";

pub fn run() {
    let app = tauri::Builder::default()
        // A second launch (a note opened from Finder while running) comes here.
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            opening::from_second_launch(app, &args, &cwd);
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(opening::Pending::default())
        .menu(menu::build)
        .on_menu_event(menu::handle)
        .setup(|app| {
            opening::from_launch(app.handle());
            open_window(app.handle());
            start_server(app.handle().clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Lumière could not build its app");

    app.run(|handle, event| match event {
        // macOS: notes opened from Finder, at launch or later.
        #[cfg(target_os = "macos")]
        RunEvent::Opened { urls } => opening::from_finder(handle, &urls),
        RunEvent::Exit => server::stop(handle),
        _ => {}
    });
}

/// The page the window shows while the server starts (src/index.html).
const STARTING_PAGE: &str = "index.html";

/// The main window, at once, on a page that says Lumière is starting; the
/// server's page replaces it when the server is ready (`start_server`).
fn open_window(app: &AppHandle) {
    let built = WebviewWindowBuilder::new(app, MAIN_WINDOW, WebviewUrl::App(STARTING_PAGE.into()))
        .title("Lumière")
        .inner_size(1200.0, 800.0)
        .min_inner_size(640.0, 400.0)
        // A note's web and mail links open in the system's apps.
        .on_new_window(|url, _features| external::on_new_window(url))
        .build();
    if let Err(error) = built {
        eprintln!("Lumière: could not open its window: {error}");
        app.exit(1);
    }
}

/// Start the server off the main thread (it may take up to 30 seconds, and
/// the window must draw meanwhile), then show its page in the window, or why
/// it did not start, and show what was opened from outside meanwhile.
fn start_server(app: AppHandle) {
    std::thread::spawn(move || {
        let started = server::start(&app);
        let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
            return;
        };
        match started {
            Ok(url) => {
                if let Err(error) = window.navigate(url) {
                    eprintln!("Lumière: could not show the server's page: {error}");
                }
                opening::flush(&app);
            }
            Err(reason) => {
                eprintln!("Lumière: the server did not start: {reason}");
                let shown = window
                    .url()
                    .map_err(|error| error.to_string())
                    .and_then(|page| {
                        window
                            .navigate(failure_url(page, &reason))
                            .map_err(|error| error.to_string())
                    });
                if let Err(error) = shown {
                    eprintln!("Lumière: could not say why: {error}");
                }
            }
        }
    });
}

/// The starting page (src/index.html) with the reason the server did not
/// start, which it then shows (src/fallback.js).
fn failure_url(mut page: Url, reason: &str) -> Url {
    page.set_query(Some(&format!("reason={}", percent_encode(reason))));
    page.set_fragment(None);
    page
}

fn percent_encode(text: &str) -> String {
    text.bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{failure_url, percent_encode};

    #[test]
    fn reasons_survive_the_query_string() {
        assert_eq!(percent_encode("a b&c=é"), "a%20b%26c%3D%C3%A9");
    }

    #[test]
    fn a_failure_is_shown_on_the_starting_page() {
        let page = "tauri://localhost/index.html#x".parse().unwrap();
        assert_eq!(
            failure_url(page, "no node").as_str(),
            "tauri://localhost/index.html?reason=no%20node"
        );
    }
}
