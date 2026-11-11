import { spawn } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

// Finding and starting other programs, never through a shell.

// Where the program `name` is on the PATH of `env` (by default this
// process's), or undefined. On Windows it tries the extensions Windows can
// start (npm is npm.cmd there), like cmd.exe, but unlike cmd.exe it never
// looks in the current folder.
export function findProgram(name, env = process.env) {
  const extensions = process.platform === "win32" ? [".com", ".exe", ".bat", ".cmd"] : [""];
  for (const entry of searchPath(env).split(delimiter)) {
    const folder = entry.replace(/^"(.*)"$/, "$1"); // Windows allows quotes here.
    if (!isAbsolute(folder)) {
      continue;
    }
    for (const extension of extensions) {
      const path = join(folder, name + extension);
      if (isProgram(path)) {
        return path;
      }
    }
  }
  return undefined;
}

// The PATH in `env`. Windows doesn't mind its case ("Path" is usual there),
// and neither does process.env, but a copy of it does.
function searchPath(env) {
  if (env === process.env || process.platform !== "win32") {
    return env.PATH ?? "";
  }
  return env.PATH ?? Object.entries(env).find(([key]) => key.toUpperCase() === "PATH")?.[1] ?? "";
}

function isProgram(path) {
  try {
    accessSync(path, constants.X_OK); // On Windows, only that it exists.
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

// Starts `program`, a name on the PATH or a path, with `args`, and returns the
// child process; `options` are spawn()'s. A name is looked for on the PATH
// that the program gets, in `options.env` when there's one. Throws an error
// with code ENOENT when there's no such program.
//
// On Windows, only cmd.exe can run batch files (.cmd and .bat), like VS Code's
// `code`; see cmdLine() for how the arguments get there safely.
export function startProgram(program, args, options = {}) {
  const path = isAbsolute(program) || /[\\/]/.test(program) ? program : findProgram(program, options.env);
  if (!path) {
    throw Object.assign(new Error(`${program} isn't installed, or isn't on your PATH`), { code: "ENOENT" });
  }
  if (process.platform === "win32" && /\.(bat|cmd)$/i.test(path)) {
    return spawn(...cmdLine(`"${path}"`, args, options));
  }
  return spawn(path, args, { ...options, shell: false });
}

// Runs `program` (as startProgram() finds it) with `args` in `cwd`, without
// input, and returns { code, signal, stdout, stderr } once it has ended,
// whatever its exit code. Rejects with an error with code ENOENT when there's
// no such program. When `signal` is aborted, the program is stopped, with all
// the programs it started (see killTree), and this rejects with the signal's
// reason.
export function runProgram(program, args, { cwd, env = process.env, signal } = {}) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    // Elsewhere than on Windows, the child leads a process group of its own,
    // so that killTree() can stop the programs it starts too.
    const child = startProgram(program, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, detached: process.platform !== "win32" });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    const abort = () => {
      killTree(child);
      reject(signal.reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
    child.on("error", (err) => {
      signal?.removeEventListener("abort", abort);
      reject(err);
    });
    child.on("close", (code, ended) => {
      signal?.removeEventListener("abort", abort);
      resolve({ code, signal: ended, stdout, stderr });
    });
  });
}

// Ends `child` and all the processes it started. On Windows, taskkill ends
// the whole tree (it's called by its full path, so that no other program of
// that name can stand in for it). Elsewhere, the child must lead its own
// process group (spawn it with `detached: true`): the group gets SIGTERM, and
// SIGKILL two seconds later if anything is left.
export function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  if (process.platform === "win32") {
    const taskkill = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe");
    spawn(taskkill, ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).on("error", () => child.kill());
    return;
  }
  const signalGroup = (signal) => {
    try {
      process.kill(-child.pid, signal);
    } catch {
      // The group is gone already.
    }
  };
  signalGroup("SIGTERM");
  setTimeout(() => signalGroup("SIGKILL"), 2000).unref();
}

// The spawn() arguments for running `command` in cmd.exe with `args` after it.
// `command` is fixed text, like `start ""` or a batch file's path in quotes.
// The arguments never become part of cmd.exe's command line: each is in an
// environment variable, and the line only has "%TOOLSMITH_ARG_1%" and so on,
// in double quotes. cmd.exe puts the values in before it reads the line, and
// inside double quotes it doesn't treat &, |, <, > or ^ as commands; its
// delayed expansion (!) is off. So a file named "a & b %PATH%.txt" stays one
// argument, as it is. (Windows file names can't contain double quotes.)
// /d skips cmd.exe's AutoRun commands, and /s /c runs what's between the
// outer quotes.
export function cmdLine(command, args, options = {}) {
  const env = { ...(options.env ?? process.env) };
  const words = args.map((arg, index) => {
    if (arg === "") {
      // An empty variable doesn't exist on Windows, so it couldn't be expanded.
      return '""';
    }
    env[`TOOLSMITH_ARG_${index + 1}`] = arg;
    return `"%TOOLSMITH_ARG_${index + 1}%"`;
  });
  return [
    process.env.ComSpec ?? "cmd.exe",
    ["/d", "/v:off", "/s", "/c", `"${[command, ...words].join(" ")}"`],
    { ...options, env, windowsVerbatimArguments: true, shell: false },
  ];
}
