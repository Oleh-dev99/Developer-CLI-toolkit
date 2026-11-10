import { spawn } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

// Finding and starting other programs, never through a shell.

// Where the program `name` is on the PATH, or undefined. On Windows it tries
// the extensions Windows can start (npm is npm.cmd there), like cmd.exe, but
// unlike cmd.exe it never looks in the current folder.
export function findProgram(name) {
  const extensions = process.platform === "win32" ? [".com", ".exe", ".bat", ".cmd"] : [""];
  for (const entry of (process.env.PATH ?? "").split(delimiter)) {
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

function isProgram(path) {
  try {
    accessSync(path, constants.X_OK); // On Windows, only that it exists.
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

// Starts `program`, a name on the PATH or a path, with `args`, and returns the
// child process; `options` are spawn()'s. Throws an error with code ENOENT when
// there's no such program.
//
// On Windows, only cmd.exe can run batch files (.cmd and .bat), like VS Code's
// `code`; see cmdLine() for how the arguments get there safely.
export function startProgram(program, args, options = {}) {
  const path = isAbsolute(program) || /[\\/]/.test(program) ? program : findProgram(program);
  if (!path) {
    throw Object.assign(new Error(`${program} isn't installed, or isn't on your PATH`), { code: "ENOENT" });
  }
  if (process.platform === "win32" && /\.(bat|cmd)$/i.test(path)) {
    return spawn(...cmdLine(`"${path}"`, args, options));
  }
  return spawn(path, args, { ...options, shell: false });
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
