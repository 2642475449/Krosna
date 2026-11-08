fn main() {
    #[cfg(feature = "webview-ui")]
    tauri_build::build();
}
