import { constants } from "node:os";
import { basename } from "node:path";
import { emitKeypressEvents } from "node:readline";
import { describeCommands } from "./commands.js";
import { createDashboard } from "./dashboard.js";
import { createScreen, paints, terminal } from "./screen.js";

// The terminal side of `toolsmith ui`: the alternate screen, raw mode, resizes
// and restoring the terminal. What's on screen and what keys do is up to the
// view, src/tui/dashboard.js. src/commands/ui.js imports this only when that
// command runs, so other commands never load it.

// How long a lone Esc waits for the rest of a key's code before it counts as
// Esc. Keys like Up arrive as Esc followed by more characters, at once.
// Readline's own wait, half a second, makes Esc feel slow.
const escapeTimeout = 50;

// The UI on a terminal: `input` must be able to go into raw mode, and `output`
// must have a size and "resize" events, as process.stdin and process.stdout do
// in a terminal. `view.render(size, paint)` gives the screen as one string per
// row, and `view.key(text, key)` handles a readline "keypress" event,
// returning "quit" to end the UI. start() returns a promise that settles when
// the UI ends: it's rejected with the error when something went wrong.
export function createApp({ input, output, color = false, view = createDashboard() }) {
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
  const render = guarded(() => screen.draw(view.render(size(), paint)));
  // For things that change on their own, like a command's output: draws at
  // most about 60 times a second, however fast the output comes.
  let pending = null;
  const redraw = () => {
    pending ??= setTimeout(() => {
      pending = null;
      if (running) {
        render();
      }
    }, 16);
  };
  const onResize = guarded(() => {
    screen.clear();
    render();
  });
  const onKey = guarded((text, key = {}) => {
    if (view.key(text, key) === "quit") {
      stop();
    } else {
      render();
    }
  });

  function start() {
    running = true;
    output.write(terminal.enterAlternateScreen + terminal.hideCursor + terminal.clear);
    emitKeypressEvents(input, { escapeCodeTimeout: escapeTimeout });
    input.setRawMode(true);
    input.on("keypress", onKey);
    output.on("resize", onResize);
    input.resume();
    view.connect?.(redraw);
    render();
    return done;
  }

  // Restores the terminal, and ends the UI with `error` if there's one. The
  // normal screen comes back BEFORE raw mode is turned off: on the classic
  // Windows console, turning raw mode off while the alternate screen is
  // showing ends the console itself. Every step is tried even when one
  // before it fails, as it does when the terminal is already gone. Safe to
  // call more than once. (With Node.js 22, that console comes back in plain
  // line mode rather than exactly as it was: QuickEdit and insert mode are
  // off. Node 26 restores it exactly, and JavaScript can't set it.)
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
      () => clearTimeout(pending),
      // A command still running in the view is stopped too.
      () => view.dispose?.(),
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

// Runs the UI on this process's terminal until it's closed, offering the
// commands of `program` (a Commander program, with plugins loaded). The ui
// command checks first that the input and output are a terminal.
export async function runUi({ input = process.stdin, output = process.stdout, color = false, folder = basename(process.cwd()), program } = {}) {
  const commands = program ? describeCommands(program) : [];
  const app = createApp({ input, output, color, view: createDashboard({ folder, commands }) });
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
