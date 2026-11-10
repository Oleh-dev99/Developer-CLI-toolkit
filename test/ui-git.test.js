import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { createProgram } from "../src/cli.js";
import { git as realGit } from "../src/lib/git.js";
import { createApp } from "../src/tui/app.js";
import { describeCommands } from "../src/tui/commands.js";
import { createDashboard } from "../src/tui/dashboard.js";
import { hintsFor } from "../src/tui/keys.js";
import { createGitStatus, findRepository, parseStatus, statusRows } from "../src/tui/status.js";
import { changeOf, watchTree } from "../src/tui/watch.js";
import { fakeTerminal, makeRepo, makeTree, pressKeys, tempDir } from "./helpers.js";

// The Git status panel of `toolsmith ui` (src/tui/status.js), following
// changes with a folder watch (src/tui/watch.js), and its shortcuts to the git
// commands, on throwaway repositories in a temp directory.

const plain = (text) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
const key = { up: "\x1b[A", down: "\x1b[B", end: "\x1b[F", tab: "\t", enter: "\r", escape: "\x1b", space: " ", f5: "\x1b[15~" };
const commands = describeCommands(createProgram());
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const texts = (status) => statusRows(status).map((row) => row.text);

async function until(condition, what, timeout = 15000) {
  const start = Date.now();
  while (!(await condition())) {
    if (Date.now() - start > timeout) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await sleep(20);
  }
}

// What toolsmith and git run with: the repository's git settings only, and no
// real config file or global plugins.
function environment(t, repo) {
  const env = { ...process.env, ...repo.env, TOOLSMITH_CONFIG: join(tempDir(t), "none.json"), npm_config_prefix: join(tempDir(t), "prefix") };
  delete env.FORCE_COLOR;
  return env;
}

// The dashboard in a pretend terminal, in the repository `repo`. Call end()
// before the test ends: it waits for git to finish, and on Windows, a folder
// that git still runs in can't be deleted.
async function session(t, repo, { columns = 90, rows = 14, ...options } = {}) {
  const term = fakeTerminal(columns, rows);
  const view = createDashboard({ folder: "repo", commands, cwd: repo.dir, env: environment(t, repo), editor: null, ...options });
  const app = createApp({ ...term, view });
  app.start();
  t.after(() => app.stop());
  const ui = {
    app,
    view,
    press: (...keys) => pressKeys(term, ...keys),
    screen: () =>
      app
        .rows()
        .map((row) => plain(row).trimEnd())
        .join("\n"),
    // The Git status panel's rows, header first, as drawn.
    panel: () =>
      app
        .rows()
        .slice(1, -1)
        .map((row) => plain(row).split("│")[2]?.trimEnd()),
    until: (pattern, what = String(pattern)) => until(() => pattern.test(ui.screen()), what),
    end: async () => {
      app.stop();
      await app.done;
      await view.gitStatus.settled();
    },
  };
  await until(() => view.gitStatus.available !== null && !ui.screen().includes("Reading"), "the files and the git status");
  return ui;
}

test("parseStatus reads the branch, its upstream, renames, conflicts, and names with spaces or wide characters", () => {
  const output = [
    "# branch.oid 0123456789abcdef0123456789abcdef01234567",
    "# branch.head main",
    "# branch.upstream origin/main",
    "# branch.ab +2 -1",
    "1 M. N... 100644 100644 100644 1111111 2222222 src/app.js",
    "1 .M N... 100644 100644 100644 1111111 1111111 docs/read me.md",
    "1 MD N... 100644 100644 000000 1111111 2222222 both.txt",
    "2 R. N... 100644 100644 100644 1111111 1111111 R100 new name.txt",
    "old name.txt",
    "u UU N... 100644 100644 100644 100644 1111111 2222222 3333333 日本語.txt",
    "? 新しい file.txt",
    "? line\nbreak.txt",
    "? build/",
    "",
  ].join("\0");
  const status = parseStatus(output);
  assert.equal(status.branch, "main");
  assert.equal(status.commit, "0123456789abcdef0123456789abcdef01234567");
  assert.equal(status.detached, false);
  assert.equal(status.upstream, "origin/main");
  assert.equal(status.ahead, 2);
  assert.equal(status.behind, 1);
  assert.deepEqual(status.staged, [
    { path: "src/app.js", code: "M", kind: "modified" },
    { path: "both.txt", code: "M", kind: "modified" },
    { path: "new name.txt", from: "old name.txt", code: "R", kind: "renamed" },
  ]);
  assert.deepEqual(status.unstaged, [
    { path: "docs/read me.md", code: "M", kind: "modified" },
    { path: "both.txt", code: "D", kind: "deleted" },
  ]);
  assert.deepEqual(status.conflicts, [{ path: "日本語.txt", code: "UU", kind: "both modified" }]);
  assert.deepEqual(
    status.untracked.map((file) => file.path),
    ["新しい file.txt", "line\nbreak.txt", "build/"],
  );
  // A newline in a name is shown as "?", so it can't break the screen.
  assert.deepEqual(texts(status), [
    "main → origin/main",
    "2 ahead, 1 behind",
    "",
    "Conflicts (1)",
    "UU 日本語.txt",
    "",
    "Staged (3)",
    "M  src/app.js",
    "M  both.txt",
    "R  old name.txt → new name.txt",
    "",
    "Not staged (2)",
    "M  docs/read me.md",
    "D  both.txt",
    "",
    "Untracked (3)",
    "?  新しい file.txt",
    "?  line?break.txt",
    "?  build/",
  ]);
  // File rows know their path, from the repository's top.
  assert.equal(statusRows(status)[9].path, "new name.txt");
});

test("parseStatus: no commits yet, a detached HEAD, no upstream, a gone upstream, and nothing to commit", () => {
  assert.deepEqual(texts(parseStatus("# branch.oid (initial)\0# branch.head main\0")), ["main (no commits yet)", "no upstream", "", "Nothing to commit"]);
  const detached = parseStatus("# branch.oid 89abcdef0123456789abcdef0123456789abcdef\0# branch.head (detached)\0");
  assert.equal(detached.branch, null);
  assert.equal(detached.detached, true);
  assert.deepEqual(texts(detached), ["HEAD detached at 89abcde", "", "Nothing to commit"]);
  // An upstream that was deleted on the remote has no ahead and behind.
  const gone = parseStatus("# branch.oid 89abcdef0123456789abcdef0123456789abcdef\0# branch.head topic\0# branch.upstream origin/topic\0");
  assert.equal(gone.ahead, null);
  assert.deepEqual(texts(gone).slice(0, 2), ["topic → origin/topic", "its upstream is gone"]);
  assert.deepEqual(
    texts(parseStatus("# branch.oid 89abcdef0123456789abcdef0123456789abcdef\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +0 -0\0")).slice(0, 2),
    ["main → origin/main", "up to date"],
  );
});

test("a real repository: staged, unstaged and untracked files, a rename, and names with spaces or wide characters", async (t) => {
  const repo = makeRepo(t);
  writeFileSync(join(repo.dir, "old name.txt"), "old\n");
  writeFileSync(join(repo.dir, "notes.txt"), "notes\n");
  repo.git("add", ".");
  repo.git("commit", "--quiet", "-m", "add files");
  repo.git("mv", "old name.txt", "new name.txt");
  writeFileSync(join(repo.dir, "staged.txt"), "staged\n");
  repo.git("add", "staged.txt");
  writeFileSync(join(repo.dir, "notes.txt"), "more notes\n");
  writeFileSync(join(repo.dir, "日本語 file.txt"), "wide\n");

  const panel = createGitStatus({ cwd: repo.dir, env: repo.env });
  await panel.refresh();
  assert.equal(panel.available, true);
  assert.ok(existsSync(join(panel.top, "notes.txt")), panel.top);
  assert.deepEqual(texts(panel.status), [
    "main",
    "no upstream",
    "",
    "Staged (2)",
    "R  old name.txt → new name.txt",
    "A  staged.txt",
    "",
    "Not staged (1)",
    "M  notes.txt",
    "",
    "Untracked (1)",
    "?  日本語 file.txt",
  ]);

  // From a folder further down, paths are still from the top.
  mkdirSync(join(repo.dir, "sub"));
  const below = createGitStatus({ cwd: join(repo.dir, "sub"), env: repo.env });
  await below.refresh();
  assert.ok(texts(below.status).includes("M  notes.txt"));
  assert.equal(findRepository(join(repo.dir, "sub")), findRepository(repo.dir));
});

test("a real repository: ahead and behind its upstream, a detached HEAD, and a conflict", async (t) => {
  const repo = makeRepo(t);
  const status = async () => {
    const panel = createGitStatus({ cwd: repo.dir, env: repo.env });
    await panel.refresh();
    return panel.status;
  };
  // A local branch can be an upstream too.
  repo.git("checkout", "--quiet", "-b", "topic", "--track", "main");
  repo.commit("one");
  repo.commit("two");
  repo.git("checkout", "--quiet", "main");
  repo.commit("three");
  repo.git("checkout", "--quiet", "topic");
  assert.deepEqual(texts(await status()).slice(0, 2), ["topic → main", "2 ahead, 1 behind"]);

  repo.git("checkout", "--quiet", "--detach");
  assert.deepEqual(texts(await status()), [`HEAD detached at ${repo.git("rev-parse", "HEAD").slice(0, 7)}`, "", "Nothing to commit"]);

  repo.git("checkout", "--quiet", "main");
  writeFileSync(join(repo.dir, "shared.txt"), "base\n");
  repo.git("add", "shared.txt");
  repo.git("commit", "--quiet", "-m", "base");
  repo.git("checkout", "--quiet", "-b", "other");
  writeFileSync(join(repo.dir, "shared.txt"), "other\n");
  repo.git("commit", "--quiet", "-am", "other");
  repo.git("checkout", "--quiet", "main");
  writeFileSync(join(repo.dir, "shared.txt"), "main\n");
  repo.git("commit", "--quiet", "-am", "main");
  const merge = spawnSync("git", ["merge", "--quiet", "other"], { cwd: repo.dir, env: { ...process.env, ...repo.env } });
  assert.notEqual(merge.status, 0, "the merge should stop at the conflict");
  const conflicted = await status();
  assert.deepEqual(conflicted.conflicts, [{ path: "shared.txt", code: "UU", kind: "both modified" }]);
  assert.deepEqual(texts(conflicted).slice(2), ["", "Conflicts (1)", "UU shared.txt"]);
});

test("the panel never runs two git commands at once: refreshes asked for meanwhile become one more", async (t) => {
  let running = 0;
  let most = 0;
  let statusCalls = 0;
  const run = async (args) => {
    running++;
    most = Math.max(most, running);
    await sleep(30);
    running--;
    if (args[0] === "rev-parse") {
      return "/repo";
    }
    statusCalls++;
    return `# branch.oid (initial)\0# branch.head main\0? file${statusCalls}.txt\0`;
  };
  // The folder must look like a repository for git to be run.
  const panel = createGitStatus({ cwd: makeTree(t, { ".git/": "" }), run });
  const first = panel.refresh();
  for (let i = 0; i < 5; i++) {
    panel.refresh();
  }
  await first;
  assert.equal(most, 1);
  assert.equal(statusCalls, 2);
  // The second read is the one shown.
  assert.deepEqual(texts(panel.status).slice(-1), ["?  file2.txt"]);
  // Once stopped, nothing is read.
  panel.stop();
  await panel.refresh();
  assert.equal(statusCalls, 2);
});

test("the panel is hidden, and its space shared, outside a repository, when git doesn't see one, and without git", async (t) => {
  let calls = 0;
  const counting = async (...args) => {
    calls++;
    return realGit(...args);
  };
  // Not a repository: git isn't even run.
  const outside = createDashboard({ cwd: tempDir(t), commands, editor: null, runGit: counting, watch: false });
  assert.deepEqual(
    outside.panels().map((panel) => panel.title),
    ["Commands", "Files"],
  );
  outside.dispose();
  assert.equal(calls, 0);

  // A .git folder that git doesn't take for a repository.
  const fake = makeTree(t, { ".git/": "", "a.txt": "a" });
  const fakeView = createDashboard({ cwd: fake, env: { GIT_CEILING_DIRECTORIES: dirname(fake) }, commands, editor: null, watch: false });
  await until(() => fakeView.gitStatus.available === false, "the status");
  assert.equal(fakeView.panels().length, 2);
  fakeView.dispose();

  // git isn't installed: its folder isn't on the PATH.
  const repo = makeRepo(t);
  writeFileSync(join(repo.dir, "a.txt"), "a");
  const env = Object.fromEntries(Object.entries(environment(t, repo)).filter(([name]) => name.toUpperCase() !== "PATH"));
  env.PATH = tempDir(t);
  const ui = await session(t, repo, { env, columns: 60, rows: 12, watch: false });
  assert.equal(ui.view.gitStatus.available, false);
  assert.match(ui.screen().split("\n")[1], /^ Commands +1\/\d+ │ Files +1\/1$/);
  // Tab goes round the two panels that are left.
  await ui.press(key.tab, key.tab);
  assert.equal(ui.view.context(), "panels");
  await ui.end();
});

test("the panel at 90x14: Tab focuses it, keys move, Enter shows a file, and F5 or R read the status again", async (t) => {
  const repo = makeRepo(t);
  writeFileSync(join(repo.dir, "tracked.txt"), "one\n");
  repo.git("add", "tracked.txt");
  repo.git("commit", "--quiet", "-m", "add tracked.txt");
  writeFileSync(join(repo.dir, "tracked.txt"), "one\ntwo\n");
  writeFileSync(join(repo.dir, "日本語 file.txt"), "こんにちは\n");
  mkdirSync(join(repo.dir, "build"));
  writeFileSync(join(repo.dir, "build", "out.txt"), "out\n");
  const ui = await session(t, repo, { watch: false });
  assert.deepEqual(ui.panel(), [
    " Git status               1/9",
    "> main",
    "  no upstream",
    "",
    "  Not staged (1)",
    "  M  tracked.txt",
    "",
    "  Untracked (2)",
    "  ?  build/",
    "  ?  日本語 file.txt",
    "",
    "",
  ]);
  await ui.press(key.tab, key.tab);
  assert.equal(ui.view.context(), "git");
  assert.equal(ui.screen().split("\n").at(-1).trim(), hintsFor("git"));

  // Enter on a row that isn't a file does nothing; on a file, it shows it.
  await ui.press(key.enter);
  assert.equal(ui.view.context(), "git");
  await ui.press("j", "j", "j", "j", key.enter);
  await ui.until(/one\ntwo/, "the preview");
  assert.equal(ui.view.context(), "preview");
  assert.match(ui.screen(), /\n tracked\.txt +8 B/);
  await ui.press(key.escape, key.end, key.enter);
  await ui.until(/こんにちは/, "the preview");
  await ui.press(key.escape, key.up, key.enter);
  // A folder that git shows as one row isn't a file to show.
  assert.equal(ui.view.context(), "git");
  assert.match(ui.screen(), /build\/ is a folder; the Files panel shows what's in it/);

  // Nothing is watched here, so F5 and R read the status again.
  repo.git("add", "tracked.txt");
  await ui.press(key.f5);
  await until(() => ui.panel().includes("  Staged (1)"), "the new status");
  writeFileSync(join(repo.dir, "later.txt"), "later\n");
  await ui.press("R");
  await until(() => ui.panel().includes("  Untracked (3)"), "the new status");
  await ui.end();
});

test("what the watcher counts as a change: node_modules, git's objects and lock files are left out", () => {
  assert.deepEqual(changeOf("src/app.js"), { files: true });
  assert.deepEqual(changeOf(""), { files: true });
  assert.equal(changeOf("node_modules/x/index.js"), null);
  assert.equal(changeOf("packages/a/node_modules"), null);
  assert.deepEqual(changeOf("my_node_modules.txt"), { files: true });
  assert.deepEqual(changeOf(".git/index"), { files: false });
  assert.deepEqual(changeOf(".git/refs/heads/main"), { files: false });
  assert.deepEqual(changeOf(".git"), { files: false });
  assert.equal(changeOf(".git/objects/ab/cdef"), null);
  assert.equal(changeOf(".git/index.lock"), null);
  assert.deepEqual(changeOf(".github/workflows/test.yml"), { files: true });
  // Only changes in the folder the Files panel shows change its sizes.
  assert.deepEqual(changeOf("docs/guide.md", "docs/"), { files: true });
  assert.deepEqual(changeOf("docs", "docs/"), { files: true });
  assert.deepEqual(changeOf("src/app.js", "docs/"), { files: false });
  assert.deepEqual(changeOf("docs-old/x.md", "docs/"), { files: false });
});

test("the watcher groups a burst of changes into one, ignores node_modules, and stops when closed", async (t) => {
  const dir = makeTree(t, { "node_modules/x/index.js": "x" });
  const calls = [];
  const watcher = watchTree(dir, { onChange: (change) => calls.push(change), onError: (err) => assert.fail(err), quiet: 300, longest: 400 });
  try {
    for (let i = 0; i < 20; i++) {
      writeFileSync(join(dir, `file${i}.txt`), "x");
    }
    await until(() => calls.length > 0, "a change");
    await sleep(700);
    assert.deepEqual(calls, [{ files: true, git: true }]);

    writeFileSync(join(dir, "node_modules", "x", "index.js"), "changed");
    writeFileSync(join(dir, "node_modules", "new.js"), "new");
    await sleep(700);
    assert.equal(calls.length, 1, "changes in node_modules count");

    // Changes that don't stop still come through, every `longest` ms or so.
    const writing = setInterval(() => writeFileSync(join(dir, "busy.txt"), String(Date.now())), 50);
    await sleep(1500);
    clearInterval(writing);
    assert.ok(calls.length >= 3, `${calls.length - 1} calls while busy`);
    await sleep(700);
  } finally {
    watcher.close();
  }
  await sleep(400);
  const before = calls.length;
  writeFileSync(join(dir, "after.txt"), "x");
  await sleep(700);
  assert.equal(calls.length, before, "a change after close");
});

test("changes outside show up by themselves: the git status and the Files panel's sizes, with git never running twice at once", async (t) => {
  const repo = makeRepo(t);
  let running = 0;
  let most = 0;
  let statusCalls = 0;
  const runGit = async (args, options) => {
    running++;
    most = Math.max(most, running);
    if (args.includes("status")) {
      statusCalls++;
    }
    try {
      return await realGit(args, options);
    } finally {
      running--;
    }
  };
  const ui = await session(t, repo, { runGit });
  await until(() => ui.view.tree.totalSize() !== undefined, "the sizes");
  const size = ui.view.tree.totalSize();
  await sleep(400);
  const before = statusCalls;

  for (let i = 0; i < 20; i++) {
    writeFileSync(join(repo.dir, `new${String(i).padStart(2, "0")}.txt`), "x");
  }
  await until(() => ui.panel().includes("  Untracked (20)"), "the new files in the git status");
  await until(() => ui.view.tree.totalSize() === size + 20, "the new size");
  await sleep(500);
  assert.equal(most, 1, "two git commands ran at once");
  assert.ok(statusCalls - before <= 3, `${statusCalls - before} reads for one burst`);

  // Staging changes only .git, and shows too.
  repo.git("add", "new00.txt");
  await until(() => ui.panel().includes("  Staged (1)"), "the staged file");

  // After quitting, nothing is watched or read.
  await ui.end();
  const after = statusCalls;
  writeFileSync(join(repo.dir, "after-quit.txt"), "x");
  await sleep(700);
  assert.equal(statusCalls, after);
});

test("c shows recent commits, through the command runner", async (t) => {
  const repo = makeRepo(t);
  repo.commit("feat: add the git panel");
  const ui = await session(t, repo, { watch: false });
  await ui.press(key.tab, key.tab, "c");
  await ui.until(/exit code 0 after/, "git recent");
  assert.match(ui.screen(), /\$ toolsmith git recent/);
  assert.match(ui.screen(), /add the git panel/);
  assert.equal(ui.view.context(), "output");
  await ui.press(key.escape);
  assert.equal(ui.view.context(), "git");
  await ui.end();
});

test("b shows a --dry-run preview of the merged branches first, and Enter goes on to the form, with the --yes rule", async (t) => {
  const repo = makeRepo(t);
  repo.git("branch", "merged-topic");
  repo.git("checkout", "--quiet", "-b", "wip");
  writeFileSync(join(repo.dir, "wip.txt"), "wip\n");
  repo.git("add", "wip.txt");
  repo.git("commit", "--quiet", "-m", "unfinished");
  repo.git("checkout", "--quiet", "main");
  const branches = () => repo.git("branch", "--format=%(refname:short)").split("\n");

  const ui = await session(t, repo, { watch: false });
  await ui.press(key.tab, key.tab, "b");
  await ui.until(/exit code 0 after/, "the dry run");
  const screen = ui.screen();
  assert.match(screen, /\$ toolsmith git clean-branches --dry-run/);
  assert.match(screen, /Merged into main:\n {2}merged-topic\n/);
  assert.match(screen, /Dry run: nothing was deleted\./);
  assert.doesNotMatch(screen, /wip/);
  assert.equal(ui.view.context(), "dryrun");
  assert.equal(screen.split("\n").at(-1).trim(), hintsFor("dryrun"));
  assert.deepEqual(branches(), ["main", "merged-topic", "wip"]);

  // Enter goes on to the form; it can ask, so it needs --yes here.
  await ui.press(key.enter);
  assert.equal(ui.view.context(), "form");
  assert.equal(ui.view.state.form.command.name, "git clean-branches");
  await ui.press(key.enter);
  assert.equal(ui.view.context(), "form");
  assert.match(ui.view.state.form.message, /Tick --yes/);
  for (let i = 0; i < 10 && ui.view.state.form.list.selected()?.flag !== "--yes"; i++) {
    await ui.press(key.down);
  }
  await ui.press(key.space, key.enter);
  await ui.until(/exit code 0 after/, "the deletion");
  assert.match(ui.screen(), /\$ toolsmith git clean-branches --yes/);
  assert.match(ui.screen(), /Deleted 1 branch\./);
  assert.deepEqual(branches(), ["main", "wip"]);
  // Esc goes back to the form, as for any command run from one, and Esc
  // again to the panel.
  await ui.press(key.escape);
  assert.equal(ui.view.context(), "form");
  await ui.press(key.escape);
  assert.equal(ui.view.context(), "git");
  await ui.end();
});

test("b in a repository without main or master shows the error, and Enter doesn't go on", async (t) => {
  const repo = makeRepo(t, { branch: "trunk" });
  const ui = await session(t, repo, { watch: false });
  await ui.press(key.tab, key.tab, "b");
  await ui.until(/exit code 1 after/, "the dry run");
  assert.match(ui.screen(), /found no main or master branch/);
  assert.equal(ui.view.context(), "output");
  await ui.press(key.enter);
  assert.equal(ui.view.context(), "output");
  await ui.press(key.escape);
  assert.equal(ui.view.context(), "git");
  await ui.end();
});

test("the Git status panel uses only the 16 basic colors, never magenta", async (t) => {
  const repo = makeRepo(t);
  writeFileSync(join(repo.dir, "new.txt"), "new\n");
  const ui = await session(t, repo, { watch: false });
  await ui.press(key.tab, key.tab);
  const codes = Array.from(ui.app.rows().join("").matchAll(/\x1b\[([0-9;]*)m/g), ([, list]) => list.split(";").map(Number)).flat();
  assert.deepEqual(
    codes.filter((n) => ![1, 7, 22, 27, 33, 36, 39].includes(n)),
    [],
  );
  await ui.end();
});
