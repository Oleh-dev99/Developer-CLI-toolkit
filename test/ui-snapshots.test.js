import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { createProgram } from "../src/cli.js";
import { createApp } from "../src/tui/app.js";
import { describeCommands } from "../src/tui/commands.js";
import { createDashboard } from "../src/tui/dashboard.js";
import { rowWidth, width } from "../src/tui/screen.js";
import { assertSnapshot, fakeTerminal, makeRepo, pressKeys, screenText, stopWhenDone, tempDir, updatingSnapshots } from "./helpers.js";

// Snapshots of toolsmith ui's screens at 80x24, with colors off and on. The
// dashboard is driven with the codes a terminal sends for each key, and each
// screen is compared with its file in test/snapshots/ui/ (".color" for colors
// on). After changing what the dashboard shows, check the diff the test
// prints, and then update the files with `npm run test:update-snapshots`.
//
// The screens are the same on every system: the project is made by the test,
// byte for byte, and what still differs is replaced (see screenText() in
// helpers.js): the project's path, sizes and durations. Command lines are
// quoted as on Linux and macOS; ui-commands.test.js checks the quoting for
// PowerShell.

const size = { columns: 80, rows: 24 };
const key = { down: "\x1b[B", tab: "\t", enter: "\r" };
const commands = describeCommands(createProgram());
const plain = (text) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");

async function until(condition, what, timeout = 20000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

// A git repository with a committed project in it, and then a staged file, a
// changed one and an untracked one.
function project(t) {
  const repo = makeRepo(t);
  const write = (path, text) => {
    mkdirSync(dirname(join(repo.dir, path)), { recursive: true });
    writeFileSync(join(repo.dir, path), text);
  };
  write("README.md", "# Project\n");
  write("docs/guide.md", "g".repeat(100));
  write("docs/deep/notes.txt", "n".repeat(50));
  write("src/app.js", "a".repeat(1000));
  write("src/util.js", "u".repeat(300));
  write("日本語.txt", "こんにちは\n");
  repo.git("add", "--all");
  repo.commit("add the project");
  write("src/app.js", "b".repeat(1200));
  write("src/new.js", "n".repeat(20));
  repo.git("add", "src/new.js");
  write("todo.txt", "t".repeat(5));
  return repo;
}

// The dashboard on `repo` in a pretend 80x24 terminal, once it has read
// everything: the files, every folder's size and the git status.
async function session(t, repo, color) {
  const env = { ...process.env, ...repo.env, TOOLSMITH_CONFIG: join(tempDir(t), "none.json"), npm_config_prefix: join(tempDir(t), "prefix") };
  delete env.FORCE_COLOR;
  const term = fakeTerminal(size.columns, size.rows);
  const view = createDashboard({ folder: "my-project", commands, cwd: repo.dir, env, editor: null, platform: "linux" });
  const app = createApp({ ...term, color, view });
  app.start();
  stopWhenDone(t, () => app.stop());
  const screen = () => app.rows().map(plain).join("\n");
  await until(
    () => view.tree.totalSize() !== undefined && view.gitStatus.available === true && !screen().includes("Reading") && !/\/ +…/.test(screen()),
    "the files, their sizes and the git status",
  );
  return {
    app,
    view,
    screen,
    press: (...keys) => pressKeys(term, ...keys),
    end: async () => {
      app.stop();
      await app.done;
      // On Windows, a folder that git still runs in can't be deleted.
      await view.gitStatus.settled();
    },
  };
}

// Each screen: its snapshot's name, what it shows, and how to get there.
const scenes = [
  { name: "start", title: "the start screen: Commands focused, with the files and the git status beside it" },
  {
    name: "files",
    title: "the Files panel focused, with a folder open",
    keys: [key.tab, key.down, key.enter],
    // Its entries come a moment later.
    ready: (ui) => /- docs\/[\s\S]*deep\//.test(ui.screen()),
  },
  { name: "git", title: "the Git status panel focused", keys: [key.tab, key.tab, key.down] },
  { name: "filter", title: "the Commands panel filtered as you type", keys: ["/", "g", "i", "t"] },
  { name: "help", title: "the shortcuts overlay", keys: ["?"] },
  { name: "form", title: "a command's form, with a value typed in", keys: ["/", "s", "i", "z", "e", key.enter, key.enter, "d", "o", "c", "s"] },
  {
    name: "output",
    title: "a command's output, with its time: the size report of a folder",
    keys: [key.tab, key.down, "s"],
    ready: (ui) => /exit code 0 after/.test(ui.screen()),
  },
];

test("toolsmith ui's screens at 80x24 match their snapshots, with colors off and on", async (t) => {
  const repo = project(t);
  for (const scene of scenes) {
    await t.test(scene.title, async (t) => {
      for (const color of [false, true]) {
        const ui = await session(t, repo, color);
        await ui.press(...(scene.keys ?? []));
        if (scene.ready) {
          await until(() => scene.ready(ui), `the screen "${scene.name}"`);
        }
        const rows = ui.app.rows();
        assert.equal(rows.length, size.rows);
        rows.forEach((row, index) => assert.equal(width(plain(row)), rowWidth(index, size), `row ${index} isn't as wide as the terminal: ${plain(row)}`));
        await ui.end();
        assertSnapshot(`ui/${scene.name}${color ? ".color" : ""}`, screenText(rows, { folders: { [repo.dir]: "<project>" } }));
      }
    });
  }
});

// While the snapshots are updated, this would write its own screen into one.
const checking = { skip: updatingSnapshots && "the snapshots are being updated" };

test("a snapshot that doesn't match shows each line that differs, and how to update it", checking, () => {
  const error = (() => {
    try {
      assertSnapshot("ui/start", "not the start screen\n");
    } catch (err) {
      return err;
    }
    return null;
  })();
  assert.ok(error, "a different screen matched the snapshot");
  assert.match(error.message, /^The screen doesn't match the snapshot test\/snapshots\/ui\/start\.txt \(- snapshot, \+ screen\):\n\nline 1:\n {2}- \{bold\} toolsmith ui {2,}my-project \{\/bold\}\n {2}\+ not the start screen\nline 2:\n/);
  assert.match(error.message, /update the snapshots with: npm run test:update-snapshots$/);
});

test("snapshots replace the project's path, sizes' digits and durations, keeping the columns where they were", (t) => {
  const folder = tempDir(t);
  // Two runs that took different times, and a panel next to a size report.
  const rows = [
    `\x1b[7m $ toolsmith size ${join(folder, "docs")}          exit code 0 after 350 ms \x1b[27m`,
    `\x1b[7m $ toolsmith size ${join(folder, "docs")}           exit code 0 after 1.2 s \x1b[27m`,
    "[exit code 0 after 1 min 5 s]  ",
    "> docs/          159 B│1000 B  85%  src/",
    "> README.md     10.5 KB│  10 B   1%  README.md",
  ];
  assert.deepEqual(screenText(rows, { folders: { [folder]: "<project>" } }).split("\n"), [
    "{inverse} $ toolsmith size <project>/docs          exit code 0 after <time> {/inverse}",
    "{inverse} $ toolsmith size <project>/docs          exit code 0 after <time> {/inverse}",
    "[exit code 0 after <time>]",
    "> docs/          ### B│#### B  85%  src/",
    "> README.md     ##.# KB│  ## B   1%  README.md",
    "",
  ]);
});
