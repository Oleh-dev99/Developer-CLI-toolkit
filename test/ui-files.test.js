import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { chmodSync, existsSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { test } from "node:test";
import { createProgram } from "../src/cli.js";
import { cmdLine } from "../src/lib/program.js";
import { walk } from "../src/lib/walk.js";
import { createApp } from "../src/tui/app.js";
import { describeCommands } from "../src/tui/commands.js";
import { createDashboard } from "../src/tui/dashboard.js";
import { editorCommand, openerFor, openWithApp } from "../src/tui/open.js";
import { previewLimit, readPreview } from "../src/tui/preview.js";
import { plainLine, terminal, width } from "../src/tui/screen.js";
import { createTree } from "../src/tui/tree.js";
import { fakeTerminal, makeTree, pressKeys, tempDir } from "./helpers.js";

// The Files panel of `toolsmith ui`: the folder tree (src/tui/tree.js), file
// previews (src/tui/preview.js), opening files (src/tui/open.js), and the file
// tools run on a folder, driven with keys, on folders in a temp directory.

const plain = (text) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
const key = { up: "\x1b[A", down: "\x1b[B", left: "\x1b[D", right: "\x1b[C", enter: "\r", escape: "\x1b", tab: "\t" };
const commands = describeCommands(createProgram());
const windows = process.platform === "win32";

// A project: sizes in bytes are 10 (README.md), 159 (docs: 100 + 50 + 4 + 4
// + 1), 50 (docs/deep), 1000 (src) and 16 (日本語.txt). .git and node_modules
// are left out of the tree, as the file tools leave them out.
const project = {
  "README.md": "# Project\n",
  "docs/guide.md": "g".repeat(100),
  "docs/deep/notes.txt": "n".repeat(50),
  "docs/a.txt": "same",
  "docs/b.txt": "same",
  "docs/draft-one.md": "d",
  "src/app.js": "a".repeat(1000),
  "日本語.txt": "こんにちは\n",
  ".git/config": "left out",
  "node_modules/x/index.js": "left out",
};

async function until(condition, what, timeout = 15000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

// The dashboard in a pretend terminal, on the Files panel of a folder made from
// `files`, once it's read.
async function session(t, { files = project, columns = 80, rows = 20, ...options } = {}) {
  const cwd = makeTree(t, files);
  const env = { ...process.env, TOOLSMITH_CONFIG: join(tempDir(t), "none.json"), npm_config_prefix: join(tempDir(t), "prefix") };
  delete env.FORCE_COLOR;
  const term = fakeTerminal(columns, rows);
  const view = createDashboard({ folder: "project", commands, cwd, env, editor: null, ...options });
  const app = createApp({ ...term, view });
  app.start();
  t.after(() => app.stop());
  const ui = {
    cwd,
    term,
    app,
    view,
    press: (...keys) => pressKeys(term, ...keys),
    type: (text) => pressKeys(term, ...text),
    screen: () =>
      app
        .rows()
        .map((row) => plain(row).trimEnd())
        .join("\n"),
    until: (pattern, what = String(pattern)) => until(() => pattern.test(ui.screen()), what),
    // Selects the entry named `name` with the filter, and clears the filter.
    select: async (name) => {
      await ui.press("/");
      await ui.type(name);
      await ui.press(key.enter, key.escape);
      assert.equal(view.tree.list.selected()?.name, name);
    },
  };
  await ui.press(key.tab);
  await until(() => !view.tree.list.selected() === false && view.state.message === "" && ui.screen().includes(" Files "), "the files");
  // The project's .git folder makes the dashboard run git once, in the
  // project; a folder that git still runs in can't be deleted on Windows.
  await view.gitStatus.settled();
  return ui;
}

test("the Files panel shows the folder's tree with sizes, without .git and node_modules", async (t) => {
  const ui = await session(t);
  // src's size comes a moment after docs'.
  await ui.until(/\+ docs\/ +159 B[\s\S]*\+ src\/ +1000 B/, "the folder sizes");
  const screen = ui.screen();
  assert.match(screen, /README\.md +10 B/);
  assert.match(screen, /日本語\.txt +16 B/);
  assert.doesNotMatch(screen, /\.git|node_modules/);
  assert.equal(ui.view.tree.totalSize(), 10 + 159 + 1000 + 16);
  // Every row is exactly as wide as the terminal, wide characters and all.
  ui.app.rows().forEach((row, index) => assert.equal(width(plain(row)), index === 19 ? 79 : 80, `row ${index}: ${plain(row)}`));
});

test("folders open lazily with Enter or Right, close with Left, and Left goes up to the folder", async (t) => {
  const ui = await session(t);
  const docs = ui.view.tree.list.selected().parent.children.find((node) => node.name === "docs");
  assert.equal(docs.children, null, "docs is read only when it's opened");
  await ui.select("docs");
  await ui.press(key.right);
  await ui.until(/- docs\/[\s\S]*guide\.md +100 B/, "docs to open");
  assert.match(ui.screen(), / {4}\+ deep\/ +50 B/);
  // Right on an open folder goes into it; Left goes back up, then closes it.
  await ui.press(key.right);
  assert.equal(ui.view.tree.list.selected().name, "a.txt");
  await ui.press(key.left);
  assert.equal(ui.view.tree.list.selected().name, "docs");
  await ui.press(key.left);
  assert.doesNotMatch(ui.screen(), /guide\.md/);
  assert.match(ui.screen(), /\+ docs\//);
  // Enter opens and closes too, and h and l work like Left and Right.
  await ui.press(key.enter);
  assert.match(ui.screen(), /guide\.md/);
  await ui.press(key.enter);
  assert.doesNotMatch(ui.screen(), /guide\.md/);
  await ui.press("l", "l", "h");
  assert.equal(ui.view.tree.list.selected().name, "docs");
});

test("folder sizes come in the background, with … until they're known, and keys never wait for them", async (t) => {
  // 20 folders of 100 files each.
  const files = {};
  for (let folder = 0; folder < 20; folder++) {
    for (let file = 0; file < 100; file++) {
      files[`folder${String(folder).padStart(2, "0")}/file${file}.txt`] = "x".repeat(file);
    }
  }
  const delay = monitorEventLoopDelay({ resolution: 10 });
  delay.enable();
  const ui = await session(t, { files });
  await ui.until(/folder00\//, "the folders");
  const early = ui.screen();
  // Keys are handled while the sizes are worked out.
  await ui.press(key.down, key.down);
  assert.equal(ui.view.tree.list.selected().name, "folder02");
  await until(() => ui.view.tree.totalSize() !== undefined, "the sizes");
  delay.disable();
  assert.match(early, /\+ folder\d\d\/ +…/, "a folder without its size yet shows …");
  assert.match(ui.screen(), /\+ folder00\/ +4\.8 KB/);
  // Nothing held up the event loop, and so the keys, for long.
  assert.ok(delay.max < 250e6, `the event loop was held up for ${Math.round(delay.max / 1e6)} ms`);
});

// The Files panel's rows as text: the selection marker, then each entry with
// " | " between its name and its size.
const treeRows = (tree) =>
  tree.list
    .render(40, 20)
    .map((row) => row.trimEnd())
    .filter(Boolean)
    .map((row) => row.slice(0, 2) + row.slice(2).replace(/(\S) {2,}(?=\S)/, "$1 | "));
// The Files panel's column of the screen, at 80 columns: its header and rows.
const filesColumn = (ui) =>
  ui.app
    .rows()
    .slice(1, -1)
    .map((row) => plain(row).split("│")[1].trimEnd());

test("reload() reads the open folders again: new, deleted and renamed entries, with open folders and the selection kept", async (t) => {
  const root = makeTree(t, project);
  const tree = createTree(root);
  t.after(() => tree.stop());
  await until(() => tree.list.count() === 4 && tree.totalSize() !== undefined, "the tree");
  const top = tree.list.selected().parent;
  const child = (folder, name) => folder.children.find((node) => node.name === name);
  const open = async (folder) => {
    tree.toggle(folder);
    await until(() => folder.children !== null && !folder.loading, folder.name);
  };
  const docs = child(top, "docs");
  await open(docs);
  const deep = child(docs, "deep");
  await open(deep);
  // src is read, then closed again.
  const src = child(top, "src");
  await open(src);
  tree.toggle(src);
  const guide = child(docs, "guide.md");
  tree.select(guide);

  writeFileSync(join(root, "docs", "added.md"), "new");
  rmSync(join(root, "README.md"));
  renameSync(join(root, "docs", "guide.md"), join(root, "docs", "manual.md"));
  writeFileSync(join(root, "docs", "deep", "notes.txt"), "n".repeat(60));
  writeFileSync(join(root, "src", "new.js"), "x");
  await Promise.all([tree.reload(), tree.remeasure()]);
  assert.deepEqual(treeRows(tree), [
    "  - docs/ | 172 B",
    "      a.txt | 4 B",
    "      added.md | 3 B",
    "      b.txt | 4 B",
    "    - deep/ | 60 B",
    "        notes.txt | 60 B",
    "      draft-one.md | 1 B",
    ">     manual.md | 100 B",
    "  + src/ | 1001 B",
    "    日本語.txt | 16 B",
  ]);
  // The renamed file is the same entry as before, so it stays selected.
  assert.equal(tree.list.selected(), guide);
  // src was closed, so it's read again only when it's opened.
  assert.equal(child(src, "new.js"), undefined);
  tree.toggle(src);
  await until(() => child(src, "new.js"), "src/new.js");
  assert.equal(tree.list.selected(), guide);
});

test("the Files list follows files created, deleted and renamed while the dashboard runs, at 80x20", async (t) => {
  const ui = await session(t);
  await ui.select("docs");
  await ui.press(key.right);
  await ui.until(/guide\.md/, "docs to open");
  await ui.select("guide.md");
  // No keys from here on: the watcher sees the changes.
  writeFileSync(join(ui.cwd, "docs", "added.md"), "new");
  await ui.until(/added\.md +3 B/, "the new file");
  rmSync(join(ui.cwd, "README.md"));
  await until(() => !ui.screen().includes("README.md"), "README.md to go");
  renameSync(join(ui.cwd, "docs", "guide.md"), join(ui.cwd, "docs", "manual.md"));
  await ui.until(/manual\.md/, "the new name");
  await ui.until(/- docs\/ +162 B/, "the new size");
  assert.equal(ui.view.context(), "files");
  assert.equal(ui.view.tree.list.selected().name, "manual.md");
  assert.deepEqual(filesColumn(ui), [
    " Files                              7/9",
    "  - docs/                          162 B",
    "      a.txt                          4 B",
    "      added.md                       3 B",
    "      b.txt                          4 B",
    "    + deep/                         50 B",
    "      draft-one.md                   1 B",
    ">     manual.md                    100 B",
    "  + src/                          1000 B",
    "    日本語.txt                      16 B",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
  ]);
});

test("changes outside keep the Files list's rows in view where they were", async (t) => {
  const files = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`file${String(index + 1).padStart(2, "0")}.txt`, "x"]));
  const ui = await session(t, { files, rows: 12 });
  await ui.select("file20.txt");
  const before = filesColumn(ui);
  assert.match(before[0], / 20\/40$/);
  assert.match(before[1], /^ {4}file12\.txt/);
  assert.match(before[9], /^> {3}file20\.txt/);
  // Files dropped and added above the rows in view, and added below them.
  rmSync(join(ui.cwd, "file01.txt"));
  rmSync(join(ui.cwd, "file05.txt"));
  writeFileSync(join(ui.cwd, "file00.txt"), "x");
  writeFileSync(join(ui.cwd, "file99.txt"), "x");
  await until(() => filesColumn(ui)[0].endsWith(" 19/40"), "the new list");
  assert.deepEqual(filesColumn(ui).slice(1), before.slice(1));
});

test("reading a big open folder again doesn't hold up the keys", async (t) => {
  const files = Object.fromEntries(Array.from({ length: 2000 }, (_, index) => [`big/file${String(index).padStart(4, "0")}.txt`, "x"]));
  const ui = await session(t, { files });
  await ui.press(key.right);
  await until(() => ui.view.tree.list.count() === 2001, "big/ to open");
  const delay = monitorEventLoopDelay({ resolution: 10 });
  delay.enable();
  writeFileSync(join(ui.cwd, "big", "zzz.txt"), "x");
  await ui.press(key.down, key.down);
  assert.equal(ui.view.tree.list.selected().name, "file0001.txt");
  await until(() => ui.view.tree.list.count() === 2002, "the new file");
  delay.disable();
  assert.ok(delay.max < 250e6, `the event loop was held up for ${Math.round(delay.max / 1e6)} ms`);
});

test("an unreadable folder is a warning, not an error", { skip: windows || process.getuid?.() === 0 ? "needs file permissions that aren't Windows', and not root" : false }, async (t) => {
  const ui = await session(t, { files: { ...project, "locked/secret.txt": "s" } });
  const locked = join(ui.cwd, "locked");
  chmodSync(locked, 0o000);
  t.after(() => chmodSync(locked, 0o755));
  await ui.select("locked");
  await ui.press(key.right);
  await ui.until(/locked\/ +can't read/, "the warning in the tree");
  assert.match(ui.screen(), /warning: can't read folder .*locked \(permission denied\)/);
  // The walker reports to its caller, and prints nothing itself.
  const warnings = [];
  for await (const entry of walk(ui.cwd, { onWarning: (message) => warnings.push(message) })) {
    assert.ok(entry);
  }
  assert.deepEqual(warnings, [`skipped ${locked} (permission denied)`]);
});

test("a symlink is shown, but never followed", async (t) => {
  const cwd = makeTree(t, project);
  // A junction on Windows needs no special rights.
  symlinkSync(join(cwd, "docs"), join(cwd, "shortcut"), windows ? "junction" : "dir");
  const linked = createDashboard({ cwd, commands, editor: null });
  t.after(() => linked.dispose());
  await until(() => linked.tree.totalSize() !== undefined, "the sizes");
  const rows = linked.tree.list.render(40, 10).map((row) => row.trimEnd());
  assert.ok(rows.some((row) => /shortcut@ +link$/.test(row)), rows.join("\n"));
  // Its contents aren't counted twice, and it doesn't open.
  assert.equal(linked.tree.totalSize(), 10 + 159 + 1000 + 16);
  linked.tree.list.first();
  while (linked.tree.list.selected().name !== "shortcut") {
    linked.tree.list.move(1);
  }
  linked.actions.expandEntry();
  assert.equal(linked.state.preview, null);
  // The .git folder makes the dashboard run git once, in the project; on
  // Windows, a folder that git still runs in can't be deleted.
  linked.dispose();
  await linked.gitStatus.settled();
});

test("Enter on a file shows it, with its lines scrolling; Esc goes back", async (t) => {
  const ui = await session(t, { files: { ...project, "long.txt": Array.from({ length: 50 }, (_, index) => `line ${index + 1}`).join("\n") } });
  await ui.select("long.txt");
  await ui.press(key.enter);
  await ui.until(/line 1\n/, "the preview");
  assert.equal(ui.view.context(), "preview");
  assert.match(ui.screen(), /\n long\.txt +390 B {2}1-17\/50\n/);
  await ui.press("j", "j");
  assert.match(ui.screen(), /\n long\.txt +390 B {2}3-19\/50\nline 3\n/);
  await ui.press(key.escape);
  assert.equal(ui.view.context(), "files");
  // Left and h go back too.
  await ui.press(key.enter);
  await ui.until(/line 1\n/);
  await ui.press("h");
  assert.equal(ui.view.context(), "files");
});

test("previews strip escape codes, and binary, very large and empty files get a note", async (t) => {
  const dir = makeTree(t, {
    "colors.txt": "\x1b[31mred\x1b[0m and plain\r\nsecond\tline\r\n50%\r100%\n",
    "binary.bin": Buffer.from([0x50, 0x4b, 0x00, 0x03]),
    "empty.txt": "",
    "cjk.md": "日本語のテキスト\n",
  });
  writeFileSync(join(dir, "big.log"), Buffer.alloc(previewLimit + 1, "a"));
  writeFileSync(join(dir, "utf16.txt"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("from PowerShell\r\n", "utf16le")]));

  // In a file, a carriage return of its own ends a line, as old Macs wrote them.
  assert.deepEqual((await readPreview(join(dir, "colors.txt"))).lines, ["red and plain", "second  line", "50%", "100%"]);
  assert.deepEqual((await readPreview(join(dir, "cjk.md"))).lines, ["日本語のテキスト"]);
  assert.deepEqual((await readPreview(join(dir, "utf16.txt"))).lines, ["from PowerShell"]);
  const binary = await readPreview(join(dir, "binary.bin"));
  assert.deepEqual([binary.lines, binary.note], [[], "This is a binary file of 4 B, so it isn't shown."]);
  const big = await readPreview(join(dir, "big.log"));
  assert.deepEqual([big.lines, big.note], [[], "At 1 MB, this file is too big to show here (the limit is 1 MB)."]);
  assert.equal((await readPreview(join(dir, "empty.txt"))).note, "This file is empty.");

  assert.equal(plainLine("\x1b]0;title\x07text\x1b[2K"), "text");
  assert.equal(plainLine("日本\tx"), "日本    x");
});

test("e edits the file in $VISUAL or $EDITOR, with the dashboard out of the way, and shows it as it is after", async (t) => {
  const tools = makeTree(t, {
    "editor.mjs": `import { appendFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
writeFileSync(process.env.FAKE_EDITOR_LOG, JSON.stringify(args));
appendFileSync(args.at(-1), "edited\\n");
`,
  });
  const log = join(tools, "log.json");
  const ui = await session(t, { editor: [process.execPath, join(tools, "editor.mjs"), "--wait"], env: { ...process.env, FAKE_EDITOR_LOG: log } });
  await ui.select("README.md");
  await ui.press(key.enter);
  await ui.until(/# Project\n/);
  const before = ui.term.events.length;
  await ui.press("e");
  await ui.until(/# Project\nedited\n/, "the preview of the edited file");
  assert.deepEqual(JSON.parse(readFileSync(log, "utf8")), ["--wait", join(ui.cwd, "README.md")]);

  // The normal screen first, then raw mode off; the editor; then the
  // dashboard's screen and raw mode back, in the order they start in.
  const events = ui.term.events.slice(before);
  const order = ["leave", "raw off", "editing", "enter", "raw on"].map((step) =>
    events.findIndex((event) =>
      ({ leave: event.includes?.(terminal.leaveAlternateScreen), "raw off": event === "raw off", editing: event.startsWith?.("Editing README.md with "), "raw on": event === "raw on", enter: event.includes?.(terminal.enterAlternateScreen) })[step],
    ),
  );
  assert.ok(order.every((index) => index !== -1) && order.every((index, step) => step === 0 || index > order[step - 1]), `order: ${order}`);
  await ui.press(key.escape);
  assert.match(ui.screen(), /README\.md +17 B/);
});

test("e explains what's missing: an editor, one that starts, or a file", async (t) => {
  const none = await session(t);
  await none.select("README.md");
  await none.press("e");
  assert.match(none.screen(), /\n Set VISUAL or EDITOR to choose an editor; o opens the file in its default app$/);

  // Wide enough for the whole message.
  const missing = await session(t, { editor: ["no-such-editor-for-toolsmith"], columns: 120 });
  await missing.select("README.md");
  await missing.press("e");
  await missing.until(/Couldn't start the editor: no-such-editor-for-toolsmith isn't installed, or isn't on your PATH/);
  await missing.select("docs");
  await missing.press("e");
  assert.match(missing.screen(), /e edits files; o opens a folder in its default app/);

  assert.deepEqual(editorCommand({ VISUAL: "code --wait", EDITOR: "vim" }), ["code", "--wait"]);
  assert.deepEqual(editorCommand({ EDITOR: '"C:\\Program Files\\Editor\\edit.exe" -n' }), ["C:\\Program Files\\Editor\\edit.exe", "-n"]);
  assert.equal(editorCommand({ VISUAL: "  " }), null);
});

test("on Windows, a .cmd editor gets a file name with & and % in it unchanged", { skip: windows ? false : "only Windows has .cmd files" }, async (t) => {
  const tools = makeTree(t, {
    "editor.mjs": 'import { writeFileSync } from "node:fs";\nwriteFileSync(process.env.FAKE_EDITOR_LOG, JSON.stringify(process.argv.slice(2)));\n',
  });
  writeFileSync(join(tools, "edit.cmd"), `@"${process.execPath}" "${join(tools, "editor.mjs")}" %*\r\n`);
  const log = join(tools, "log.json");
  const name = "a & b %PATH% (1).txt";
  const ui = await session(t, { files: { [name]: "x" }, editor: [join(tools, "edit.cmd")], env: { ...process.env, FAKE_EDITOR_LOG: log } });
  await ui.select(name);
  await ui.press("e");
  await until(() => existsSync(log), "the editor");
  // Until the dashboard has the terminal back, when the editor has closed.
  await until(() => ui.term.events.lastIndexOf("raw on") > ui.term.events.lastIndexOf("raw off"), "the dashboard to come back");
  assert.deepEqual(JSON.parse(readFileSync(log, "utf8")), [join(ui.cwd, name)]);

  // cmd.exe shows the argument back as it is.
  const tricky = "a & b %PATH% ^x !y!";
  const [command, args, options] = cmdLine("echo", [tricky]);
  assert.equal(spawnSync(command, args, { ...options, encoding: "utf8" }).stdout.trim(), `"${tricky}"`);
});

test("o opens the entry in its default app, with start, open or xdg-open, without a shell", async (t) => {
  const opened = [];
  const ui = await session(t, { opener: async (path) => opened.push(path) });
  await ui.select("docs");
  await ui.press("o");
  await ui.until(/Opened docs in its default app/);
  assert.deepEqual(opened, [join(ui.cwd, "docs")]);

  const failing = await session(t, { opener: async () => Promise.reject(new Error("xdg-open isn't installed")) });
  await failing.select("README.md");
  await failing.press("o");
  await failing.until(/README\.md couldn't be opened: xdg-open isn't installed/);

  const path = "/home/ada/a & b.txt";
  assert.deepEqual(openerFor(path, "darwin"), ["open", [path], {}]);
  assert.deepEqual(openerFor(path, "linux"), ["xdg-open", [path], {}]);
  const [command, args, options] = openerFor("C:\\a & b %x%.txt", "win32");
  assert.match(command, /cmd\.exe$/i);
  assert.deepEqual(args, ["/d", "/v:off", "/s", "/c", '"start "" "%TOOLSMITH_ARG_1%""']);
  assert.equal(options.env.TOOLSMITH_ARG_1, "C:\\a & b %x%.txt");
  assert.equal(options.windowsVerbatimArguments, true);
  assert.equal(options.shell, false);

  // It doesn't wait for the app, and says when the opener can't start.
  const started = [];
  const start = (...spawned) => {
    started.push(spawned);
    const child = Object.assign(new EventEmitter(), { unref() {} });
    setImmediate(() => child.emit("spawn"));
    return child;
  };
  await openWithApp(path, { platform: "linux", start });
  assert.deepEqual(started[0].slice(0, 2), ["xdg-open", [path]]);
  assert.equal(started[0][2].detached, true);
  const broken = () => {
    const child = new EventEmitter();
    setImmediate(() => child.emit("error", new Error("spawn xdg-open ENOENT")));
    return child;
  };
  await assert.rejects(openWithApp(path, { platform: "linux", start: broken }), /ENOENT/);
});

test("s and d run the size report and the duplicates finder on the selected folder", async (t) => {
  const ui = await session(t);
  await ui.select("docs");
  await ui.press("s");
  await ui.until(/exit code 0 after/, "the size report");
  assert.match(ui.screen(), /\$ toolsmith size docs /);
  assert.match(ui.screen(), /\n100 B +63% {2}guide\.md\n/);
  await ui.press(key.escape);
  assert.equal(ui.view.context(), "files");

  await ui.press("d");
  await ui.until(/exit code 0 after/, "the duplicates");
  assert.match(ui.screen(), /\$ toolsmith dupes docs /);
  assert.match(ui.screen(), /2 identical files, 4 B each/);
  await ui.press(key.escape);

  // On a file, they work on its folder.
  await ui.select("README.md");
  await ui.press("s");
  await ui.until(/exit code 0 after/);
  assert.match(ui.screen(), /\$ toolsmith size \. /);
});

test("r previews renaming files in the folder: its form always has --dry-run, and nothing is renamed", async (t) => {
  const ui = await session(t);
  await ui.select("docs");
  await ui.press("r");
  assert.equal(ui.view.context(), "form");
  assert.match(ui.screen(), /\[paths\.\.\.\] +docs\n/);
  assert.match(ui.screen(), /--dry-run +\[x\] \(always, here\)/);
  await ui.type("draft");
  await ui.press(key.down);
  await ui.type("final");
  assert.match(ui.screen(), /\$ toolsmith rename draft final docs --dry-run\n/);
  // --dry-run can't be turned off here.
  await ui.press(key.down, key.down, key.down, key.down, " ");
  assert.match(ui.screen(), /--dry-run can't be changed here/);
  assert.match(ui.screen(), /--dry-run +\[x\]/);
  await ui.press(key.enter);
  await ui.until(/exit code 0 after/, "the preview");
  assert.match(ui.screen(), /docs\/draft-one\.md → docs\/final-one\.md\nDry run: 1 file would be renamed\. Nothing was changed\./);
  assert.ok(existsSync(join(ui.cwd, "docs", "draft-one.md")));
  assert.ok(!existsSync(join(ui.cwd, "docs", "final-one.md")));
});

test("the Files panel uses only the 16 basic colors, never magenta", async (t) => {
  const ui = await session(t);
  await ui.until(/\+ docs\/ +159 B/);
  await ui.select("README.md");
  const panel = ui.app.rows().join("");
  await ui.press(key.enter);
  await ui.until(/# Project/);
  for (const text of [panel, ui.app.rows().join("")]) {
    const codes = Array.from(text.matchAll(/\x1b\[([0-9;]*)m/g), ([, list]) => list.split(";").map(Number)).flat();
    assert.deepEqual(
      codes.filter((n) => ![1, 7, 22, 27, 33, 36, 39].includes(n)),
      [],
    );
  }
});
