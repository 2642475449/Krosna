use anyhow::Result;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{BufRead, Read, Write},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    time::{Duration, Instant},
};

pub const ROWS: u16 = 28;
pub const COLS: u16 = 100;
pub const SCROLLBACK: usize = 1000;

#[derive(Clone, Debug, Serialize)]
pub struct Config {
    pub sessions: usize,
    pub duration: u64,
    pub rate: usize,
    pub interactive: bool,
    pub output: String,
}

impl Config {
    pub fn from_args(engine: &str) -> Self {
        let args: Vec<_> = std::env::args().collect();
        let value = |name: &str| args.windows(2).find(|w| w[0] == name).map(|w| w[1].clone());
        Self {
            sessions: value("--sessions")
                .and_then(|v| v.parse().ok())
                .unwrap_or(1)
                .clamp(1, 4),
            duration: value("--duration")
                .and_then(|v| v.parse().ok())
                .unwrap_or(12)
                .clamp(3, 120),
            rate: value("--rate")
                .and_then(|v| v.parse().ok())
                .unwrap_or(131072)
                .clamp(1024, 4194304),
            interactive: args.iter().any(|v| v == "--interactive"),
            output: value("--output").unwrap_or_else(|| format!("results/{engine}.json")),
        }
    }
}

/// The exact same child executable mode and ANSI stream are used by both UIs.
/// Synthetic probes travel through a real ConPTY writer and back through the parser.
pub fn run_producer_if_requested() -> bool {
    let args: Vec<_> = std::env::args().collect();
    if args.get(1).map(String::as_str) != Some("--producer") {
        return false;
    }
    let duration: u64 = args[2].parse().unwrap();
    let rate: usize = args[3].parse().unwrap();
    let output = Arc::new(Mutex::new(std::io::stdout()));
    let echo_output = output.clone();
    std::thread::spawn(move || {
        for line in std::io::stdin().lock().lines() {
            let Ok(line) = line else { break };
            if let Some(id) = line.trim().strip_prefix("probe:") {
                let mut out = echo_output.lock().unwrap();
                let _ = write!(out, "\x1b]777;echo={id}\x07");
                let _ = out.flush();
            } else {
                let mut out = echo_output.lock().unwrap();
                let _ = write!(out, "\r\nINPUT: {line}\r\n");
                let _ = out.flush();
            }
        }
    });
    let start = Instant::now();
    let mut sequence = 0u64;
    let mut credit = 0.0;
    for tick in 1..=duration * 100 {
        credit += rate as f64 / 100.0;
        let mut block = String::new();
        while credit >= 110.0 {
            let line = format!("\x1b[38;5;{}m{:08} UTF8 中文测试 λ 🙂 terminal replay build step {:04} OK\x1b[0m\r\n", 32 + sequence % 6, sequence, sequence % 10000);
            credit -= line.len() as f64;
            block.push_str(&line);
            sequence += 1;
            if sequence % 25 == 0 {
                block.push_str("\r\x1b[2Kprogress 50%\rprogress 100%\r\n");
            }
        }
        if !block.is_empty() {
            let mut out = output.lock().unwrap();
            let _ = out.write_all(block.as_bytes());
            let _ = out.flush();
        }
        // A fixed tick count gives both engines the exact same workload lines.
        // If the child falls behind, do not silently reduce the data volume.
        std::thread::sleep(
            (start + Duration::from_millis(tick * 10)).saturating_duration_since(Instant::now()),
        );
    }
    true
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Packet {
    pub session: usize,
    pub seq: u64,
    pub read_us: f64,
    pub data: String,
}

#[derive(Default)]
struct Stats {
    bytes: u64,
    packets: u64,
    parse_us: Vec<f64>,
    read_to_ack_ms: Vec<f64>,
    probe_ms: Vec<f64>,
    probe_to_read_ms: Vec<f64>,
    pending_probes: HashMap<u64, Instant>,
    tails: HashMap<usize, String>,
    read_tails: HashMap<usize, String>,
    last_seq: HashMap<usize, u64>,
    sequence_errors: u64,
    ui_gaps_ms: Vec<f64>,
    probe_sent: u64,
    paint_callbacks: u64,
}

#[derive(Serialize)]
pub struct Distribution {
    pub count: usize,
    pub p50: f64,
    pub p95: f64,
    pub p99: f64,
    pub max: f64,
}
pub fn distribution(mut values: Vec<f64>) -> Distribution {
    values.sort_by(f64::total_cmp);
    let at = |p: f64| {
        values
            .get(((values.len().saturating_sub(1)) as f64 * p).round() as usize)
            .copied()
            .unwrap_or(0.0)
    };
    Distribution {
        count: values.len(),
        p50: at(0.5),
        p95: at(0.95),
        p99: at(0.99),
        max: at(1.0),
    }
}

type Writer = Arc<Mutex<Box<dyn Write + Send>>>;
pub struct Backend {
    pub config: Config,
    pub start: Instant,
    stats: Arc<Mutex<Stats>>,
    writers: Vec<Writer>,
    masters: Mutex<Vec<Box<dyn MasterPty + Send>>>,
    children: Mutex<Vec<Box<dyn Child + Send + Sync>>>,
    stop: Arc<AtomicBool>,
    read_bytes: Arc<AtomicU64>,
}

impl Backend {
    pub fn new(config: Config) -> Result<(Arc<Self>, mpsc::Receiver<Packet>)> {
        let (tx, rx) = mpsc::sync_channel(256);
        let mut writers = Vec::new();
        let mut masters = Vec::new();
        let mut children = Vec::new();
        let start = Instant::now();
        let read_bytes = Arc::new(AtomicU64::new(0));
        let stats = Arc::new(Mutex::new(Stats::default()));
        for session in 0..config.sessions {
            let pair = native_pty_system().openpty(PtySize {
                rows: ROWS,
                cols: COLS,
                pixel_width: 0,
                pixel_height: 0,
            })?;
            let mut command = CommandBuilder::new(std::env::current_exe()?);
            command.args([
                "--producer",
                &if config.interactive {
                    "3600".to_string()
                } else {
                    config.duration.to_string()
                },
                &config.rate.to_string(),
            ]);
            children.push(pair.slave.spawn_command(command)?);
            drop(pair.slave);
            writers.push(Arc::new(Mutex::new(pair.master.take_writer()?)));
            let mut reader = pair.master.try_clone_reader()?;
            masters.push(pair.master);
            let sender = tx.clone();
            let byte_counter = read_bytes.clone();
            let reader_stats = stats.clone();
            std::thread::spawn(move || {
                let mut buffer = [0; 32768];
                let mut pending = Vec::new();
                let mut seq = 0;
                while let Ok(n) = reader.read(&mut buffer) {
                    if n == 0 {
                        break;
                    }
                    byte_counter.fetch_add(n as u64, Ordering::Relaxed);
                    pending.extend_from_slice(&buffer[..n]);
                    let valid = match std::str::from_utf8(&pending) {
                        Ok(_) => pending.len(),
                        Err(error) if error.error_len().is_none() => error.valid_up_to(),
                        Err(_) => pending.len(),
                    };
                    if valid == 0 {
                        continue;
                    }
                    let data = String::from_utf8_lossy(&pending[..valid]).into_owned();
                    pending.drain(..valid);
                    {
                        let mut stats = reader_stats.lock().unwrap();
                        let ids =
                            extract_probe_ids(stats.read_tails.entry(session).or_default(), &data);
                        for id in ids {
                            if let Some(sent) = stats.pending_probes.get(&id) {
                                let elapsed = sent.elapsed().as_secs_f64() * 1000.0;
                                stats.probe_to_read_ms.push(elapsed);
                            }
                        }
                    }
                    seq += 1;
                    if sender
                        .send(Packet {
                            session,
                            seq,
                            read_us: start.elapsed().as_secs_f64() * 1e6,
                            data,
                        })
                        .is_err()
                    {
                        break;
                    }
                }
            });
        }
        drop(tx);
        let backend = Arc::new(Self {
            config,
            start,
            stats,
            writers,
            masters: Mutex::new(masters),
            children: Mutex::new(children),
            stop: Arc::new(AtomicBool::new(false)),
            read_bytes,
        });
        let weak = Arc::downgrade(&backend);
        std::thread::spawn(move || {
            let mut id = 0;
            loop {
                std::thread::sleep(Duration::from_millis(125));
                let Some(backend) = weak.upgrade() else { break };
                if backend.stop.load(Ordering::Relaxed) {
                    break;
                }
                if backend.start.elapsed().as_secs() >= backend.config.duration
                    && !backend.config.interactive
                {
                    break;
                }
                id += 1;
                {
                    let mut stats = backend.stats.lock().unwrap();
                    stats.pending_probes.insert(id, Instant::now());
                    stats.probe_sent += 1;
                }
                let _ = backend.input(
                    (id as usize - 1) % backend.config.sessions,
                    &format!("probe:{id}\r"),
                );
            }
        });
        Ok((backend, rx))
    }

    pub fn input(&self, session: usize, data: &str) -> Result<()> {
        let mut writer = self
            .writers
            .get(session)
            .ok_or_else(|| anyhow::anyhow!("invalid session"))?
            .lock()
            .unwrap();
        writer.write_all(data.as_bytes())?;
        writer.flush()?;
        Ok(())
    }

    pub fn observe(&self, packet: &Packet, parse_us: f64) {
        self.observe_parsed(packet, parse_us, packet.data.len());
    }

    pub fn observe_parsed(&self, packet: &Packet, parse_us: f64, byte_count: usize) {
        let now = Instant::now();
        let mut stats = self.stats.lock().unwrap();
        let previous = stats
            .last_seq
            .insert(packet.session, packet.seq)
            .unwrap_or(0);
        if packet.seq != previous + 1 {
            stats.sequence_errors += 1;
        }
        stats.bytes += byte_count as u64;
        stats.packets += 1;
        stats.parse_us.push(parse_us);
        stats
            .read_to_ack_ms
            .push((self.start.elapsed().as_secs_f64() * 1e6 - packet.read_us) / 1000.0);
        let ids = extract_probe_ids(stats.tails.entry(packet.session).or_default(), &packet.data);
        for id in ids {
            if let Some(sent) = stats.pending_probes.remove(&id) {
                stats
                    .probe_ms
                    .push(now.duration_since(sent).as_secs_f64() * 1000.0);
            }
        }
    }

    pub fn ui_gap(&self, ms: f64) {
        self.stats.lock().unwrap().ui_gaps_ms.push(ms);
    }
    pub fn painted(&self) {
        self.stats.lock().unwrap().paint_callbacks += 1;
    }
    pub fn finished(&self) -> bool {
        !self.config.interactive && self.start.elapsed().as_secs() >= self.config.duration + 3
    }

    pub fn save(&self, engine: &str) -> Result<()> {
        let stats = self.stats.lock().unwrap();
        let value = serde_json::json!({
            "engine": engine, "config": self.config, "elapsed_seconds": self.start.elapsed().as_secs_f64(),
            "pty_read_bytes": self.read_bytes.load(Ordering::Relaxed), "parsed_utf8_bytes": stats.bytes,
            "packets": stats.packets, "sequence_errors": stats.sequence_errors,
            "probe_sent": stats.probe_sent, "probe_pending": stats.pending_probes.len(),
            "paint_callbacks": stats.paint_callbacks,
            "synthetic_input_to_parser_ack_ms": distribution(stats.probe_ms.clone()),
            "synthetic_input_to_pty_read_ms": distribution(stats.probe_to_read_ms.clone()),
            "pty_read_to_parser_ack_ms": distribution(stats.read_to_ack_ms.clone()),
            "packet_parse_us": distribution(stats.parse_us.clone()),
            "ui_tick_gap_ms": distribution(stats.ui_gaps_ms.clone()),
            "measurement_boundary": "parser completion / Rust acknowledgement; NOT physical keyboard-to-photon or GPU present latency",
            "parser": if engine == "gpui" { "vt100 0.15" } else { "xterm.js 6.1 beta" },
            "geometry": { "rows": ROWS, "cols": COLS, "scrollback": SCROLLBACK },
        });
        let path = std::path::Path::new(&self.config.output);
        if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, serde_json::to_vec_pretty(&value)?)?;
        Ok(())
    }

    pub fn shutdown(&self) {
        self.stop.store(true, Ordering::Relaxed);
        for child in self.children.lock().unwrap().iter_mut() {
            let _ = child.kill();
        }
    }
    pub fn resize(&self, rows: u16, cols: u16) -> Result<()> {
        for master in self.masters.lock().unwrap().iter() {
            master.resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })?;
        }
        Ok(())
    }
}
impl Drop for Backend {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn extract_probe_ids(tail: &mut String, data: &str) -> Vec<u64> {
    tail.push_str(data);
    let mut ids = Vec::new();
    while let Some(begin) = tail.find("\x1b]777;echo=") {
        let rest = &tail[begin + 11..];
        let Some(end) = rest.find('\x07') else { break };
        if let Ok(id) = rest[..end].parse::<u64>() {
            ids.push(id);
        }
        tail.drain(..begin + 11 + end + 1);
    }
    if tail.len() > 256 {
        let mut keep = tail.len() - 128;
        while !tail.is_char_boundary(keep) {
            keep += 1;
        }
        tail.drain(..keep);
    }
    ids
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn percentile_handles_empty_and_sorted_samples() {
        assert_eq!(distribution(vec![]).count, 0);
        assert_eq!(distribution(vec![5., 1., 3., 2., 4.]).p50, 3.);
    }
    #[test]
    fn parser_handles_ansi_utf8_cursor_and_alternate_screen() {
        let mut parser = vt100::Parser::new(ROWS, COLS, SCROLLBACK);
        parser.process("\x1b[31m中文 λ\x1b[0m\r\nprogress 50%\r\x1b[2Kdone".as_bytes());
        assert!(parser.screen().contents().contains("中文 λ\ndone"));
        assert_eq!(
            parser.screen().cell(0, 0).unwrap().fgcolor(),
            vt100::Color::Idx(1)
        );
        parser.process(b"\x1b[?1049hALT");
        assert!(parser.screen().alternate_screen());
        parser.process(b"\x1b[?1049l");
        assert!(!parser.screen().alternate_screen());
        assert!(parser.screen().contents().contains("done"));
    }

    #[test]
    fn split_probe_markers_are_counted_once_and_sequence_gaps_are_visible() {
        let backend = Backend {
            config: Config {
                sessions: 1,
                duration: 3,
                rate: 1024,
                interactive: false,
                output: String::new(),
            },
            start: Instant::now(),
            stats: Arc::new(Mutex::new(Stats::default())),
            writers: Vec::new(),
            masters: Mutex::new(Vec::new()),
            children: Mutex::new(Vec::new()),
            stop: Arc::new(AtomicBool::new(false)),
            read_bytes: Arc::new(AtomicU64::new(0)),
        };
        backend
            .stats
            .lock()
            .unwrap()
            .pending_probes
            .insert(7, Instant::now());
        for (seq, data) in [
            (1, "中文\x1b]777;ech"),
            (2, "o=7\x07rest"),
            (4, "\x1b]777;echo=7\x07"),
        ] {
            backend.observe(
                &Packet {
                    session: 0,
                    seq,
                    read_us: 0.,
                    data: data.into(),
                },
                1.,
            );
        }
        let stats = backend.stats.lock().unwrap();
        assert_eq!(stats.probe_ms.len(), 1);
        assert_eq!(stats.sequence_errors, 1);
        assert_eq!(stats.pending_probes.len(), 0);
    }
}
