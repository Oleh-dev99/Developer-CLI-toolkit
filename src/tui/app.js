import { constants } from "node:os";
import { basename } from "node:path";
import { emitKeypressEvents } from "node:readline";
import { center, createScreen, pad, paints, rowWidth, spread, terminal } from "./screen.js";

// The full-screen UI of `toolsmith ui`. src/commands/ui.js imports this only
// when that command runs, so other commands never load it.

// The smallest terminal the UI draws itself in; below it, it says so.
export const minimum = { columns: 40, rows: 10 };

// The panels that later parts of the UI fill in.
const panels = ["Commands", "Files", "Git status"];

// What the screen shows in a terminal of `size`, one string per row.
export function layout(size, { paint, folder }) {
  const { columns, rows } = size;
  if (columns < minimum.columns || rows < minimum.rows) {
    const message = ["Terminal too small", `${columns}x${rows}, needs at least ${minimum.columns}x${minimum.rows}`, "q: quit"];
    const top = Math.max(0, Math.floor((rows - message.length) / 2));
    return Array.from({ length: rows }, (_, row) => {
      const text = center(message[row - top] ?? "", rowWidth(row, size));
      return row === top ? paint.warning(text) : text;
    });
  }
  const lines = [paint.bar(spread(" toolsmith ui", ` ${folder} `, columns)), pad("", columns)];
  for (const panel of panels) {
    lines.push(paint.accent(pad(`  ${panel}`, 16)) + pad("coming soon", columns - 16));
  }
  while (lines.length < rows - 1) {
    lines.push(pad("", columns));
  }
  lines.push(paint.bar(pad(" q or Ctrl+C: quit", rowWidth(rows - 1, size))));
  return lines;
}

// The UI on a terminal: `input` must be able to go into raw mode, and `output`
// must have a size and "resize" events, as process.stdin and process.stdout do
// in a terminal. `draw` turns a size into rows, like layout() above. start()
// returns a promise that settles when the UI ends: it's rejected with the
// error when something went wrong.
export function createApp({ input, output, color = false, folder = "", draw = layout }) {
  const paint = paints(color);
  const screen = createScreen(output);
  const size = () => ({ columns: output.columns ?? 0, rows: output.rows ?? 0 });
  let running = false;
  let settle;
  const done = new Promise((resolve, reject) => (settle = { resolve, reject }));

  // A problem while the UI runs ends it, after the terminal is restored.
  const guarded =
    (handler) =>
    (...args) => {
      try {
        handler(...args);
      } catch (err) {
        stop(err);
      }
    };
  const render = guarded(() => screen.draw(draw(size(), { paint, folder })));
  const onResize = guarded(() => {
    screen.clear();
    render();
  });
  const onKey = guarded((text, key = {}) => {
    if (key.name === "q" || (key.ctrl && key.name === "c")) {
      stop();
    }
  });

  function start() {
    running = true;
    output.write(terminal.enterAlternateScreen + terminal.hideCursor + terminal.clear);
    emitKeypressEvents(input);
    input.setRawMode(true);
    input.on("keypress", onKey);
    output.on("resize", onResize);
    input.resume();
    render();
    return done;
  }

  // Restores the terminal, and ends the UI with `error` if there's one. The
  // normal screen comes back BEFORE raw mode is turned off: on the classic
  // Windows console, turning raw mode off while the alternate screen is
  // showing ends the console itself. Every step is tried even when one
  // before it fails, as it does when the terminal is already gone. Safe to
  // call more than once.
  function stop(error) {
    if (!running) {
      return;
    }
    running = false;
    const steps = [
      () => output.write(terminal.showCursor + terminal.leaveAlternateScreen),
      () => input.off("keypress", onKey),
      () => output.off("resize", onResize),
      () => input.setRawMode(false),
      () => input.pause(),
    ];
    for (const step of steps) {
      try {
        step();
      } catch {
        // Keep restoring what can be restored.
      }
    }
    if (error) {
      settle.reject(error);
    } else {
      settle.resolve();
    }
  }

  return { start, stop, done, rows: () => screen.rows() };
}

// Runs the UI on this process's terminal until it's closed. The ui command
// checks first that the input and output are a terminal.
export async function runUi({ input = process.stdin, output = process.stdout, color = false, folder = basename(process.cwd()) } = {}) {
  const app = createApp({ input, output, color, folder });
  // While the UI runs, whatever else ends the process restores the terminal
  // first: an error nothing caught (then reported like any other error), a
  // signal, or the process exiting.
  const onError = (err) => app.stop(err);
  const onSignal = (signal) => {
    app.stop();
    process.exit(128 + constants.signals[signal]);
  };
  const onExit = () => app.stop();
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
  process.on("uncaughtException", onError);
  process.on("unhandledRejection", onError);
  process.on("exit", onExit);
  for (const signal of signals) {
    process.on(signal, onSignal);
  }
  try {
    await app.start();
  } finally {
    process.off("uncaughtException", onError);
    process.off("unhandledRejection", onError);
    process.off("exit", onExit);
    for (const signal of signals) {
      process.off(signal, onSignal);
    }
  }
}
