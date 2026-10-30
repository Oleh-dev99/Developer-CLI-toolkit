import { spawn } from "node:child_process";
import { once } from "node:events";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

// Runs npm with `args` in `cwd`. npm's output is shown as it comes, and a
// failure throws. Like git, npm is started without a shell, except that
// Windows needs cmd.exe for it (see below), so `args` must be fixed words like
// "install", never input from the user.
export async function npm(args, { cwd = process.cwd() } = {}) {
  const path = findProgram("npm");
  if (!path) {
    throw new Error("npm isn't installed, or isn't on your PATH");
  }
  const options = { cwd, stdio: ["ignore", "inherit", "inherit"] };
  // On Windows npm is usually npm.cmd, a batch file. Only cmd.exe can run
  // those, and since its April 2024 security releases Node refuses to start
  // one without a shell. So cmd.exe is started here, the way Node does it:
  // /d skips cmd.exe's AutoRun commands, and /s /c runs the line between the
  // outer quotes, which is npm's full path in quotes (a path can't contain
  // any) and `args`.
  const child = /\.(bat|cmd)$/i.test(path)
    ? spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `""${path}" ${args.join(" ")}"`], {
        ...options,
        windowsVerbatimArguments: true,
      })
    : spawn(path, args, options);
  const [code, signal] = await once(child, "close");
  if (code !== 0) {
    throw new Error(`npm ${args.join(" ")} failed (${signal ?? `exit code ${code}`})`);
  }
}

// Where the program `name` is on the PATH, or undefined. On Windows it tries
// the extensions Windows can start (npm is npm.cmd there), like cmd.exe, but
// unlike cmd.exe it never looks in the current folder.
function findProgram(name) {
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
