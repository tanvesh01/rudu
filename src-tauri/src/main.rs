// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().any(|arg| arg == "--rudu-linear-mcp") {
        rudu_lib::run_linear_mcp_stdio();
        return;
    }

    rudu_lib::run()
}
