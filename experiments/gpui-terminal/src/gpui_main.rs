use gpui::{prelude::*, *};
use std::{
    ops::Range,
    sync::{mpsc::Receiver, Arc},
    time::Instant,
};
use termflow_terminal_eval::{Backend, Config, Packet, COLS, ROWS, SCROLLBACK};

struct TerminalView {
    backend: Arc<Backend>,
    receiver: Receiver<Packet>,
    parsers: Vec<vt100::Parser>,
    focus: FocusHandle,
    active: usize,
    composition: String,
    last_tick: Instant,
}

impl TerminalView {
    fn new(
        backend: Arc<Backend>,
        receiver: Receiver<Packet>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let focus = cx.focus_handle();
        focus.focus(window);
        let parsers = (0..backend.config.sessions)
            .map(|_| vt100::Parser::new(ROWS, COLS, SCROLLBACK))
            .collect();
        Self {
            backend,
            receiver,
            parsers,
            focus,
            active: 0,
            composition: String::new(),
            last_tick: Instant::now(),
        }
    }

    fn tick(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let now = Instant::now();
        self.backend
            .ui_gap(now.duration_since(self.last_tick).as_secs_f64() * 1000.0);
        self.last_tick = now;
        // Bound UI work per frame to keep input dispatch alive during backpressure.
        let mut bytes = 0;
        while bytes < 262144 {
            let Ok(packet) = self.receiver.try_recv() else {
                break;
            };
            let start = Instant::now();
            self.parsers[packet.session].process(packet.data.as_bytes());
            self.backend
                .observe(&packet, start.elapsed().as_secs_f64() * 1e6);
            bytes += packet.data.len();
        }
        if self.backend.finished() {
            if let Err(error) = self.backend.save("gpui") {
                eprintln!("report: {error}");
            }
            self.backend.shutdown();
            cx.quit();
            return;
        }
        cx.notify();
        let entity = cx.entity().downgrade();
        window.on_next_frame(move |window, cx| {
            let _ = entity.update(cx, |view, cx| view.tick(window, cx));
        });
    }

    fn key(&mut self, event: &KeyDownEvent, _: &mut Window, cx: &mut Context<Self>) {
        let key = &event.keystroke;
        let data = if key.modifiers.control {
            if key.key == "v" {
                cx.read_from_clipboard().and_then(|item| item.text())
            } else if key.key.len() == 1 && key.key.as_bytes()[0].is_ascii_alphabetic() {
                Some(((key.key.as_bytes()[0].to_ascii_lowercase() - b'a' + 1) as char).to_string())
            } else {
                None
            }
        } else {
            match key.key.as_str() {
                "enter" => Some("\r".into()),
                "backspace" => Some("\x7f".into()),
                "tab" => Some("\t".into()),
                "escape" => Some("\x1b".into()),
                "up" => Some("\x1b[A".into()),
                "down" => Some("\x1b[B".into()),
                "right" => Some("\x1b[C".into()),
                "left" => Some("\x1b[D".into()),
                _ => None,
            }
        };
        if let Some(data) = data {
            let _ = self.backend.input(self.active, &data);
            cx.stop_propagation();
        }
    }
}

fn color(color: vt100::Color, default: u32) -> Hsla {
    let palette = [
        0x171b22, 0xf07178, 0x98c379, 0xe5c07b, 0x61afef, 0xc678dd, 0x56b6c2, 0xd8dee9, 0x5c6370,
        0xff8b92, 0xb5e890, 0xffdf99, 0x85c8ff, 0xe8a0ff, 0x7fdde9, 0xffffff,
    ];
    let value = match color {
        vt100::Color::Default => default,
        vt100::Color::Rgb(r, g, b) => ((r as u32) << 16) | ((g as u32) << 8) | b as u32,
        vt100::Color::Idx(i) if i < 16 => palette[i as usize],
        vt100::Color::Idx(i) if i < 232 => {
            let c = i as u32 - 16;
            let component = |n| if n == 0 { 0 } else { 55 + 40 * n };
            component(c / 36) << 16 | component((c / 6) % 6) << 8 | component(c % 6)
        }
        vt100::Color::Idx(i) => {
            let v = 8 + 10 * (i as u32 - 232);
            v << 16 | v << 8 | v
        }
    };
    rgb(value).into()
}

impl Render for TerminalView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let screen = self.parsers[self.active].screen();
        let rows: Vec<_> = (0..ROWS)
            .map(|row| {
                let mut segments = Vec::new();
                let mut col = 0;
                while col < COLS {
                    let cell = screen.cell(row, col).unwrap();
                    let fg = cell.fgcolor();
                    let bg = cell.bgcolor();
                    let bold = cell.bold();
                    let mut text = String::new();
                    let begin = col;
                    while col < COLS {
                        let cell = screen.cell(row, col).unwrap();
                        if cell.fgcolor() != fg || cell.bgcolor() != bg || cell.bold() != bold {
                            break;
                        }
                        if !cell.is_wide_continuation() {
                            let contents = cell.contents();
                            text.push_str(if contents.is_empty() { " " } else { &contents });
                        }
                        col += 1;
                    }
                    segments.push(
                        div()
                            .w(px((col - begin) as f32 * 8.4))
                            .h(px(18.))
                            .overflow_hidden()
                            .text_color(color(fg, 0xd8dee9))
                            .bg(color(bg, 0x171b22))
                            .when(bold, |d| d.font_weight(FontWeight::BOLD))
                            .child(text),
                    );
                }
                div().flex().h(px(18.)).children(segments)
            })
            .collect();
        let focus = self.focus.clone();
        let input = cx.entity();
        let paint_backend = self.backend.clone();
        let tabs: Vec<_> = (0..self.parsers.len())
            .map(|index| {
                div()
                    .id(("session", index))
                    .px_3()
                    .py_2()
                    .cursor_pointer()
                    .bg(rgb(if index == self.active {
                        0x34405a
                    } else {
                        0x222936
                    }))
                    .child(format!("Session {}", index + 1))
                    .on_click(cx.listener(move |view, _, _, cx| {
                        view.active = index;
                        cx.notify();
                    }))
            })
            .collect();
        div()
            .size_full()
            .bg(rgb(0x171b22))
            .text_color(rgb(0xd8dee9))
            .font_family("Cascadia Mono")
            .text_size(px(14.))
            .track_focus(&self.focus)
            .on_key_down(cx.listener(Self::key))
            .child(div().flex().gap_2().children(tabs))
            .child(div().p_2().child(format!(
                "GPUI 0.2.2 / vt100 | {} sessions | {} KiB/s per PTY | fixed {}x{}",
                self.parsers.len(),
                self.backend.config.rate / 1024,
                COLS,
                ROWS
            )))
            .child(
                div().relative().p_2().children(rows).child(
                    canvas(
                        |_, _, _| (),
                        move |bounds, _, window, cx| {
                            paint_backend.painted();
                            window.handle_input(&focus, ElementInputHandler::new(bounds, input), cx)
                        },
                    )
                    .absolute()
                    .size_full(),
                ),
            )
            .child(div().p_2().child(format!(
                "Composition: {} | Ctrl+V paste; Enter submits to ConPTY echo worker",
                self.composition
            )))
    }
}

// A minimal terminal input endpoint: committed text goes to the PTY; IME
// composition is held locally. Selection/scrollback/mouse protocols are out of scope.
impl EntityInputHandler for TerminalView {
    fn text_for_range(
        &mut self,
        _: Range<usize>,
        _: &mut Option<Range<usize>>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<String> {
        Some(self.composition.clone())
    }
    fn selected_text_range(
        &mut self,
        _: bool,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<UTF16Selection> {
        let n = self.composition.encode_utf16().count();
        Some(UTF16Selection {
            range: n..n,
            reversed: false,
        })
    }
    fn marked_text_range(&self, _: &mut Window, _: &mut Context<Self>) -> Option<Range<usize>> {
        if self.composition.is_empty() {
            None
        } else {
            Some(0..self.composition.encode_utf16().count())
        }
    }
    fn unmark_text(&mut self, _: &mut Window, cx: &mut Context<Self>) {
        self.composition.clear();
        cx.notify();
    }
    fn replace_text_in_range(
        &mut self,
        _: Option<Range<usize>>,
        text: &str,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.composition.clear();
        let _ = self.backend.input(self.active, text);
        cx.notify();
    }
    fn replace_and_mark_text_in_range(
        &mut self,
        _: Option<Range<usize>>,
        text: &str,
        _: Option<Range<usize>>,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.composition = text.to_owned();
        cx.notify();
    }
    fn bounds_for_range(
        &mut self,
        _: Range<usize>,
        bounds: Bounds<Pixels>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<Bounds<Pixels>> {
        Some(bounds)
    }
    fn character_index_for_point(
        &mut self,
        _: Point<Pixels>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<usize> {
        None
    }
}

fn main() -> anyhow::Result<()> {
    if termflow_terminal_eval::run_producer_if_requested() {
        return Ok(());
    }
    let config = Config::from_args("gpui");
    Application::new().run(move |cx: &mut App| {
        let (backend, receiver) = Backend::new(config).expect("create ConPTY workload");
        let bounds = Bounds::centered(None, size(px(950.), px(680.)), cx);
        cx.open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                ..Default::default()
            },
            |window, cx| {
                let entity = cx.new(|cx| TerminalView::new(backend, receiver, window, cx));
                entity.update(cx, |view, cx| view.tick(window, cx));
                entity
            },
        )
        .unwrap();
        cx.activate(true);
    });
    Ok(())
}
