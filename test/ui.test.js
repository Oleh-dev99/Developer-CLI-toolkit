import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createProgram } from "../src/cli.js";
import { createApp } from "../src/tui/app.js";
import { describeCommands } from "../src/tui/commands.js";
import { createDashboard, minimum } from "../src/tui/dashboard.js";
import { box, center, createScreen, pad, paints, rowWidth, spread, terminal, truncate, truncateStart, width } from "../src/tui/screen.js";
import { fakeTerminal, loadedAtStart, pressKeys, runCli, screenTerminalEnv, stopWhenDone, tempDir, terminalEnv, writeTempConfig } from "./helpers.js";

// The terminal side of `toolsmith ui` (src/tui/app.js), the drawing helpers
// (src/tui/screen.js), and the command itself. ui-navigation.test.js has the
// keyboard navigation.

const root = fileURLToPath(new URL("..", import.meta.url));
// The text without its control sequences.
const plain = (text) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");

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

// A dashboard whose Files panel shows an empty temp folder, so that no test
// reads the repository; it stops when the test ends.
function dashboard(t, options = {}) {
  const view = createDashboard({ cwd: tempDir(t), editor: null, ...options });
  stopWhenDone(t, () => view.dispose());
  return view;
}

test("the UI starts on the alternate screen with the cursor hidden, and fills the terminal", async (t) => {
  const term = fakeTerminal(60, 15);
  const app = createApp({ ...term, view: dashboard(t, { folder: "my-project" }) });
  app.start();
  assert.ok(term.events[0].startsWith(terminal.enterAlternateScreen + terminal.hideCursor));
  assert.equal(term.input.isRaw, true);

  const rows = app.rows().map(plain);
  assert.equal(rows.length, 15);
  rows.forEach((row, index) => assert.equal(width(row), rowWidth(index, { columns: 60, rows: 15 }), `row ${index}`));
  assert.match(rows[0], /^ toolsmith ui +my-project $/);
  assert.match(rows[14], /^ \?: shortcuts {2}q: quit/);
  app.stop();
  await app.done;
});

for (const [label, key] of [
  ["q", "q"],
  ["Ctrl+C", "\x03"],
]) {
  test(`${label} ends the UI, leaving the alternate screen before turning raw mode off`, async (t) => {
    const term = fakeTerminal();
    const app = createApp({ ...term, view: dashboard(t) });
    app.start();
    term.input.write(key);
    await app.done;
    assertRestored(term);
  });
}

test("a crash restores the terminal in the same order, and then reports the error", async (t) => {
  // While drawing the first frame, while redrawing after a resize, while
  // handling a key, and while redrawing on its own (as when output arrives).
  for (const when of ["start", "resize", "key", "redraw"]) {
    const term = fakeTerminal();
    const real = dashboard(t);
    let frames = 0;
    let hooks;
    const view = {
      render(size, paint) {
        frames++;
        if (when === "start" || ((when === "resize" || when === "redraw") && frames > 1)) {
          throw new Error(`broken at ${when}`);
        }
        return real.render(size, paint);
      },
      key() {
        throw new Error("broken at key");
      },
      connect(given) {
        hooks = given;
      },
    };
    const app = createApp({ ...term, view });
    const rejected = assert.rejects(app.start(), { message: `broken at ${when}` });
    if (when === "resize") {
      term.output.emit("resize");
    } else if (when === "key") {
      await pressKeys(term, "j");
    } else if (when === "redraw") {
      hooks.redraw();
    }
    await rejected;
    assertRestored(term);
    // From the crash on, the terminal only gets put back: nothing is drawn
    // after the normal screen is back, or after raw mode is off.
    const left = term.events.findIndex((event) => event.includes(terminal.leaveAlternateScreen));
    assert.deepEqual(term.events.slice(left), [terminal.showCursor + terminal.leaveAlternateScreen, "raw off"], `after a crash at ${when}`);
  }
});

test("toolsmith ui restores the terminal when something throws where nothing catches it, then reports the error", async (t) => {
  // An error thrown in a timer, and a promise rejected with no handler, a
  // moment after the first frame (see fixtures/crash.mjs).
  const crash = new URL("fixtures/crash.mjs", import.meta.url).href;
  for (const [kind, message] of [
    ["exception", "a bug in a timer"],
    ["rejection", "a promise nobody handled"],
  ]) {
    const env = { NODE_OPTIONS: `${screenTerminalEnv.NODE_OPTIONS} --import "${crash}"`, TOOLSMITH_TEST_CRASH: kind };
    const { stdout, stderr, code } = await runCli(["ui"], { env, input: "", cwd: tempDir(t) });
    assert.equal(code, 1, `after a ${kind}`);
    assert.equal(stderr, `error: ${message}\n`);
    assert.match(plain(stdout), / toolsmith ui .* Commands /s, "the first frame wasn't drawn");
    // The normal screen with the cursor, then raw mode off, and nothing after.
    assert.ok(stdout.endsWith(`${terminal.showCursor}${terminal.leaveAlternateScreen}<raw off>`), `the terminal wasn't restored in order after a ${kind}`);
  }
});

test("resizing: larger, smaller, below 40x10 and back, each size cleared and drawn in full, with the selection kept", async (t) => {
  const term = fakeTerminal(60, 15);
  const app = createApp({ ...term, view: dashboard(t, { folder: "my-project", commands: describeCommands(createProgram()) }) });
  app.start();
  // The fourth command, git clean-branches.
  await pressKeys(term, "j", "j", "j");
  for (const [columns, rows] of [
    [100, 30],
    [50, 12],
    [40, 10],
    [39, 10],
    [40, 9],
    [20, 5],
    [80, 24],
  ]) {
    Object.assign(term.output, { columns, rows });
    const before = term.events.length;
    term.output.emit("resize");
    // Cleared, then every row drawn, each as wide as the terminal.
    const [cleared, drawn, ...more] = term.events.slice(before);
    assert.equal(cleared, terminal.clear, `${columns}x${rows}`);
    assert.deepEqual(more, []);
    for (let row = 0; row < rows; row++) {
      assert.ok(drawn.includes(terminal.moveTo(row)), `${columns}x${rows}: row ${row} wasn't drawn`);
    }
    const screen = app.rows().map(plain);
    assert.equal(screen.length, rows);
    screen.forEach((text, row) => assert.equal(width(text), rowWidth(row, { columns, rows }), `${columns}x${rows}: row ${row}`));
    if (columns < minimum.columns || rows < minimum.rows) {
      assert.ok(screen.some((text) => text.includes("Terminal too small")), `${columns}x${rows} isn't too small`);
    } else {
      assert.match(screen[0], /^ toolsmith ui +my-project $/);
      // Cut short in a narrow panel.
      assert.ok(
        screen.some((text) => text.startsWith("> git clean-branc")),
        `${columns}x${rows}: the selection moved`,
      );
    }
  }
  app.stop();
  await app.done;
});

test("too small, the screen says so in the middle, with the size it needs; q still quits, and restores the terminal", async (t) => {
  const term = fakeTerminal(39, 9);
  const app = createApp({ ...term, view: dashboard(t) });
  app.start();
  assert.deepEqual(
    app.rows().map((row) => plain(row).trimEnd()),
    ["", "", "", "          Terminal too small", "      39x9, needs at least 40x10", "                q: quit", "", "", ""],
  );
  // The first line is the warning, colored when colors are on.
  const colored = createApp({ ...fakeTerminal(39, 9), color: true, view: dashboard(t) });
  colored.start();
  assert.ok(colored.rows()[3].startsWith("\x1b[33m"));
  colored.stop();
  await colored.done;

  term.input.write("q");
  await app.done;
  assertRestored(term);
});

test("stopping twice restores the terminal once", async (t) => {
  const term = fakeTerminal();
  const app = createApp({ ...term, view: dashboard(t) });
  app.start();
  app.stop();
  app.stop();
  await app.done;
  assert.equal(term.events.filter((event) => event === "raw off").length, 1);
});

test(`below ${minimum.columns}x${minimum.rows} the UI says the terminal is too small, until it's bigger again`, async (t) => {
  const view = dashboard(t);
  const shows = (columns, rows) =>
    view
      .render({ columns, rows }, paints(false))
      .map(plain)
      .join("\n");
  assert.match(shows(39, 30), /Terminal too small *\n *39x30, needs at least 40x10 *\n *q: quit/);
  assert.match(shows(100, 9), /Terminal too small/);
  assert.doesNotMatch(shows(40, 10), /too small/);
  // However small, every row still fits.
  const tiny = view.render({ columns: 5, rows: 2 }, paints(false)).map(plain);
  assert.deepEqual(tiny.map(width), [5, 4]);

  const term = fakeTerminal(60, 15);
  const app = createApp({ ...term, view: dashboard(t) });
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

test("every screen uses only the 16 basic colors, never magenta, and none when colors are off", (t) => {
  // Each state the dashboard can be in, at a normal size and a too small one:
  // the panels, the Files panel, a filter, a command's form and its message
  // (rename needs values), the rename preview's form, and the overlay.
  // ui-commands.test.js checks a command's output, ui-files.test.js a preview.
  const commands = describeCommands(createProgram()).filter((command) => command.name === "rename");
  const states = [[], ["nextPanel"], ["startFilter"], ["open"], ["open", "runCommand"], ["nextPanel", "renamePreview"], ["showHelp"]];
  const parameters = (color) =>
    states.flatMap((actions) =>
      [
        { columns: 60, rows: 15 },
        { columns: 20, rows: 5 },
      ].flatMap((size) => {
        const view = dashboard(t, { folder: "x", commands });
        for (const action of actions) {
          view.actions[action]();
        }
        const text = view.render(size, paints(color)).join("");
        return Array.from(text.matchAll(/\x1b\[([0-9;]*)m/g), ([, list]) => list.split(";").map(Number)).flat();
      }),
    );
  const isColor = (n) => (n >= 30 && n <= 37) || n === 39 || (n >= 90 && n <= 97);
  const isStyle = (n) => [1, 7, 22, 27].includes(n);
  const isMagenta = (n) => [35, 45, 95, 105].includes(n);

  const colored = parameters(true);
  assert.ok(colored.some(isColor));
  assert.deepEqual(colored.filter((n) => !isColor(n) && !isStyle(n)), [], "a code outside the 16 colors");
  assert.deepEqual(colored.filter(isMagenta), [], "magenta");
  const uncolored = parameters(false);
  assert.deepEqual(uncolored.filter(isColor), []);
  assert.ok(uncolored.includes(7), "without colors, the bars should still be inverse");
});

test("screen helpers fit text into a number of columns", () => {
  assert.equal(truncate("toolsmith", 5), "tool…");
  assert.equal(truncate("tool", 5), "tool");
  assert.equal(truncate("tool", 0), "");
  assert.equal(truncateStart("toolsmith", 5), "…mith");
  assert.equal(truncateStart("tool", 5), "tool");
  assert.equal(pad("ab", 4), "ab  ");
  assert.equal(pad("abcdef", 4), "abc…");
  assert.equal(center("ab", 6), "  ab  ");
  assert.equal(spread("left", "right", 12), "left   right");
  assert.equal(spread("a long left side", "right", 12), "a long…right");
  assert.equal(spread("left", "a wide right", 6), "a wid…");
  assert.equal(rowWidth(0, { columns: 10, rows: 3 }), 10);
  assert.equal(rowWidth(2, { columns: 10, rows: 3 }), 9);
  assert.deepEqual(box(["abcde", "fghij"], 7, { title: "T", note: "a long note" }), ["┌ T ──┐", "│abcde│", "│fghij│", "└ a l…┘"]);
  assert.deepEqual(box([], 6), ["┌────┐", "└────┘"]);
});

test("wide characters take two columns, as terminals show them, and fit when cut and padded", () => {
  const cases = [
    ["日本語", 6], // Chinese and Japanese characters
    ["한국어", 6], // Hangul
    ["Ａｂ", 4], // fullwidth letters
    ["ｶﾀｶﾅ", 4], // halfwidth katakana is one column
    ["😀", 2], // an emoji
    ["👨‍👩‍👧", 2], // a family: three emoji joined into one
    ["🇯🇵", 2], // a flag
    ["❤️", 2], // a symbol turned into an emoji
    ["❤", 1], // the same symbol as text
    ["é", 1], // e and a combining accent
    ["a​b", 2], // a zero-width space
  ];
  for (const [text, columns] of cases) {
    assert.equal(width(text), columns, text);
  }
  // A two-column character that doesn't fit is left out whole.
  assert.equal(truncate("日本語テキスト", 5), "日本…");
  assert.equal(truncate("日本語テキスト", 6), "日本…");
  assert.equal(truncateStart("日本語テキスト", 5), "…スト");
  assert.equal(truncate("😀😀😀", 4), "😀…");
  assert.equal(truncate("👨‍👩‍👧 family", 3), "👨‍👩‍👧…");
  for (const [text, columns] of [
    ["日本", 5],
    ["日本語テキスト", 5],
    ["😀 ok", 6],
    ["a日b", 3],
  ]) {
    assert.equal(width(pad(text, columns)), columns, `pad(${text}, ${columns})`);
    assert.equal(width(center(text, columns)), columns, `center(${text}, ${columns})`);
    assert.equal(width(spread(text, "1 KB", columns + 5)), columns + 5, `spread(${text})`);
  }
  assert.equal(pad("日本", 5), "日本 ");
  assert.equal(center("日本", 6), " 日本 ");
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

test("other commands don't load the UI's code: only toolsmith ui imports it, when it runs", () => {
  const files = loadedAtStart();
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
    assert.match(plain(stdout), / toolsmith ui .* Commands .*> config/s);
    assert.ok(stdout.endsWith(`${terminal.showCursor}${terminal.leaveAlternateScreen}<raw off>`), "raw mode went off at the wrong time");
  }
});

test("toolsmith ui answers keys typed in the terminal", async () => {
  // Down three times, then quit: the last frame has the fourth command selected.
  const { stdout, code } = await inTerminal(["ui"], {}, "jjjq");
  assert.equal(code, 0);
  assert.match(plain(stdout), /> git clean-branc/);
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
