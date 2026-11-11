import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { terminal } from "../src/tui/screen.js";
import { makeTree, tempDir } from "./helpers.js";

// toolsmith ui in a real terminal: a pseudo-terminal opened by the system's
// `script` command, from util-linux on Linux and from BSD on macOS. The other
// UI tests pretend to be a terminal; this one checks what only a real one
// does: raw mode, keys as the terminal driver passes them on, the window size,
// and the terminal's settings after toolsmith ends, which must be exactly as
// they were.

const bin = fileURLToPath(new URL("../bin/toolsmith.js", import.meta.url));
const plain = (text) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// What runs in the pseudo-terminal. `script` makes it 0x0 when its own input
// isn't a terminal, so it's given a size first. After toolsmith ends, it says
// how toolsmith ended and whether the terminal's settings (stty -g) are as they
// were before, and lists them (stty -a).
const inside = `stty rows 24 columns 80
before=$(stty -g)
"$TOOLSMITH_TEST_NODE" "$TOOLSMITH_TEST_BIN" ui
code=$?
after=$(stty -g)
if [ "$before" = "$after" ]; then restored=yes; else restored=no; fi
echo "[after toolsmith] exit=$code restored=$restored"
stty -a
exit $code
`;

// How to run `inside` with script: util-linux's needs -e to exit with its
// exit code; BSD's always does.
const scriptArgs = process.platform === "linux" ? ["-q", "-e", "-c", inside, "/dev/null"] : ["-q", "/dev/null", "sh", "-c", inside];

const windows =
  process.platform === "win32" &&
  "Windows has no script command: a test can only open a real Windows console (ConPTY) through a native module like node-pty, a new dependency. docs/TERMINALS.md lists what to check by hand in Windows Terminal.";

test("in a real terminal, toolsmith ui answers keys, q alone quits with exit code 0, and the terminal's settings are as they were", { skip: windows, timeout: 90000 }, async (t) => {
  const cwd = makeTree(t, { "README.md": "# Project\n", "src/app.js": "a".repeat(1000) });
  const env = {
    ...process.env,
    TOOLSMITH_TEST_NODE: process.execPath,
    TOOLSMITH_TEST_BIN: bin,
    TOOLSMITH_CONFIG: join(tempDir(t), "none.json"),
    npm_config_prefix: join(tempDir(t), "prefix"),
    NO_COLOR: "1",
    TERM: "xterm-256color",
    // util-linux's script runs the command with $SHELL -c.
    SHELL: "/bin/sh",
  };
  delete env.FORCE_COLOR;
  // The keys go in through cat: macOS's script asks its input for terminal
  // settings, and the socket that Node.js gives a child for its input answers
  // with an error that script stops at (EOPNOTSUPP), where a pipe says it's
  // not a terminal (ENOTTY). It runs in a process group of its own, so that
  // it can all be stopped if the test fails.
  const child = spawn("sh", ["-c", 'cat | script "$@"', "sh", ...scriptArgs], { cwd, env, detached: true });
  let output = "";
  let errors = "";
  let ended = null;
  child.stdout.setEncoding("utf8").on("data", (chunk) => (output += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk) => (errors += chunk));
  child.stdin.on("error", () => {});
  const exited = new Promise((resolve) => child.on("close", (code, signal) => resolve((ended = { code, signal }))));
  const stop = () => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // It has just ended.
    }
  };
  t.after(() => {
    if (!ended) {
      stop();
    }
  });

  // The end of what the terminal showed, a line for each row drawn.
  const shown = () => `the terminal showed:\n${plain(output.replace(/\x1b\[\d+;\d+H/g, "\n")).slice(-3000)}\nstderr: ${errors}`;
  const waitFor = async (pattern, what) => {
    for (const start = Date.now(); !pattern.test(plain(output)); await sleep(25)) {
      if (ended) {
        assert.fail(`script ended (${JSON.stringify(ended)}) before ${what}; ${shown()}`);
      }
      if (Date.now() - start > 30000) {
        assert.fail(`timed out waiting for ${what}; ${shown()}`);
      }
    }
  };

  // The whole first frame, up to its last row, the hints. It can come in
  // pieces: the frame is about 2 KB, and macOS's script passes output on 1 KB
  // at a time (BUFSIZ), so its first rows can be here before its last ones.
  await waitFor(/ toolsmith ui [\s\S]* Commands [\s\S]*\?: shortcuts {2}q: quit/, "the whole first frame");
  // At the size stty gave the terminal: the hints on row 24, and nothing below.
  assert.match(output, new RegExp(`${escape(terminal.moveTo(23))}(?:\\x1b\\[[0-9;]*m)* \\?: shortcuts`), `the hints aren't on row 24; ${shown()}`);
  assert.ok(!output.includes(terminal.moveTo(24)), `a row below row 24 was drawn; ${shown()}`);
  // Down twice, as the terminal sends it: the third command is selected.
  child.stdin.write("\x1b[B");
  child.stdin.write("\x1b[B");
  await waitFor(/> git clean-branc/, "the third command to be selected");
  child.stdin.write("?");
  await waitFor(/Shortcuts/, "the shortcuts overlay");
  // q alone ends toolsmith: the keys' pipe, and so the terminal, stays open
  // until it has ended.
  child.stdin.write("q");
  await waitFor(/\[after toolsmith\] exit=/, "toolsmith to end after q, with its terminal still open");
  child.stdin.end();
  const timer = setTimeout(stop, 30000);
  const { code, signal } = await exited;
  clearTimeout(timer);

  assert.equal(signal, null, `script was stopped; ${shown()}`);
  assert.equal(/\[after toolsmith\][^\r\n]*/.exec(output)?.[0], "[after toolsmith] exit=0 restored=yes", shown());
  assert.equal(code, 0, shown());
  // toolsmith's last words: the cursor shown and the normal screen back,
  // after the last time it entered the alternate screen.
  const ui = output.slice(0, output.indexOf("[after toolsmith]"));
  assert.ok(ui.lastIndexOf(terminal.showCursor + terminal.leaveAlternateScreen) > ui.lastIndexOf(terminal.enterAlternateScreen), `the alternate screen wasn't left; ${shown()}`);
  // Raw mode is off: lines are read whole again, and typing shows.
  const settings = output.slice(output.indexOf("[after toolsmith]"));
  assert.ok(/(^|\s)icanon(\s|$)/m.test(settings), `raw mode is still on (no icanon): ${settings}`);
  assert.ok(/(^|\s)echo(\s|$)/m.test(settings), `typing doesn't show (no echo): ${settings}`);
});
