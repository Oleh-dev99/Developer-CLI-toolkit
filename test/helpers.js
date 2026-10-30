import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const bin = fileURLToPath(new URL("../bin/toolsmith.js", import.meta.url));

// Runs the CLI in a child process and resolves to { stdout, stderr, code }.
// TOOLSMITH_CONFIG always points to a temp path, so the real ~/.toolsmithrc is
// never read, and NO_COLOR=1 is set unless a test overrides it. Set a variable
// to undefined in `env` to remove it. `cwd` sets the folder the CLI runs in.
export function runCli(args, { env = {}, cwd } = {}) {
  const childEnv = { ...process.env };
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
      stdio: ["ignore", "pipe", "pipe"],
    });
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

// Writes `contents` to a config file in a fresh temp folder and returns its path.
export function writeTempConfig(t, contents) {
  const path = join(tempDir(t), "config.json");
  writeFileSync(path, contents);
  return path;
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
