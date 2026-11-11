import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitKeypressEvents } from "node:readline";
import { PassThrough } from "node:stream";
import { after, test } from "node:test";
import { createProgram } from "../src/cli.js";
import { createApp } from "../src/tui/app.js";
import { describeCommands } from "../src/tui/commands.js";
import { createDashboard } from "../src/tui/dashboard.js";
import { hintsFor, keyOf, sections, shortcutLabel } from "../src/tui/keys.js";
import { createList } from "../src/tui/list.js";
import { paints } from "../src/tui/screen.js";
import { fakeTerminal, pressKeys, stopWhenDone, tempDir } from "./helpers.js";

// Keyboard navigation in `toolsmith ui`: the key table (src/tui/keys.js), the
// list component (src/tui/list.js) and the dashboard (src/tui/dashboard.js),
// driven with the codes terminals send, at a fixed size of 40x10. The folder
// isn't a git repository, so there's no Git status panel (see
// ui-git.test.js for that one).

const plain = (text) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
const key = {
  up: "\x1b[A",
  down: "\x1b[B",
  left: "\x1b[D",
  right: "\x1b[C",
  home: "\x1b[H",
  end: "\x1b[F",
  pageUp: "\x1b[5~",
  pageDown: "\x1b[6~",
  tab: "\t",
  shiftTab: "\x1b[Z",
  enter: "\r",
  escape: "\x1b",
  backspace: "\x7f",
  ctrlC: "\x03",
};

// The built-in commands, as the Commands panel lists them.
const commands = describeCommands(createProgram());

// The folder the Files panel shows: 24 files, file01.txt to file24.txt.
const folder = mkdtempSync(join(tmpdir(), "toolsmith-test-"));
for (let number = 1; number <= 24; number++) {
  writeFileSync(join(folder, `file${String(number).padStart(2, "0")}.txt`), "x".repeat(number));
}
after(() => rmSync(folder, { recursive: true, force: true, maxRetries: 10 }));

// The UI in a pretend terminal, with keys to press and the screen as text,
// once the Files panel shows `shows`: when it has read its folder. It's
// stopped when the test `t` ends, if end() wasn't reached.
async function session(t, columns = 40, rows = 10, { cwd = folder, shows = "file01.txt" } = {}) {
  const term = fakeTerminal(columns, rows);
  const view = createDashboard({ folder: "my-project", commands, cwd, editor: null });
  const app = createApp({ ...term, view });
  app.start();
  stopWhenDone(t, () => app.stop());
  // Until the files are read and on screen; a redraw comes a moment later.
  while (!app.rows().some((row) => row.includes(shows))) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return {
    app,
    view,
    press: (...keys) => pressKeys(term, ...keys),
    screen: () => app.rows().map(plain),
    raw: () => app.rows(),
    end: async () => {
      app.stop();
      await app.done;
    },
  };
}

test("scripted key presses at 40x10: panels, End, a filter, a command's form, and back", async (t) => {
  const ui = await session(t);
  // Outside a git repository, the two panels share the width.
  assert.deepEqual(ui.screen(), [
    " toolsmith ui                my-project ",
    " Commands     1/15 │ Files         1/24 ",
    "> config           │>   file01.txt   1 B",
    "  dupes            │    file02.txt   2 B",
    "  git clean-branch…│    file03.txt   3 B",
    "  git recent       │    file04.txt   4 B",
    "  git template list│    file05.txt   5 B",
    "  git template show│    file06.txt   6 B",
    "  git template use │    file07.txt   7 B",
    " ?: shortcuts  q: quit  /: filter  Ent…",
  ]);

  // Tab to Files, End: the list scrolls to keep the last file in view.
  await ui.press(key.tab, key.end);
  assert.deepEqual(ui.screen().slice(1, 9), [
    " Commands     1/15 │ Files        24/24 ",
    "> config           │    file18.txt  18 B",
    "  dupes            │    file19.txt  19 B",
    "  git clean-branch…│    file20.txt  20 B",
    "  git recent       │    file21.txt  21 B",
    "  git template list│    file22.txt  22 B",
    "  git template show│    file23.txt  23 B",
    "  git template use │>   file24.txt  24 B",
  ]);

  // Back to Commands, and filter it.
  await ui.press(key.shiftTab, "/", "g", "i", "t");
  assert.deepEqual(ui.screen(), [
    " toolsmith ui                my-project ",
    " Commands /git_    │ Files        24/24 ",
    "> git clean-branch…│    file18.txt  18 B",
    "  git recent       │    file19.txt  19 B",
    "  git template list│    file20.txt  20 B",
    "  git template show│    file21.txt  21 B",
    "  git template use │    file22.txt  22 B",
    "  git template uns…│    file23.txt  23 B",
    "                   │>   file24.txt  24 B",
    " Enter: done  Esc: clear  Backspace: d…",
  ]);

  // Enter keeps the filter; Down and Enter open the second match's form.
  await ui.press(key.enter, key.down, key.enter);
  assert.deepEqual(ui.screen(), [
    " toolsmith ui                my-project ",
    " toolsmith git recent  summarize recent…",
    "> --since <date>   _                    ",
    "  --until <date>                        ",
    "  --from <ref>                          ",
    "  --author <name>                       ",
    "                                        ",
    ' only commits after this, like "1 week …',
    " $ toolsmith git recent                 ",
    " Enter: run  Esc: back  Space: tick  D…",
  ]);

  // Esc goes back, with the filter still on; Esc again clears it.
  await ui.press(key.escape);
  assert.equal(ui.screen()[1], " Commands /git 2/6 │ Files        24/24 ");
  await ui.press(key.escape);
  assert.equal(ui.screen()[1], " Commands     4/15 │ Files        24/24 ");
  // The selection stays on the command that was opened.
  assert.equal(ui.screen()[5], "> git recent       │    file21.txt  21 B");
  await ui.end();
});

// The lines in the shortcuts overlay: each section's title and shortcuts, with
// a blank line between sections.
const overlayLines = sections.reduce((lines, section) => lines + section.shortcuts.length + 1, sections.length - 1);

test("the shortcuts overlay lists the key table, scrolls, and closes with Esc or ?", async (t) => {
  const ui = await session(t);
  await ui.press("?");
  assert.deepEqual(ui.screen(), [
    " toolsmith ui                my-project ",
    "┌ Shortcuts ───────────────────────────┐",
    "│ Commands panel                       │",
    "│   Up, k               move up        │",
    "│   Down, j             move down      │",
    "│   PgUp                move up a page │",
    "│   PgDn                move down a p… │",
    "│   Home                go to the fir… │",
    `└ 1-6/${overlayLines} ${"─".repeat(36 - `1-6/${overlayLines}`.length)}┘`,
    " Esc: close  Down: scroll              ",
  ]);
  await ui.press("j", key.down);
  assert.match(ui.screen()[8], new RegExp(`^└ 3-8/${overlayLines} `));
  await ui.press(...Array.from({ length: 30 }, () => key.pageDown));
  assert.match(ui.screen()[8], new RegExp(`^└ ${overlayLines - 5}-${overlayLines}/${overlayLines} `));
  await ui.press(key.escape);
  assert.match(ui.screen()[1], /Commands/);
  await ui.press("?", "?");
  assert.match(ui.screen()[1], /Commands/);
  await ui.end();
});

test("every shortcut in the key table is in the overlay, and the hints at the bottom come from it", async (t) => {
  // Tall enough for the whole overlay.
  const ui = await session(t, 120, overlayLines + 6);
  await ui.press("?");
  const overlay = ui.screen().join("\n");
  assert.match(overlay, new RegExp(`└ 1-${overlayLines}/${overlayLines} `));
  for (const shortcut of sections.flatMap((section) => section.shortcuts)) {
    assert.match(overlay, new RegExp(`│ +${escape(shortcutLabel(shortcut))} +${escape(shortcut.description)} +│`), shortcutLabel(shortcut));
  }
  for (const section of sections) {
    assert.match(overlay, new RegExp(`│ ${escape(section.title)} +│`));
  }
  const footer = () => ui.screen().at(-1).trim();
  assert.equal(footer(), hintsFor("help"));
  await ui.press(key.escape);
  assert.equal(footer(), hintsFor("panels"));
  await ui.press("/");
  assert.equal(footer(), hintsFor("filter"));
  await ui.press(key.escape, key.enter);
  assert.equal(footer(), hintsFor("form"));
  await ui.press(key.escape, key.tab);
  assert.equal(footer(), hintsFor("files"));
  await ui.press(key.enter);
  assert.equal(ui.view.context(), "preview");
  assert.equal(footer(), hintsFor("preview"));
  await ui.end();
});

function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("the key table and the handlers can't drift apart", () => {
  const view = createDashboard({ cwd: folder, editor: null });
  view.dispose();
  const inTable = new Set(sections.flatMap((section) => section.shortcuts.map((shortcut) => shortcut.action)));
  // Typing into the filter isn't a handler: every character that isn't a key in
  // the table is typed.
  inTable.delete("type");
  assert.deepEqual([...inTable].sort(), Object.keys(view.actions).sort());
  for (const section of sections) {
    const keys = section.shortcuts.flatMap((shortcut) => shortcut.keys);
    assert.equal(new Set(keys).size, keys.length, `a key is used twice in ${section.context}`);
    for (const action of section.hints) {
      assert.ok(
        section.shortcuts.some((shortcut) => shortcut.action === action),
        `hint ${action} isn't in ${section.context}`,
      );
    }
  }
  // Every context the dashboard can be in has its shortcuts.
  assert.deepEqual(sections.map((section) => section.context).sort(), [
    "dryrun",
    "files",
    "filter",
    "form",
    "git",
    "help",
    "output",
    "panels",
    "preview",
    "running",
  ]);
  // Ctrl+C cancels a running command, and quits everywhere else. q quits too,
  // except where it's typed, and while a command runs.
  for (const section of sections) {
    const ctrlC = section.shortcuts.find((shortcut) => shortcut.keys.includes("ctrl+c"));
    assert.equal(ctrlC?.action, section.context === "running" ? "cancelCommand" : "quit", section.context);
    const q = section.shortcuts.find((shortcut) => shortcut.keys.includes("q"));
    assert.equal(q?.action, ["filter", "form", "running"].includes(section.context) ? undefined : "quit", section.context);
  }
});

// The codes terminals send for each key. The first ones are what Windows
// Terminal, macOS Terminal, Linux terminals and the classic Windows console
// with Node.js 26 send. The others come from the classic console with Node.js
// 22 (Home ESC [1~, End ESC [4~, Backspace Ctrl+H), from terminals whose
// arrow keys are in "application" mode (ESC O A), and from rxvt (ESC [7~).
const codes = {
  up: ["\x1b[A", "\x1bOA"],
  down: ["\x1b[B", "\x1bOB"],
  left: ["\x1b[D", "\x1bOD"],
  right: ["\x1b[C", "\x1bOC"],
  home: ["\x1b[H", "\x1bOH", "\x1b[1~", "\x1b[7~"],
  end: ["\x1b[F", "\x1bOF", "\x1b[4~", "\x1b[8~"],
  pageup: ["\x1b[5~"],
  pagedown: ["\x1b[6~"],
  tab: ["\t"],
  "shift+tab": ["\x1b[Z"],
  enter: ["\r", "\n"],
  backspace: ["\x7f", "\b"],
  escape: ["\x1b"],
  "ctrl+c": ["\x03"],
  "/": ["/"],
  "?": ["?"],
  k: ["k"],
  Q: ["Q"],
  R: ["R"],
  space: [" "],
  f5: ["\x1b[15~"],
};

// The key names that readline and keyOf() make of `sequence`.
async function decode(sequence) {
  const input = new PassThrough();
  const names = [];
  emitKeypressEvents(input, { escapeCodeTimeout: 10 });
  input.on("keypress", (text, info) => names.push(keyOf(text, info)));
  input.write(sequence);
  await new Promise((resolve) => setTimeout(resolve, 40));
  return names;
}

test("the codes different terminals send for a key all mean the same key", async () => {
  for (const [name, sequences] of Object.entries(codes)) {
    for (const sequence of sequences) {
      assert.deepEqual(await decode(sequence), [name], `${JSON.stringify(sequence)} should be ${name}`);
    }
  }
  // Alt with a letter isn't a shortcut.
  assert.deepEqual(await decode("\x1bq"), [null]);
});

test("the classic Windows console's codes with Node.js 22 move around like the others", async (t) => {
  const ui = await session(t);
  await ui.press("\t", "\x1b[4~");
  assert.match(ui.screen()[8], /> +file24\.txt/);
  await ui.press("\x1b[1~");
  assert.match(ui.screen()[2], /> +file01\.txt/);
  await ui.press("/", "x", "\b");
  assert.match(ui.screen()[1], /Files \/_/);
  await ui.end();
});

test("arrow keys and h, j, k, l move, and the panels wrap around", async (t) => {
  const ui = await session(t);
  const selected = () => ui.screen().find((row) => row.startsWith(">"));
  await ui.press("j", "j", key.down);
  assert.match(selected(), /^> git recent/);
  await ui.press("k", key.up);
  assert.match(selected(), /^> dupes/);

  const focusedTitle = () => {
    const header = ui.raw()[1].split("│");
    return plain(header.find((part) => part.startsWith("\x1b[7m"))).trim();
  };
  assert.ok(focusedTitle().startsWith("Commands"), focusedTitle());
  // In the Files panel, Left and Right close and open folders, so Tab and
  // Shift+Tab go on from there.
  for (const [press, title] of [
    ["l", "Files"],
    [key.tab, "Commands"],
    [key.right, "Files"],
    [key.shiftTab, "Commands"],
    ["h", "Files"],
    [key.shiftTab, "Commands"],
    [key.left, "Files"],
  ]) {
    await ui.press(press);
    assert.ok(focusedTitle().startsWith(title), `after ${JSON.stringify(press)}: ${focusedTitle()}`);
  }
  await ui.end();
});

test("PgDn and PgUp move a page, and the selection stays in view", async (t) => {
  const ui = await session(t);
  await ui.press(key.tab, key.pageDown);
  // Seven rows of files are in view; a page is one less, so one stays.
  assert.match(ui.screen()[8], /> +file07\.txt/);
  await ui.press(key.pageDown);
  assert.match(ui.screen()[8], /> +file13\.txt/);
  assert.match(ui.screen()[2], /file07\.txt/);
  await ui.press(key.pageUp);
  assert.match(ui.screen()[2], /> +file07\.txt/);
  await ui.end();
});

test("the focused panel stands out without colors: an inverse header and selection", async (t) => {
  const ui = await session(t, 60, 12);
  await ui.press(key.tab);
  const [, header, firstRow] = ui.raw();
  const parts = header.split("│");
  assert.deepEqual(
    parts.map((part) => part.startsWith("\x1b[7m")),
    [false, true],
  );
  const cells = firstRow.split("│");
  assert.ok(cells[1].startsWith("\x1b[7m>   file01.txt"), JSON.stringify(cells[1]));
  assert.ok(cells[0].startsWith("> config") && !cells[0].includes("\x1b[7m"));
  await ui.end();
});

test("/ filters as you type: any case, Backspace edits, Esc clears, and keys like q are typed", async (t) => {
  // Wide enough for the filter and the position in the header.
  const ui = await session(t, 80, 12);
  await ui.press("/", "G", "I", "T", " ", "R");
  assert.match(ui.screen()[1], /^ Commands \/GIT R_ +1\/1 │/);
  assert.match(ui.screen()[2], /^> git recent/);
  // Backspace widens the filter again; the selection stays on "git recent".
  await ui.press(key.backspace, key.backspace);
  assert.match(ui.screen()[1], /^ Commands \/GIT_ +2\/6 │/);
  // q and ? are typed, not quit or help.
  await ui.press("q", "?");
  assert.match(ui.screen()[1], /^ Commands \/GITq\?_ /);
  assert.match(ui.screen()[2], /No match for "GITq\?"/);
  await ui.press(key.escape);
  assert.match(ui.screen()[1], new RegExp(`^ Commands +1/${commands.length} │`));
  assert.match(ui.screen()[11], /^ \?: shortcuts/);

  // Tab while typing keeps the filter on the list it was typed for.
  await ui.press("/", "s", "i", "z", key.tab);
  assert.match(ui.screen()[1], /^ Commands \/siz +1\/1 │ Files/);
  assert.match(ui.screen()[2], /^> size/);
  await ui.end();
});

test("an empty panel says so, and Enter there opens nothing", async (t) => {
  const ui = await session(t, 60, 12, { cwd: tempDir(t), shows: "Empty folder" });
  await ui.press(key.tab);
  assert.match(ui.screen()[2], /│ {2}Empty folder +$/);
  await ui.press(key.enter, key.right);
  assert.equal(ui.view.context(), "files");
  assert.match(ui.screen()[2], /│ {2}Empty folder +$/);
  await ui.end();
});

test("Ctrl+C quits from the panels, a filter, a form, the files, a preview and the overlay, and q where it isn't typed", async (t) => {
  const setups = { panels: [], filter: ["/"], form: [key.enter], files: [key.tab], preview: [key.tab, key.enter], help: ["?"] };
  for (const [context, keys] of Object.entries(setups)) {
    for (const quit of [key.ctrlC, "q"]) {
      const ui = await session(t);
      await ui.press(...keys);
      assert.equal(ui.view.context(), context);
      await ui.press(quit);
      const ended = await Promise.race([ui.app.done.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 50))]);
      assert.equal(ended, quit === key.ctrlC || !["filter", "form"].includes(context), `${JSON.stringify(quit)} in ${context}`);
      await ui.end();
    }
  }
});

test("a list keeps its selection in view, filters in any case, and says when it's empty", () => {
  const paint = { bar: (text) => `[${text}]` };
  const list = createList(["alpha", "Beta", "gamma", "delta", "epsilon"], { empty: "No items" });
  assert.deepEqual(list.render(9, 3, { focused: true, paint }), ["[> alpha  ]", "  Beta   ", "  gamma  "]);
  list.move(3);
  assert.deepEqual(list.render(9, 3, { focused: true, paint }), ["  Beta   ", "  gamma  ", "[> delta  ]"]);
  assert.equal(list.position(), "4/5");
  // Unfocused, the selection is only marked.
  assert.deepEqual(list.render(9, 3), ["  Beta   ", "  gamma  ", "> delta  "]);
  list.last();
  assert.equal(list.selected(), "epsilon");
  list.first();
  assert.equal(list.selected(), "alpha");

  // The selection stays on its item when it still matches.
  list.move(1);
  list.setFilter("BET");
  assert.deepEqual(list.render(9, 2, { paint }), ["> Beta   ", "         "]);
  list.setFilter("ta");
  assert.equal(list.selected(), "Beta");
  assert.equal(list.position(), "1/2");
  list.setFilter("zzz");
  assert.equal(list.selected(), undefined);
  assert.deepEqual(list.render(20, 2), ['  No match for "zzz"', "                    "]);
  list.setFilter("");
  assert.equal(list.count(), 5);

  assert.deepEqual(createList([], { empty: "No items" }).render(10, 2), ["  No items", "          "]);
  assert.equal(createList([]).position(), "");
});

test("a list's new items keep the selection on the same item, or else in the same place", () => {
  const rows = (...ids) => ids.map((id) => ({ id }));
  const list = createList(rows("a", "b", "c"), { label: (row) => row.id, key: (row) => row.id });
  list.move(1);
  list.setItems(rows("new", "a", "b", "c"));
  assert.equal(list.selected().id, "b");
  list.setItems(rows("a", "c", "d"));
  assert.equal(list.selected().id, "d");
  list.setItems(rows("a"));
  assert.equal(list.selected().id, "a");
  list.setItems([]);
  assert.equal(list.selected(), undefined);
  // Keys can repeat, like blank rows: the one nearest to where it was counts.
  const blanks = createList(["", "x", "", "y", ""]);
  blanks.move(2);
  blanks.setItems(["", "new", "x", "", "y", ""]);
  assert.equal(blanks.position(), "4/6");
});

test("a list's new items keep the rows in view where they were", () => {
  const ids = (from, to) => Array.from({ length: to - from + 1 }, (_, index) => `item${String(from + index).padStart(2, "0")}`);
  const list = createList(ids(1, 20));
  list.move(9);
  const view = () => list.render(8, 4).map((row) => row.trim());
  assert.deepEqual(view(), ["item07", "item08", "item09", "> item10"]);
  // Rows dropped and added above the view, and added below it.
  list.setItems([...ids(3, 5), "itemA", ...ids(6, 20), "itemZ"]);
  assert.deepEqual(view(), ["item07", "item08", "item09", "> item10"]);
  // When the row at the top is gone, the view still keeps the selection in it.
  list.setItems(ids(8, 20));
  assert.deepEqual(view(), ["> item10", "item11", "item12", "item13"]);
});

test("a list that only scrolls has no selection, and moving scrolls it", () => {
  const lines = Array.from({ length: 10 }, (_, index) => ({ text: `line ${index + 1}`, title: index === 0 }));
  const list = createList(lines, { selectable: false, label: (line) => line.text, style: (line) => (line.title ? "bold" : undefined) });
  const paint = { bold: (text) => `*${text}*` };
  assert.deepEqual(list.render(7, 3, { paint }), ["*line 1 *", "line 2 ", "line 3 "]);
  assert.equal(list.position(), "1-3/10");
  list.move(1);
  list.page(1);
  assert.equal(list.position(), "4-6/10");
  list.last();
  assert.deepEqual(list.render(7, 3, { paint }), ["line 8 ", "line 9 ", "line 10"]);
  assert.equal(list.selected(), undefined);
});

test("keyOf names keys the same way for every terminal, and only characters are typed", () => {
  assert.equal(keyOf(undefined, { name: "escape", meta: true }), "escape");
  assert.equal(keyOf("\r", { name: "return" }), "enter");
  assert.equal(keyOf("\t", { name: "tab", shift: true }), "shift+tab");
  assert.equal(keyOf("K", { name: "k", shift: true }), "K");
  assert.equal(keyOf("?", { name: undefined }), "?");
  assert.equal(keyOf("\x03", { name: "c", ctrl: true }), "ctrl+c");
  assert.equal(keyOf(undefined, { name: "x", meta: true }), null);
  assert.deepEqual(
    paints(false).bar("x"),
    "\x1b[7mx\x1b[27m",
  );
});
