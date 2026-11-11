fn main() {
    // 独立诊断 example 不经过主 bin 的资源链接，也需要 Common Controls v6。
    // 仅作用于 examples，避免改变正式应用的 manifest。
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
    {
        println!("cargo:rustc-link-arg-examples=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg-examples=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'");
    }

    // Vite recreates the entire dist directory before Tauri invokes Cargo. Cargo's
    // directory watcher may miss that replacement, so track the entry point itself.
    // When it changes, tauri-build regenerates and embeds the complete asset set.
    println!("cargo:rerun-if-changed=../dist/index.html");

    tauri_build::build();
}
