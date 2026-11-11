import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, watch, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join, relative, resolve, sep } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { fileURLToPath } from "node:url";

const bin = fileURLToPath(new URL("../bin/toolsmith.js", import.meta.url));
const { name: toolsmithPackage } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

// The fake npm (see fixtures/fake-npm/npm) is in this folder, which runCli puts
// first on the PATH. It writes its arguments to fake-npm.txt in the folder it
// runs in, and a package-lock.json like npm does, and then fails with the exit
// code in FAKE_NPM_EXIT_CODE if that's set.
export const fakeNpmFolder = fileURLToPath(new URL("fixtures/fake-npm", import.meta.url));

// npm's own command-line script, for the few tests that need the real npm. Run
// it with node so that no shell is needed (npm on Windows is a batch file). It's
// npm_execpath under "npm test", or else the npm that comes with this Node.js,
// or undefined if there's neither.
export function npmCli() {
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    join(dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  return candidates.find((path) => path && basename(path) === "npm-cli.js" && existsSync(path));
}

// For runCli: makes the CLI believe its input is a terminal, so it asks its
// questions, and the test answers them through `input`.
export const terminalEnv = {
  NODE_OPTIONS: `--import "${new URL("fixtures/terminal-stdin.mjs", import.meta.url).href}"`,
};

// For runCli: makes the CLI believe that both its input and its output are a
// 60x15 terminal, for running `toolsmith ui` (see fixtures/terminal.mjs).
export const screenTerminalEnv = {
  NODE_OPTIONS: `--import "${new URL("fixtures/terminal.mjs", import.meta.url).href}"`,
};

// A pretend terminal for the UI's code (src/tui/app.js): input that can go into
// raw mode, and output with a size and "resize" events. `events` has, in
// order, everything written and every change of raw mode ("raw on", "raw off").
export function fakeTerminal(columns = 60, rows = 15) {
  const events = [];
  const input = Object.assign(new PassThrough(), {
    isTTY: true,
    isRaw: false,
    setRawMode(on) {
      this.isRaw = on;
      events.push(on ? "raw on" : "raw off");
      return this;
    },
  });
  const output = Object.assign(new EventEmitter(), {
    isTTY: true,
    columns,
    rows,
    write(text) {
      events.push(text);
      return true;
    },
  });
  return { input, output, events };
}

// Types `keys` into a fakeTerminal() one at a time, each as the codes a
// terminal sends, like "\x1b[A" for Up. A lone Esc only counts as Esc after a
// short wait (see escapeTimeout in src/tui/app.js), so this waits for it.
export async function pressKeys(term, ...keys) {
  for (const key of keys) {
    term.input.write(key);
    await new Promise((resolve) => setTimeout(resolve, key === "\x1b" ? 150 : 1));
  }
}

// Screen snapshots, for toolsmith ui (see ui-snapshots.test.js): each is a
// text file in test/snapshots/ with the screen a test expects. When the tests
// run with --update-snapshots (npm run test:update-snapshots), the files are
// written from the screens as they are now, instead of checked.
const snapshotFolder = fileURLToPath(new URL("snapshots/", import.meta.url));
export const updatingSnapshots = process.argv.includes("--update-snapshots");

// The names that snapshots give the codes of src/tui/screen.js's paints().
const styleNames = { 1: "bold", 22: "/bold", 7: "inverse", 27: "/inverse", 33: "yellow", 36: "cyan", 39: "/color" };

// Replaces each match of `pattern` in `row` with `placeholder`, and makes up
// for the difference in width in the nearest run of padding (two spaces or
// more) before it, or else after it, in the same panel (panels are separated
// by "│"): so the columns stay where they were, whatever width the value had.
function replaceAligned(row, pattern, placeholder) {
  let text = row;
  let from = 0;
  for (let match; (match = new RegExp(pattern.source, "g").exec(text.slice(from))); ) {
    const start = from + match.index;
    text = text.slice(0, start) + placeholder + text.slice(start + match[0].length);
    from = start + placeholder.length;
    const extra = placeholder.length - match[0].length;
    const panelStart = text.lastIndexOf("│", start) + 1;
    const panelEnd = text.indexOf("│", from) === -1 ? text.length : text.indexOf("│", from);
    const before = [...text.slice(panelStart, start).matchAll(/ {2,}/g)].at(-1);
    const after = / {2,}/.exec(text.slice(from, panelEnd));
    const padding = before ? { index: panelStart + before.index, length: before[0].length } : after ? { index: from + after.index, length: after[0].length } : null;
    if (extra !== 0 && padding) {
      const length = Math.max(1, padding.length - extra);
      text = text.slice(0, padding.index) + " ".repeat(length) + text.slice(padding.index + padding.length);
      if (padding.index < start) {
        from += length - padding.length;
      }
    }
  }
  return text;
}

// A screen (one string per row, as app.rows() gives it) as the text of a
// snapshot: a line per row, without the spaces that pad its end. Styles and
// colors are shown by name, like {inverse}…{/inverse} or {cyan}…{/color}, so a
// change in them shows in a diff too. What could differ from one system or run
// to the next is replaced: each folder in `folders` ({ path: name }), wherever
// its path comes up, with / between the names after it; the digits of sizes,
// with # ("1.5 KB" becomes "#.# KB", as wide as it was, so a column of them
// stays lined up); and durations, with <time>, keeping the columns after them
// where they were (see replaceAligned()).
export function screenText(rows, { folders = {} } = {}) {
  const paths = Object.entries(folders).flatMap(([folder, name]) =>
    [...new Set([folder, realpathSync(folder), realpathSync.native(folder)])].map((path) => [path, name]),
  );
  const lines = rows.map((row) => {
    let text = row;
    for (const [path, name] of paths) {
      const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      text = text.replace(new RegExp(`${escaped}((?:[\\\\/][^\\s│"']*)?)`, "g"), (_, rest) => name + rest.replaceAll("\\", "/"));
    }
    text = text.replace(/\b\d+(?:\.\d+)? [KMGT]?B\b/g, (size) => size.replace(/\d/g, "#"));
    text = replaceAligned(text, /\b\d+ min \d+ s\b|\b\d+\.\d s\b|\b\d+ ms\b/, "<time>");
    const named = text.replace(/\x1b\[([0-9;]*)m/g, (_, codes) =>
      codes
        .split(";")
        .map((code) => `{${styleNames[code] ?? `sgr ${code}`}}`)
        .join(""),
    );
    return named.replaceAll("\x1b", "\\e").trimEnd();
  });
  return `${lines.join("\n")}\n`;
}

// Checks that `text` (from screenText()) is the snapshot `name`, the file
// test/snapshots/<name>.txt. When it isn't, the error shows each line that
// differs, as the snapshot has it (-) and as the screen is now (+).
export function assertSnapshot(name, text) {
  const file = join(snapshotFolder, `${name}.txt`);
  const shown = `test/snapshots/${name}.txt`;
  const update = "If the new screen is right, update the snapshots with: npm run test:update-snapshots";
  if (updatingSnapshots) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    return;
  }
  if (!existsSync(file)) {
    assert.fail(`There's no snapshot ${shown} yet. The screen is:\n\n${text}\n${update}`);
  }
  // Git may check text files out with CRLF on Windows.
  const expected = readFileSync(file, "utf8").replaceAll("\r\n", "\n");
  if (expected === text) {
    return;
  }
  const want = expected.split("\n");
  const got = text.split("\n");
  const differences = [];
  for (let line = 0; line < Math.max(want.length, got.length); line++) {
    if (want[line] !== got[line]) {
      differences.push(`line ${line + 1}:`, `  - ${want[line] ?? "(no line)"}`, `  + ${got[line] ?? "(no line)"}`);
    }
  }
  assert.fail(`The screen doesn't match the snapshot ${shown} (- snapshot, + screen):\n\n${differences.join("\n")}\n\n${update}`);
}

// Streams for createPrompt: `answers` are typed in all at once, then the input
// ends; written() returns everything the prompt wrote.
export function promptStreams(answers) {
  let written = "";
  const input = new PassThrough();
  const output = new Writable({
    decodeStrings: false,
    write(chunk, encoding, callback) {
      written += chunk;
      callback();
    },
  });
  input.end(answers);
  return { input, output, written: () => written };
}

// Runs the CLI in a child process and resolves to { stdout, stderr, code }.
// TOOLSMITH_CONFIG always points to a temp path, so the real ~/.toolsmithrc is
// never read, and NO_COLOR=1 is set unless a test overrides it. The fake npm
// comes first on the PATH, so tests never run the real npm (or download
// anything). npm_config_prefix, where global plugins are looked for, points to
// a temp path too, unless a test sets it. Set a variable to undefined in `env`
// to remove it, and PATH to replace the whole PATH. `cwd` sets the folder the
// CLI runs in, `input` is typed into the CLI (otherwise its input is empty),
// and `script` runs another copy of toolsmith.
export function runCli(args, { env = {}, cwd, input, script = bin } = {}) {
  const childEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    // Windows spells it "Path"; one spelling lets `env` replace it. npm's
    // prefix may come in any case, so any spelling of it is dropped.
    if (key.toLowerCase() !== "npm_config_prefix") {
      childEnv[key.toUpperCase() === "PATH" ? "PATH" : key] = value;
    }
  }
  childEnv.PATH = [fakeNpmFolder, childEnv.PATH].filter(Boolean).join(delimiter);
  // The test runner sets FORCE_COLOR for test files when the terminal has
  // colors, so start from the same color setup everywhere.
  delete childEnv.FORCE_COLOR;
  delete childEnv.NODE_DISABLE_COLORS;
  childEnv.NO_COLOR = "1";
  Object.assign(childEnv, env);
  childEnv.TOOLSMITH_CONFIG ||= join(tmpdir(), `toolsmith-no-config-${randomUUID()}.json`);
  childEnv.npm_config_prefix ||= join(tmpdir(), `toolsmith-no-npm-prefix-${randomUUID()}`);

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd,
      env: childEnv,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    child.stdin?.end(input);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, code }));
  });
}

// The relative files that `file` imports statically (import ... from, or
// export ... from), as absolute paths. import() isn't static, so it's left out.
function staticImports(file) {
  const text = readFileSync(file, "utf8");
  const patterns = [/^\s*import\s+(?:[\w*{}\s,$]+\s+from\s+)?["'](\.[^"']+)["']/gm, /^\s*export\s+(?:\*|\{[^}]*\})\s+from\s+["'](\.[^"']+)["']/gm];
  return patterns.flatMap((pattern) => Array.from(text.matchAll(pattern), ([, path]) => resolve(dirname(file), path)));
}

// toolsmith's own files that load whenever it starts, whatever the command:
// those that bin/toolsmith.js imports statically, and so on. Paths are
// relative to the repository, with "/".
export function loadedAtStart() {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const reached = new Set();
  const visit = (file) => {
    if (!reached.has(file)) {
      reached.add(file);
      staticImports(file).forEach(visit);
    }
  };
  visit(join(root, "bin", "toolsmith.js"));
  return [...reached].map((file) => relative(root, file).split(sep).join("/"));
}

// What `toolsmith <words> --help` lists: its commands' names (with "help"),
// and the terms of its arguments and options, like "paths" and "--depth <n>".
export async function helpListing(...words) {
  const { stdout, stderr, code } = await runCli([...words, "--help"]);
  if (code !== 0) {
    throw new Error(`toolsmith ${words.join(" ")} --help failed: ${stderr}`);
  }
  // The terms start two spaces in; descriptions that wrap start further in.
  const terms = (title) => {
    const block = stdout.match(new RegExp(`^${title}:\\r?\\n((?: .*(?:\\r?\\n|$))*)`, "m"))?.[1] ?? "";
    return [...block.matchAll(/^ {2}(\S.*?)(?: {2,}|\r?$)/gm)].map(([, term]) => term);
  };
  return {
    commands: terms("Commands").map((term) => term.split(" ")[0]),
    arguments: terms("Arguments"),
    options: terms("Options"),
  };
}

// What each test started that must stop when it ends (see stopWhenDone).
const started = new WeakMap();

// Calls `stop` when the test `t` ends, once, and before any of its temp
// folders are deleted: for what a test starts that would keep its process
// running, like a dashboard, which watches its folder. t.after() runs hooks in
// the order they were added, and skips the rest when one fails, as deleting a
// folder can; tempDir() is mostly called first, so its hook comes first, and
// it stops these before it deletes anything.
export function stopWhenDone(t, stop) {
  let stopped = false;
  const once = () => {
    if (!stopped) {
      stopped = true;
      stop();
    }
  };
  started.set(t, [...(started.get(t) ?? []), once]);
  t.after(once);
}

// Returns once every folder this process has started to watch with fs.watch
// is watched, so that a change the test makes next is reported. On macOS,
// fs.watch watches a folder with FSEvents, and libuv (Node's I/O library)
// starts that on a thread of its own after fs.watch has returned: it keeps one
// FSEvents stream for all the folders the process watches, and makes it anew,
// from "now", each time a folder is added, so a change made before the new
// stream runs is never reported. Closing a watch is the one call that waits
// for that thread, until the stream runs again for every folder still watched
// (uv__fsevents_close() in libuv's src/unix/fsevents.c), so this watches the
// test folder and closes that watch at once. On Linux and Windows, a folder is
// watched from the moment fs.watch returns (inotify_add_watch,
// ReadDirectoryChangesW), and there's nothing to wait for.
export function waitForWatches() {
  if (process.platform === "darwin") {
    watch(fileURLToPath(new URL(".", import.meta.url))).close();
  }
}

// Creates a temp folder that is deleted when the test `t` finishes, after what
// the test started is stopped (see stopWhenDone). On Windows, a folder can't
// be deleted while a process runs in it, like one that was just cancelled and
// is still ending, and rmSync then fails at once (EPERM or EBUSY; its
// maxRetries doesn't cover that), so deleting it is tried again for up to two
// seconds.
export function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "toolsmith-test-"));
  t.after(async () => {
    for (const stop of started.get(t) ?? []) {
      stop();
    }
    for (let attempt = 1; ; attempt++) {
      try {
        rmSync(dir, { recursive: true, force: true });
        return;
      } catch (err) {
        if (attempt >= 40 || !["EPERM", "EBUSY", "ENOTEMPTY"].includes(err.code)) {
          throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  });
  return dir;
}

// Locks `folder`, so that its entries can't be listed, and returns what
// unlocks it: chmod 000 on macOS and Linux, and on Windows denying everyone
// the right to list it (Node then gets EPERM, whose reason is "permission
// denied" too).
function lock(folder) {
  if (process.platform === "win32") {
    execFileSync("icacls", [folder, "/deny", "*S-1-1-0:(RD)"], { stdio: "ignore" });
    return () => execFileSync("icacls", [folder, "/remove:d", "*S-1-1-0"], { stdio: "ignore" });
  }
  chmodSync(folder, 0o000);
  return () => chmodSync(folder, 0o755);
}

// Whether whileLocked() keeps this process out of a folder, found out once by
// trying. It doesn't for root on macOS and Linux, nor on Windows with the
// backup privilege turned on, as Git Bash turns it on for an administrator
// (and the programs it starts inherit it): both read every folder.
let lockable;
export function canLockFolders() {
  if (lockable === undefined) {
    const folder = mkdtempSync(join(tmpdir(), "toolsmith-lock-"));
    const unlock = lock(folder);
    try {
      readdirSync(folder);
      lockable = false;
    } catch {
      lockable = true;
    } finally {
      unlock();
      rmSync(folder, { recursive: true, force: true });
    }
  }
  return lockable;
}

// Runs `task` with `folder` locked (see lock()), and unlocks it after, even
// when `task` fails, so that the temp folder it's in can be deleted when the
// test `t` ends. It's unlocked as soon as `t` ends, too, even if `task` hasn't:
// when something the test started throws where nothing catches it, the test
// runner fails the test and ends it at once, and runs its after hooks, while
// `task` goes on.
export async function whileLocked(t, folder, task) {
  const unlockFolder = lock(folder);
  let locked = true;
  const unlock = () => {
    if (locked) {
      locked = false;
      unlockFolder();
    }
  };
  t.signal.addEventListener("abort", unlock, { once: true });
  try {
    return await task();
  } finally {
    t.signal.removeEventListener("abort", unlock);
    unlock();
  }
}

// For runCli: a git config of its own, with Grace Hopper as the user, so the
// real ~/.gitconfig and the system's config are never read. The ceiling keeps
// git from finding a repository above the temp folder.
export function gitEnv(t) {
  const file = join(tempDir(t), "gitconfig");
  writeFileSync(file, "[user]\n\tname = Grace Hopper\n\temail = grace@example.com\n");
  return { GIT_CONFIG_GLOBAL: file, GIT_CONFIG_NOSYSTEM: "1", GIT_CEILING_DIRECTORIES: tmpdir() };
}

// Files for makeTree: a plugin package `name` in `folder` (a node_modules
// folder), with `code` as its index.js. Its package.json is an ES module
// package with `version`, with `toolsmith` as the range in its
// peerDependencies, and with `commands` listed under "toolsmith" (so it's
// loaded on demand), if those are given; `packageJson` replaces it entirely.
export function pluginPackage(name, code, options = {}) {
  const { folder = "node_modules", version = "1.0.0", toolsmith, commands, packageJson } = options;
  const json = {
    name,
    version,
    type: "module",
    ...(toolsmith && { peerDependencies: { [toolsmithPackage]: toolsmith } }),
    ...(commands && { toolsmith: { commands } }),
  };
  return {
    [`${folder}/${name}/package.json`]: packageJson ?? JSON.stringify(json),
    [`${folder}/${name}/index.js`]: code,
  };
}

// Plugin code that adds the command `command`, which prints `text`.
export function pluginSays(command, text) {
  return `export function register(api) {
  api.command(${JSON.stringify(command)}).description("prints ${text}").action(() => api.output.success(${JSON.stringify(text)}));
}
`;
}

// Writes `contents` to a config file in a fresh temp folder and returns its path.
export function writeTempConfig(t, contents) {
  const path = join(tempDir(t), "config.json");
  writeFileSync(path, contents);
  return path;
}

// Creates a git repository with one empty commit ("first commit", at `date` if
// given) in a fresh temp folder (deleted after the test). Returns:
//   dir     the repository folder
//   git     git(...args) runs git in it and returns the output
//   commit  commit(message, { date, author, merge }) makes an empty commit, or
//           with `merge` merges that branch; `date` is ISO 8601 and `author`
//           "Name <email>"
//   env     what to pass to runCli
// user.name and user.email are set in the repository itself, and global and
// system git settings are shut out, so this works the same on any machine.
export function makeRepo(t, { branch = "main", date } = {}) {
  const dir = tempDir(t);
  const env = { GIT_CONFIG_GLOBAL: join(dir, "no-global-config"), GIT_CONFIG_NOSYSTEM: "1" };
  const run = (args, extraEnv) =>
    execFileSync("git", args, { cwd: dir, env: { ...process.env, ...env, ...extraEnv }, encoding: "utf8" }).trim();
  const git = (...args) => run(args);
  const commit = (message, { date: at, author, merge } = {}) => {
    const extraEnv = {};
    if (at) {
      Object.assign(extraEnv, { GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at });
    }
    if (author) {
      const [, name, email] = /^(.+) <(.+)>$/.exec(author);
      Object.assign(extraEnv, { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email });
    }
    const args = merge
      ? ["merge", "--quiet", "--no-ff", "-m", message, merge]
      : ["commit", "--quiet", "--allow-empty", "-m", message];
    run(args, extraEnv);
  };
  git("init", "--quiet", `--initial-branch=${branch}`);
  git("config", "user.name", "Toolsmith Tests");
  git("config", "user.email", "tests@example.com");
  commit("first commit", { date });
  return { dir, git, commit, env };
}

// Makes `newPath` a hard link to `existing`. If the file system can't do that,
// the test is skipped and this returns false.
export function hardLinkOrSkip(t, existing, newPath) {
  try {
    linkSync(existing, newPath);
    return true;
  } catch (err) {
    t.skip(`hard links aren't supported here (${err.code})`);
    return false;
  }
}

// Builds a folder tree in a fresh temp folder (deleted after the test) and
// returns its path. Keys are relative paths: "a/b.txt": "text" creates a file,
// and a key ending in "/" creates an empty folder.
export function makeTree(t, tree) {
  const root = tempDir(t);
  for (const [path, contents] of Object.entries(tree)) {
    const fullPath = join(root, path);
    if (path.endsWith("/")) {
      mkdirSync(fullPath, { recursive: true });
    } else {
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, contents);
    }
  }
  return root;
}
