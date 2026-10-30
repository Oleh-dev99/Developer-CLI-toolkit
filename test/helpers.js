import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { linkSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { fileURLToPath } from "node:url";

const bin = fileURLToPath(new URL("../bin/toolsmith.js", import.meta.url));

// The fake npm (see fixtures/fake-npm/npm) is in this folder, which runCli puts
// first on the PATH. It writes its arguments to fake-npm.txt in the folder it
// runs in, and a package-lock.json like npm does, and then fails with the exit
// code in FAKE_NPM_EXIT_CODE if that's set.
export const fakeNpmFolder = fileURLToPath(new URL("fixtures/fake-npm", import.meta.url));

// For runCli: makes the CLI believe its input is a terminal, so it asks its
// questions, and the test answers them through `input`.
export const terminalEnv = {
  NODE_OPTIONS: `--import "${new URL("fixtures/terminal-stdin.mjs", import.meta.url).href}"`,
};

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
// anything). Set a variable to undefined in `env` to remove it, and PATH to
// replace the whole PATH. `cwd` sets the folder the CLI runs in, and `input` is
// typed into the CLI (otherwise its input is empty).
export function runCli(args, { env = {}, cwd, input } = {}) {
  const childEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    // Windows spells it "Path"; one spelling lets `env` replace it.
    childEnv[key.toUpperCase() === "PATH" ? "PATH" : key] = value;
  }
  childEnv.PATH = [fakeNpmFolder, childEnv.PATH].filter(Boolean).join(delimiter);
  // The test runner sets FORCE_COLOR for test files when the terminal has
  // colors, so start from the same color setup everywhere.
  delete childEnv.FORCE_COLOR;
  delete childEnv.NODE_DISABLE_COLORS;
  childEnv.NO_COLOR = "1";
  Object.assign(childEnv, env);
  childEnv.TOOLSMITH_CONFIG ||= join(tmpdir(), `toolsmith-no-config-${randomUUID()}.json`);

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], {
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

// Creates a temp folder that is deleted when the test `t` finishes.
export function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "toolsmith-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// For runCli: a git config of its own, with Grace Hopper as the user, so the
// real ~/.gitconfig and the system's config are never read. The ceiling keeps
// git from finding a repository above the temp folder.
export function gitEnv(t) {
  const file = join(tempDir(t), "gitconfig");
  writeFileSync(file, "[user]\n\tname = Grace Hopper\n\temail = grace@example.com\n");
  return { GIT_CONFIG_GLOBAL: file, GIT_CONFIG_NOSYSTEM: "1", GIT_CEILING_DIRECTORIES: tmpdir() };
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
