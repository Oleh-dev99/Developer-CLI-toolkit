import assert from "node:assert/strict";
import { emitKeypressEvents } from "node:readline";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { createProgram } from "../src/cli.js";
import { createApp } from "../src/tui/app.js";
import { describeCommands } from "../src/tui/commands.js";
import { createDashboard } from "../src/tui/dashboard.js";
import { hintsFor, keyOf, sections, shortcutLabel } from "../src/tui/keys.js";
import { createList } from "../src/tui/list.js";
import { paints } from "../src/tui/screen.js";
import { fakeTerminal, pressKeys } from "./helpers.js";

// Keyboard navigation in `toolsmith ui`: the key table (src/tui/keys.js), the
// list component (src/tui/list.js) and the dashboard (src/tui/dashboard.js),
// driven with the codes terminals send, at a fixed size of 40x10.

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

// The UI in a pretend terminal, with keys to press and the screen as text.
function session(columns = 40, rows = 10) {
  const term = fakeTerminal(columns, rows);
  const view = createDashboard({ folder: "my-project", commands });
  const app = createApp({ ...term, view });
  app.start();
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

test("scripted key presses at 40x10: panels, End, a filter, a command's form, and back", async () => {
  const ui = session();
  assert.deepEqual(ui.screen(), [
    " toolsmith ui                my-project ",
    " Commands   │ Files 1/24 │ Git status   ",
    "> config    │> file01.txt│  Nothing her…",
    "  dupes     │  file02.txt│              ",
    "  git clean…│  file03.txt│              ",
    "  git recent│  file04.txt│              ",
    "  git templ…│  file05.txt│              ",
    "  git templ…│  file06.txt│              ",
    "  git templ…│  file07.txt│              ",
    " ?: shortcuts  q: quit  /: filter  Ent…",
  ]);

  // Tab to Files, End: the list scrolls to keep the last file in view.
  await ui.press(key.tab, key.end);
  assert.deepEqual(ui.screen().slice(1, 9), [
    " Commands   │ Files      │ Git status   ",
    "> config    │  file18.txt│  Nothing her…",
    "  dupes     │  file19.txt│              ",
    "  git clean…│  file20.txt│              ",
    "  git recent│  file21.txt│              ",
    "  git templ…│  file22.txt│              ",
    "  git templ…│  file23.txt│              ",
    "  git templ…│> file24.txt│              ",
  ]);

  // Back to Commands, and filter it. The panel is narrow, so the filter takes
  // the title's place.
  await ui.press(key.shiftTab, "/", "g", "i", "t");
  assert.deepEqual(ui.screen(), [
    " toolsmith ui                my-project ",
    " /git_  1/6 │ Files      │ Git status   ",
    "> git clean…│  file18.txt│  Nothing her…",
    "  git recent│  file19.txt│              ",
    "  git templ…│  file20.txt│              ",
    "  git templ…│  file21.txt│              ",
    "  git templ…│  file22.txt│              ",
    "  git templ…│  file23.txt│              ",
    "            │> file24.txt│              ",
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
  assert.equal(ui.screen()[1], " /git   2/6 │ Files      │ Git status   ");
  await ui.press(key.escape);
  assert.equal(ui.screen()[1], " Commands   │ Files      │ Git status   ");
  // The selection stays on the command that was opened.
  assert.equal(ui.screen()[5], "> git recent│  file21.txt│              ");
  await ui.end();
});

test("the shortcuts overlay lists the key table, scrolls, and closes with Esc or ?", async () => {
  const ui = session();
  await ui.press("?");
  assert.deepEqual(ui.screen(), [
    " toolsmith ui                my-project ",
    "┌ Shortcuts ───────────────────────────┐",
    "│ Panels                               │",
    "│   Up, k               move up        │",
    "│   Down, j             move down      │",
    "│   PgUp                move up a page │",
    "│   PgDn                move down a p… │",
    "│   Home                go to the fir… │",
    "└ 1-6/69 ──────────────────────────────┘",
    " Esc: close  Down: scroll              ",
  ]);
  await ui.press("j", key.down);
  assert.match(ui.screen()[8], /^└ 3-8\/69 /);
  await ui.press(...Array.from({ length: 15 }, () => key.pageDown));
  assert.match(ui.screen()[8], /^└ 64-69\/69 /);
  await ui.press(key.escape);
  assert.match(ui.screen()[1], /Commands/);
  await ui.press("?", "?");
  assert.match(ui.screen()[1], /Commands/);
  await ui.end();
});

test("every shortcut in the key table is in the overlay, and the hints at the bottom come from it", async () => {
  const ui = session(120, 80);
  await ui.press("?");
  const overlay = ui.screen().join("\n");
  for (const shortcut of sections.flatMap((section) => section.shortcuts)) {
    assert.match(overlay, new RegExp(`│ +${escape(shortcutLabel(shortcut))} +${escape(shortcut.description)} +│`), shortcutLabel(shortcut));
  }
  for (const section of sections) {
    assert.match(overlay, new RegExp(`│ ${escape(section.title)} +│`));
  }
  const footer = () => ui.screen()[79].trim();
  assert.equal(footer(), hintsFor("help"));
  await ui.press(key.escape);
  assert.equal(footer(), hintsFor("panels"));
  await ui.press("/");
  assert.equal(footer(), hintsFor("filter"));
  await ui.press(key.escape, key.enter);
  assert.equal(footer(), hintsFor("form"));
  await ui.press(key.escape, key.tab, key.enter);
  assert.equal(footer(), hintsFor("item"));
  await ui.end();
});

function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("the key table and the handlers can't drift apart", () => {
  const view = createDashboard();
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
  assert.deepEqual(sections.map((section) => section.context).sort(), ["filter", "form", "help", "item", "output", "panels", "running"]);
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
  space: [" "],
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

test("the classic Windows console's codes with Node.js 22 move around like the others", async () => {
  const ui = session();
  await ui.press("\t", "\x1b[4~");
  assert.match(ui.screen()[8], /> file24\.txt/);
  await ui.press("\x1b[1~");
  assert.match(ui.screen()[2], /> file01\.txt/);
  await ui.press("/", "x", "\b");
  assert.match(ui.screen()[1], /Files \/_/);
  await ui.end();
});

test("arrow keys and h, j, k, l move, and the panels wrap around", async () => {
  const ui = session();
  const selected = () => ui.screen().find((row) => row.startsWith(">"));
  await ui.press("j", "j", key.down);
  assert.match(selected(), /^> git recent/);
  await ui.press("k", key.up);
  assert.match(selected(), /^> dupes/);

  const focusedTitle = () => {
    const header = ui.raw()[1].split("│");
    return plain(header.find((part) => part.startsWith("\x1b[7m"))).trim();
  };
  assert.equal(focusedTitle(), "Commands");
  for (const [press, title] of [
    ["l", "Files"],
    [key.right, "Git status"],
    [key.tab, "Commands"],
    [key.shiftTab, "Git status"],
    ["h", "Files"],
    [key.left, "Commands"],
    [key.left, "Git status"],
  ]) {
    await ui.press(press);
    assert.ok(focusedTitle().startsWith(title), `after ${JSON.stringify(press)}: ${focusedTitle()}`);
  }
  await ui.end();
});

test("PgDn and PgUp move a page, and the selection stays in view", async () => {
  const ui = session();
  await ui.press(key.tab, key.pageDown);
  // Seven rows of files are in view; a page is one less, so one stays.
  assert.match(ui.screen()[8], /> file07\.txt/);
  await ui.press(key.pageDown);
  assert.match(ui.screen()[8], /> file13\.txt/);
  assert.match(ui.screen()[2], /file07\.txt/);
  await ui.press(key.pageUp);
  assert.match(ui.screen()[2], /> file07\.txt/);
  await ui.end();
});

test("the focused panel stands out without colors: an inverse header and selection", async () => {
  const ui = session(60, 12);
  await ui.press(key.tab);
  const [, header, firstRow] = ui.raw();
  const parts = header.split("│");
  assert.deepEqual(
    parts.map((part) => part.startsWith("\x1b[7m")),
    [false, true, false],
  );
  const cells = firstRow.split("│");
  assert.ok(cells[1].startsWith("\x1b[7m> file01.txt"));
  assert.ok(cells[0].startsWith("> config") && !cells[0].includes("\x1b[7m"));
  await ui.end();
});

test("/ filters as you type: any case, Backspace edits, Esc clears, and keys like q are typed", async () => {
  // Wide enough for the filter and the position in the header.
  const ui = session(80, 12);
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

test("an empty panel says so, and Enter there opens nothing", async () => {
  const ui = session(60, 12);
  await ui.press(key.shiftTab);
  assert.match(ui.screen()[2], /│ {2}Nothing here yet +$/);
  await ui.press(key.enter);
  assert.match(ui.screen()[1], /Git status/);
  assert.match(ui.screen()[11], /^ \?: shortcuts/);
  await ui.end();
});

test("Ctrl+C quits from the panels, a filter, a form, an item and the overlay, and q where it isn't typed", async () => {
  const setups = { panels: [], filter: ["/"], form: [key.enter], item: [key.tab, key.enter], help: ["?"] };
  for (const [context, keys] of Object.entries(setups)) {
    for (const quit of [key.ctrlC, "q"]) {
      const ui = session();
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
