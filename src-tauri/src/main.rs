// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let mut args = match std::env::args_os()
        .skip(1)
        .map(|arg| {
            arg.into_string()
                .map_err(|_| "CLI arguments must be valid UTF-8.".to_string())
        })
        .collect::<Result<Vec<_>, _>>()
    {
        Ok(args) => args,
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(2);
        }
    };

    if args.as_slice() == ["patch", "-"] {
        let mut patch = String::new();
        if let Err(error) = std::io::Read::read_to_string(&mut std::io::stdin(), &mut patch) {
            eprintln!("Could not read patch from stdin: {error}");
            std::process::exit(2);
        }
        let path = std::env::temp_dir().join(format!("rudu-patch-{}.patch", std::process::id()));
        if let Err(error) = std::fs::write(&path, patch) {
            eprintln!("Could not store stdin patch: {error}");
            std::process::exit(2);
        }
        args[1] = path.to_string_lossy().to_string();
    }

    if args.as_slice() == ["skill", "path"] {
        exit_with(rudu_lib::run_skill_path());
    }

    if args.first().map(String::as_str) == Some("session") {
        exit_with(rudu_lib::run_session_cli(&args[1..]));
    }

    let cwd = match std::env::current_dir() {
        Ok(cwd) => cwd,
        Err(error) => {
            eprintln!("Could not resolve the current directory: {error}");
            std::process::exit(2);
        }
    };
    let launch = match rudu_lib::parse_cli_launch(&args, &cwd) {
        Ok(launch) => launch,
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(2);
        }
    };
    match launch {
        rudu_lib::CliLaunch::Help => println!("{}", rudu_lib::cli_usage()),
        rudu_lib::CliLaunch::Version => println!("rudu {}", env!("CARGO_PKG_VERSION")),
        launch => rudu_lib::run(launch),
    }
}

fn exit_with(result: Result<String, String>) -> ! {
    match result {
        Ok(output) => {
            println!("{output}");
            std::process::exit(0);
        }
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}
