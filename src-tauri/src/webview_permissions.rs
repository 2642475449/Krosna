//! Desktop permissions for the bundled application UI, including the voice worker.
//! External pages and other permission kinds retain WebView2's default policy.

use tauri::{Manager, Url, Webview, Wry};
use webview2_com::{
    take_pwstr,
    Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ, COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
        COREWEBVIEW2_PERMISSION_STATE_ALLOW,
    },
    PermissionRequestedEventHandler,
};

fn is_app_origin(uri: &str, app_origin: &Url) -> bool {
    Url::parse(uri)
        .map(|url| url.origin() == app_origin.origin())
        .unwrap_or(false)
}

pub fn install(webview: &Webview<Wry>) {
    // Match the configured development origin exactly. Release builds trust only
    // the bundled Tauri origin; arbitrary localhost ports are never trusted.
    let app_origin = if cfg!(dev) {
        webview.config().build.dev_url.clone()
    } else {
        Url::parse("http://tauri.localhost").ok()
    };
    let Some(app_origin) = app_origin else {
        return;
    };
    let label = webview.label().to_owned();
    if let Err(error) = webview.with_webview(move |platform| {
        let result = (|| unsafe {
            let core = platform.controller().CoreWebView2()?;
            let handler = PermissionRequestedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut kind = Default::default();
                args.PermissionKind(&mut kind)?;
                if kind != COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ
                    && kind != COREWEBVIEW2_PERMISSION_KIND_MICROPHONE
                {
                    return Ok(());
                }
                let mut uri = Default::default();
                args.Uri(&mut uri)?;
                if is_app_origin(&take_pwstr(uri), &app_origin) {
                    args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
                }
                Ok(())
            }));
            let mut token = 0;
            // WebView2 owns the handler until the WebView is destroyed.
            core.add_PermissionRequested(&handler, &mut token)
        })();
        if let Err(error) = result {
            eprintln!("Failed to install desktop permissions for {label}: {error}");
        }
    }) {
        eprintln!("Failed to access WebView for desktop permissions: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_exact_application_origin_is_trusted() {
        let dev = Url::parse("http://127.0.0.1:1420").unwrap();
        assert!(is_app_origin(
            "http://127.0.0.1:1420/index.html?window=voice-worker",
            &dev
        ));
        for uri in [
            "http://127.0.0.1:1421/",
            "http://localhost:1420/",
            "https://127.0.0.1:1420/",
            "https://example.com/",
            "http://127.0.0.1:1420.example.com/",
            "about:blank",
            "invalid",
        ] {
            assert!(!is_app_origin(uri, &dev), "{uri}");
        }
        let bundled = Url::parse("http://tauri.localhost").unwrap();
        assert!(is_app_origin("http://tauri.localhost/index.html", &bundled));
        assert!(!is_app_origin("http://127.0.0.1:1420/", &bundled));
    }
}
