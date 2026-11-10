import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createApp, layout, minimum } from "../src/tui/app.js";
import { center, createScreen, pad, paints, rowWidth, spread, terminal, truncate, width } from "../src/tui/screen.js";
import { runCli, screenTerminalEnv, terminalEnv, writeTempConfig } from "./helpers.js";

const root = fileURLToPath(new URL("..", import.meta.url));
// The text without its control sequences.
const plain = (text) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");

// A pretend terminal for createApp. `events` has, in order, everything that
// was written and every change of raw mode.
function fakeTerminal(columns = 60, rows = 15) {
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

// The terminal is back to normal, and the alternate screen was left (with the
// cursor shown) before raw mode went off.
function assertRestored({ input, events }) {
  const left = events.findIndex((event) => event.includes(terminal.leaveAlternateScreen));
  const rawOff = events.indexOf("raw off");
  assert.notEqual(left, -1, "the alternate screen wasn't left");
  assert.notEqual(rawOff, -1, "raw mode wasn't turned off");
  assert.ok(left < rawOff, "raw mode went off while the alternate screen was still showing");
  assert.ok(events[left].includes(terminal.showCursor), "the cursor wasn't shown again");
  assert.equal(input.isRaw, false);
  assert.ok(input.isPaused());
}

test("the UI starts on the alternate screen with the cursor hidden, and fills the terminal", async () => {
  const term = fakeTerminal(60, 15);
  const app = createApp({ ...term, folder: "my-project" });
  app.start();
  assert.ok(term.events[0].startsWith(terminal.enterAlternateScreen + terminal.hideCursor));
  assert.equal(term.input.isRaw, true);

  const rows = app.rows().map(plain);
  assert.equal(rows.length, 15);
  rows.forEach((row, index) => assert.equal(width(row), rowWidth(index, { columns: 60, rows: 15 }), `row ${index}`));
  assert.match(rows[0], /^ toolsmith ui +my-project $/);
  assert.match(rows[14], /^ q or Ctrl\+C: quit/);
  app.stop();
  await app.done;
});

for (const [label, key] of [
  ["q", "q"],
  ["Ctrl+C", "\x03"],
]) {
  test(`${label} ends the UI, leaving the alternate screen before turning raw mode off`, async () => {
    const term = fakeTerminal();
    const app = createApp(term);
    app.start();
    term.input.write(key);
    await app.done;
    assertRestored(term);
  });
}

test("a crash restores the terminal in the same order, and then reports the error", async () => {
  // While drawing the first frame, and while redrawing after a resize.
  for (const when of ["start", "resize"]) {
    const term = fakeTerminal();
    let frames = 0;
    const draw = (size, options) => {
      frames++;
      if (when === "start" || frames > 1) {
        throw new Error(`broken at ${when}`);
      }
      return layout(size, options);
    };
    const app = createApp({ ...term, draw });
    const done = app.start();
    if (when === "resize") {
      term.output.emit("resize");
    }
    await assert.rejects(done, { message: `broken at ${when}` });
    assertRestored(term);
  }
});

test("stopping twice restores the terminal once", async () => {
  const term = fakeTerminal();
  const app = createApp(term);
  app.start();
  app.stop();
  app.stop();
  await app.done;
  assert.equal(term.events.filter((event) => event === "raw off").length, 1);
});

test("a resize clears the screen and redraws it at the new size", async () => {
  const term = fakeTerminal(60, 15);
  const app = createApp(term);
  app.start();
  Object.assign(term.output, { columns: 80, rows: 20 });
  const before = term.events.length;
  term.output.emit("resize");
  assert.equal(term.events[before], terminal.clear);
  assert.equal(app.rows().length, 20);
  assert.equal(width(plain(app.rows()[0])), 80);
  app.stop();
  await app.done;
});

test(`below ${minimum.columns}x${minimum.rows} the UI says the terminal is too small, until it's bigger again`, async () => {
  const shows = (columns, rows) =>
    layout({ columns, rows }, { paint: paints(false), folder: "x" })
      .map(plain)
      .join("\n");
  assert.match(shows(39, 30), /Terminal too small *\n *39x30, needs at least 40x10 *\n *q: quit/);
  assert.match(shows(100, 9), /Terminal too small/);
  assert.doesNotMatch(shows(40, 10), /too small/);
  // However small, every row still fits.
  const tiny = layout({ columns: 5, rows: 2 }, { paint: paints(false), folder: "x" }).map(plain);
  assert.deepEqual(tiny.map(width), [5, 4]);

  const term = fakeTerminal(60, 15);
  const app = createApp(term);
  app.start();
  Object.assign(term.output, { columns: 30, rows: 8 });
  term.output.emit("resize");
  assert.ok(app.rows().map(plain).some((row) => row.includes("Terminal too small")));
  Object.assign(term.output, { columns: 60, rows: 15 });
  term.output.emit("resize");
  assert.match(plain(app.rows()[0]), /toolsmith ui/);
  app.stop();
  await app.done;
});

test("the screen uses only the 16 basic colors, and none when colors are off, staying readable with inverse", () => {
  // The SGR parameters in what's drawn, at a normal size and a too small one.
  const parameters = (color) =>
    [{ columns: 60, rows: 15 }, { columns: 20, rows: 5 }].flatMap((size) =>
      Array.from(layout(size, { paint: paints(color), folder: "x" }).join("").matchAll(/\x1b\[([0-9;]*)m/g), ([, list]) => list.split(";").map(Number)).flat(),
    );
  const isColor = (n) => (n >= 30 && n <= 37) || n === 39 || (n >= 90 && n <= 97);
  const isStyle = (n) => [1, 7, 22, 27].includes(n);

  const colored = parameters(true);
  assert.ok(colored.some(isColor));
  assert.deepEqual(colored.filter((n) => !isColor(n) && !isStyle(n)), [], "a code outside the 16 colors");
  const uncolored = parameters(false);
  assert.deepEqual(uncolored.filter(isColor), []);
  assert.ok(uncolored.includes(7), "without colors, the bars should still be inverse");
});

test("screen helpers fit text into a number of columns", () => {
  assert.equal(truncate("toolsmith", 5), "tool…");
  assert.equal(truncate("tool", 5), "tool");
  assert.equal(truncate("tool", 0), "");
  assert.equal(pad("ab", 4), "ab  ");
  assert.equal(pad("abcdef", 4), "abc…");
  assert.equal(center("ab", 6), "  ab  ");
  assert.equal(spread("left", "right", 12), "left   right");
  assert.equal(spread("a long left side", "right", 12), "a long…right");
  assert.equal(spread("left", "a wide right", 6), "a wid…");
  assert.equal(rowWidth(0, { columns: 10, rows: 3 }), 10);
  assert.equal(rowWidth(2, { columns: 10, rows: 3 }), 9);
});

test("wide characters count as one column each, a known limit", () => {
  // Most terminals show these two in four columns.
  assert.equal(width("日本"), 2);
  // An emoji is one character, even though JavaScript stores it in two units.
  assert.equal(width("😀"), 1);
  assert.equal(truncate("😀😀😀", 2), "😀…");
});

test("the screen writes only the rows that changed", () => {
  const writes = [];
  const screen = createScreen({ write: (text) => writes.push(text) });
  screen.draw(["aaa", "bbb", "cc"]);
  assert.deepEqual(writes, [`${terminal.moveTo(0)}aaa${terminal.moveTo(1)}bbb${terminal.moveTo(2)}cc`]);
  screen.draw(["aaa", "BBB", "cc"]);
  assert.equal(writes[1], `${terminal.moveTo(1)}BBB`);
  screen.draw(["aaa", "BBB", "cc"]);
  assert.equal(writes.length, 2);
  screen.clear();
  screen.draw(["aaa", "BBB", "cc"]);
  assert.deepEqual(writes.slice(2), [terminal.clear, `${terminal.moveTo(0)}aaa${terminal.moveTo(1)}BBB${terminal.moveTo(2)}cc`]);
});

// The relative files that `file` imports statically (import ... from, or
// export ... from), as absolute paths. import() isn't static, so it's left out.
function staticImports(file) {
  const text = readFileSync(file, "utf8");
  const patterns = [/^\s*import\s+(?:[\w*{}\s,$]+\s+from\s+)?["'](\.[^"']+)["']/gm, /^\s*export\s+(?:\*|\{[^}]*\})\s+from\s+["'](\.[^"']+)["']/gm];
  return patterns.flatMap((pattern) => Array.from(text.matchAll(pattern), ([, path]) => resolve(dirname(file), path)));
}

test("other commands don't load the UI's code: only toolsmith ui imports it, when it runs", () => {
  const reached = new Set();
  const visit = (file) => {
    if (!reached.has(file)) {
      reached.add(file);
      staticImports(file).forEach(visit);
    }
  };
  visit(join(root, "bin", "toolsmith.js"));
  const files = [...reached].map((file) => relative(root, file).split(sep).join("/"));
  assert.ok(files.includes("src/commands/ui.js"), "the walk didn't reach the ui command");
  assert.deepEqual(
    files.filter((file) => file.startsWith("src/tui/")),
    [],
  );
  assert.match(readFileSync(join(root, "src", "commands", "ui.js"), "utf8"), /await import\("\.\.\/tui\/app\.js"\)/);
});

test("without a terminal, toolsmith ui refuses to start and points to the plain commands", async () => {
  // Neither input nor output is a terminal; then only the output isn't.
  for (const env of [{}, terminalEnv]) {
    const { stdout, stderr, code } = await runCli(["ui"], { env });
    assert.equal(code, 1);
    assert.equal(stdout, "");
    assert.equal(
      stderr,
      "error: toolsmith ui needs a terminal for its input and output; in scripts and pipes, use the plain commands instead (toolsmith --help lists them)\n",
    );
  }
});

// Runs toolsmith in a pretend 60x15 terminal, typing `keys`.
const inTerminal = (args, env = {}, keys = "q") => runCli(args, { env: { ...screenTerminalEnv, ...env }, input: keys });

test("toolsmith ui draws its screen, and q restores the terminal: the normal screen before raw mode", async () => {
  for (const key of ["q", "\x03"]) {
    const { stdout, stderr, code } = await inTerminal(["ui"], {}, key);
    assert.equal(code, 0, stderr);
    assert.ok(stdout.startsWith(terminal.enterAlternateScreen + terminal.hideCursor));
    assert.match(plain(stdout), / toolsmith ui .*Commands +coming soon/s);
    const left = stdout.indexOf(terminal.showCursor + terminal.leaveAlternateScreen);
    assert.ok(left > 0, "the alternate screen wasn't left");
    assert.ok(stdout.endsWith(`${terminal.showCursor}${terminal.leaveAlternateScreen}<raw off>`), "raw mode went off at the wrong time");
  }
});

test('toolsmith ui has colors only when they\'re on: NO_COLOR, --no-color and "color": false turn them off', async (t) => {
  const cyan = "\x1b[36m";
  // TERM says the pretend terminal has colors on Linux and macOS too.
  const colors = { NO_COLOR: undefined, TERM: "xterm-256color" };
  const { stdout } = await inTerminal(["ui"], colors);
  assert.ok(stdout.includes(cyan), "no colors, though they're on");

  const off = {
    NO_COLOR: [["ui"], { ...colors, NO_COLOR: "1" }],
    "--no-color": [["--no-color", "ui"], colors],
    '"color": false': [["ui"], { ...colors, TOOLSMITH_CONFIG: writeTempConfig(t, '{ "color": false }') }],
  };
  for (const [label, [args, env]] of Object.entries(off)) {
    const result = await inTerminal(args, env);
    assert.equal(result.code, 0, result.stderr);
    assert.ok(!result.stdout.includes(cyan), `colors with ${label}`);
    assert.ok(result.stdout.includes("\x1b[7m"), `with ${label}, the bars should still be inverse`);
  }
});
