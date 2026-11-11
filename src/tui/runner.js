import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { formatDuration } from "../lib/format.js";
import { killTree } from "../lib/program.js";
import { createList } from "./list.js";
import { plainLine } from "./screen.js";

// Runs a toolsmith command for the dashboard, as a child process of toolsmith
// itself (no shell), and keeps its output in a list that scrolls.

const bin = fileURLToPath(new URL("../../bin/toolsmith.js", import.meta.url));
// The most output lines kept; older ones are dropped.
const maxLines = 5000;

// Runs `toolsmith <args>` in `cwd`. Its input is empty, so it can't ask
// anything. Colors are off (NO_COLOR) and any escape codes left are removed,
// so the output reads the same everywhere; lines from stderr are bold.
// `onChange` is called whenever there's something new to show. Returns
// { output, running, status(), cancel(), dispose() }.
export function runCommand(args, { cwd = process.cwd(), env = process.env, onChange = () => {} } = {}) {
  const lines = [];
  const output = createList(lines, { selectable: false, label: (line) => line.text, style: (line) => (line.error ? "bold" : undefined) });
  const started = performance.now();
  const run = { output, running: true, cancelled: false, code: null, signal: null, failed: null, ended: null };

  const childEnv = { ...env, NO_COLOR: "1" };
  delete childEnv.FORCE_COLOR;
  // Elsewhere than on Windows, the child leads a process group of its own, so
  // that cancelling can stop the programs it starts too.
  const child = spawn(process.execPath, [bin, ...args], {
    cwd,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: process.platform !== "win32",
  });

  const add = (text, error = false) => {
    const following = output.isAtEnd();
    lines.push({ text, error });
    if (lines.length > maxLines) {
      lines.splice(0, lines.length - maxLines);
    }
    if (following) {
      output.last();
    }
  };
  const partial = { stdout: "", stderr: "" };
  for (const stream of ["stdout", "stderr"]) {
    child[stream].setEncoding("utf8");
    child[stream].on("data", (chunk) => {
      const parts = (partial[stream] + chunk).split(/\r?\n/);
      partial[stream] = parts.pop();
      for (const part of parts) {
        add(plainLine(part), stream === "stderr");
      }
      onChange();
    });
  }

  // The time shown while it runs.
  const ticker = setInterval(onChange, 500);
  ticker.unref();

  const finish = () => {
    if (!run.running) {
      return;
    }
    for (const stream of ["stdout", "stderr"]) {
      if (partial[stream]) {
        add(plainLine(partial[stream]), stream === "stderr");
        partial[stream] = "";
      }
    }
    clearInterval(ticker);
    run.running = false;
    run.ended = performance.now();
    add("");
    add(`[${run.status()}]`);
    onChange();
  };
  child.on("error", (err) => {
    run.failed = err.message;
    finish();
  });
  child.on("close", (code, signal) => {
    if (run.running) {
      Object.assign(run, { code, signal });
    }
    finish();
  });

  // "running, 1.2 s", "exit code 0 after 1.2 s", "cancelled after 3.4 s".
  run.status = () => {
    const took = formatDuration((run.ended ?? performance.now()) - started);
    if (run.running) {
      return run.cancelled ? `cancelling, ${took}` : `running, ${took}`;
    }
    if (run.failed) {
      return `couldn't start: ${run.failed}`;
    }
    if (run.cancelled) {
      return `cancelled after ${took}`;
    }
    return run.signal ? `ended by ${run.signal} after ${took}` : `exit code ${run.code} after ${took}`;
  };

  // Stops the command and every program it started.
  run.cancel = () => {
    if (run.running && !run.cancelled) {
      run.cancelled = true;
      killTree(child);
      onChange();
    }
  };
  run.dispose = run.cancel;
  return run;
}

