use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex,
};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::cache::find_local_checkout;

const OUTPUT_EVENT: &str = "rudu://terminal-output";
const EXIT_EVENT: &str = "rudu://terminal-exit";

#[derive(Default)]
pub struct TerminalState {
    sessions: Mutex<HashMap<String, Session>>,
    next_id: AtomicU64,
}

struct Session {
    id: u64,
    master: Box<dyn MasterPty + Send>,
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
    writer: Box<dyn Write + Send>,
}

impl Drop for Session {
    fn drop(&mut self) {
        if let Ok(mut child) = self.child.lock() {
            if child.try_wait().ok().flatten().is_none() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Output {
    checkout_id: String,
    session_id: u64,
    data: Vec<u8>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Exit {
    checkout_id: String,
    session_id: u64,
}

fn size(cols: u16, rows: u16) -> Result<PtySize, String> {
    if !(2..=500).contains(&cols) || !(1..=200).contains(&rows) {
        return Err("Invalid terminal dimensions.".to_string());
    }
    Ok(PtySize {
        cols,
        rows,
        pixel_width: 0,
        pixel_height: 0,
    })
}

pub fn start(
    state: &TerminalState,
    app: AppHandle,
    checkout_id: &str,
    cols: u16,
    rows: u16,
) -> Result<u64, String> {
    let dimensions = size(cols, rows)?;
    let mut sessions = state.sessions.lock().map_err(|error| error.to_string())?;
    if let Some(session) = sessions.get_mut(checkout_id) {
        if session
            .child
            .lock()
            .map_err(|error| error.to_string())?
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_none()
        {
            session
                .master
                .resize(dimensions)
                .map_err(|error| error.to_string())?;
            return Ok(session.id);
        }
        sessions.remove(checkout_id);
    }

    let checkout = find_local_checkout(checkout_id)?.ok_or("Local checkout not found.")?;
    if !Path::new(&checkout.path).is_dir() {
        return Err("The local checkout directory is unavailable.".to_string());
    }

    let pair = native_pty_system()
        .openpty(dimensions)
        .map_err(|error| error.to_string())?;
    let shell = std::env::var("SHELL")
        .or_else(|_| std::env::var("COMSPEC"))
        .unwrap_or_else(|_| "/bin/sh".to_string());
    let mut command = CommandBuilder::new(shell);
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    command.cwd(checkout.path);
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| error.to_string())?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| error.to_string())?;
    let child = Arc::new(Mutex::new(
        pair.slave
            .spawn_command(command)
            .map_err(|error| error.to_string())?,
    ));
    drop(pair.slave);
    let session_id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    sessions.insert(
        checkout_id.to_string(),
        Session {
            id: session_id,
            master: pair.master,
            child: child.clone(),
            writer,
        },
    );

    let checkout_id = checkout_id.to_string();
    let output_app = app.clone();
    let output_checkout_id = checkout_id.clone();
    std::thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        while let Ok(count) = reader.read(&mut buffer) {
            if count == 0 {
                break;
            }
            if output_app
                .emit(
                    OUTPUT_EVENT,
                    Output {
                        checkout_id: output_checkout_id.clone(),
                        session_id,
                        data: buffer[..count].to_vec(),
                    },
                )
                .is_err()
            {
                break;
            }
        }
    });
    std::thread::spawn(move || {
        loop {
            // A descendant may keep the PTY open after the shell exits; watch the child itself.
            let running = child
                .lock()
                .map(|mut child| child.try_wait().ok().flatten().is_none());
            if !matches!(running, Ok(true)) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        let _ = app.emit(
            EXIT_EVENT,
            Exit {
                checkout_id,
                session_id,
            },
        );
    });
    Ok(session_id)
}

pub fn write(state: &TerminalState, checkout_id: &str, data: &str) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|error| error.to_string())?;
    let session = sessions
        .get_mut(checkout_id)
        .ok_or("The terminal is closed.")?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|error| error.to_string())
}

pub fn resize(
    state: &TerminalState,
    checkout_id: &str,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let dimensions = size(cols, rows)?;
    let sessions = state.sessions.lock().map_err(|error| error.to_string())?;
    sessions
        .get(checkout_id)
        .ok_or("The terminal is closed.")?
        .master
        .resize(dimensions)
        .map_err(|error| error.to_string())
}

pub fn stop(state: &TerminalState, checkout_id: &str) -> Result<(), String> {
    state
        .sessions
        .lock()
        .map_err(|error| error.to_string())?
        .remove(checkout_id);
    Ok(())
}

pub fn stop_all(state: &TerminalState) {
    if let Ok(mut sessions) = state.sessions.lock() {
        sessions.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::{size, Exit, Output, TerminalState};

    #[test]
    fn validates_terminal_dimensions() {
        assert!(size(80, 24).is_ok());
        assert!(size(0, 24).is_err());
        assert!(size(80, 0).is_err());
        assert!(size(501, 24).is_err());
    }

    #[test]
    fn unknown_checkout_cannot_receive_input_or_resize() {
        let state = TerminalState::default();
        assert!(super::write(&state, "unknown", "hello").is_err());
        assert!(super::resize(&state, "unknown", 80, 24).is_err());
    }

    #[test]
    fn output_identifies_its_checkout_and_session() {
        let output = Output {
            checkout_id: "checkout-a".to_string(),
            session_id: 2,
            data: vec![65],
        };
        assert_eq!(
            serde_json::to_value(output).unwrap(),
            serde_json::json!({ "checkoutId": "checkout-a", "sessionId": 2, "data": [65] }),
        );
        assert_eq!(
            serde_json::to_value(Exit {
                checkout_id: "checkout-a".into(),
                session_id: 2
            })
            .unwrap(),
            serde_json::json!({ "checkoutId": "checkout-a", "sessionId": 2 }),
        );
    }
}
