#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Some(code) = krosna_lib::runtime_cli::try_run() {
        std::process::exit(code);
    }
    krosna_lib::run();
}
