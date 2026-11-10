import { spawn } from "node:child_process";
import { cmdLine, startProgram } from "../lib/program.js";
import { splitWords } from "../lib/quote.js";

// Opening a file from toolsmith ui: in the editor people chose, or in the
// app their system opens it with. Never through a shell.

// The editor from VISUAL, or else EDITOR, as words: "code --wait" →
// ["code", "--wait"]. Null when neither is set.
export function editorCommand(env = process.env) {
  const value = env.VISUAL?.trim() || env.EDITOR?.trim();
  return value ? splitWords(value) : null;
}

// Runs the editor `words` on `path`, in this terminal, and resolves to
// { code, signal } when it ends. Rejects when it can't be started.
export function runEditor(words, path, { cwd, env } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = startProgram(words[0], [...words.slice(1), path], { cwd, env, stdio: "inherit" });
    } catch (err) {
      reject(err);
      return;
    }
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
}

// How to open `path` in its default app on `platform`, as spawn()'s
// arguments: `start` on Windows, which only cmd.exe has (the path gets there
// safely, see cmdLine()), `open` on macOS, and `xdg-open` elsewhere.
export function openerFor(path, platform = process.platform) {
  if (platform === "win32") {
    // start's first quoted word is a window title, so it gets an empty one.
    return cmdLine('start ""', [path]);
  }
  return [platform === "darwin" ? "open" : "xdg-open", [path], {}];
}

// Opens `path` in its default app and resolves once that's started, without
// waiting for the app. Rejects when the opener can't be started, like
// xdg-open on a system without it.
export function openWithApp(path, { platform = process.platform, start = spawn } = {}) {
  const [command, args, options] = openerFor(path, platform);
  return new Promise((resolve, reject) => {
    const child = start(command, args, { ...options, stdio: "ignore", detached: platform !== "win32", windowsHide: true });
    child.on("error", reject);
    child.on("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
