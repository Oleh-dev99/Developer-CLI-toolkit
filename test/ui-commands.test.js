import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";
import { createProgram } from "../src/cli.js";
import { formatDuration } from "../src/lib/format.js";
import { quoteArgument, quoteCommandLine, splitWords } from "../src/lib/quote.js";
import { loadPlugins } from "../src/plugins.js";
import { createApp } from "../src/tui/app.js";
import { describeCommands } from "../src/tui/commands.js";
import { createDashboard } from "../src/tui/dashboard.js";
import { createForm } from "../src/tui/form.js";
import { runCommand } from "../src/tui/runner.js";
import { paints } from "../src/tui/screen.js";
import { fakeTerminal, makeTree, pluginPackage, pressKeys, runCli, screenTerminalEnv, tempDir } from "./helpers.js";

// The command menu of `toolsmith ui`: the commands it lists (src/tui/commands.js),
// their forms (src/tui/form.js), running them (src/tui/runner.js), and all of
// it driven with keys, with a plugin from a temp node_modules.

const { name: packageName, version } = createRequire(import.meta.url)("../package.json");
const plain = (text) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
const builtIn = describeCommands(createProgram());
const find = (commands, name) => commands.find((command) => command.name === name);
const field = (form, label) => form.fields.find((candidate) => candidate.label === label);
const key = { up: "\x1b[A", down: "\x1b[B", enter: "\r", escape: "\x1b", ctrlC: "\x03" };

// A plugin with commands that print lines (and fail, with --fail), wait with
// a helper process of their own, and can ask (they have --yes).
const fixturePlugin = `import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

export function register(api) {
  api
    .command("fixture-count")
    .description("prints numbered lines")
    .argument("<n>", "how many")
    .option("--fail", "fail at the end")
    .action((n, options) => {
      for (let i = 1; i <= Number(n); i++) console.log("line " + i);
      if (options.fail) {
        console.error("failing on purpose");
        process.exitCode = 3;
      }
    });
  api
    .command("fixture-wait")
    .description("starts a helper process, and waits")
    .argument("<file>", "where to write the process ids")
    .action((file) => {
      // On Windows, Node ends the processes it starts along with itself (they
      // share a job object), but programs that other programs start, like
      // npm's, don't; detached, the helper is like them. Elsewhere it stays
      // in the command's process group, which cancelling ends.
      const helper = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", detached: process.platform === "win32" });
      writeFileSync(file, JSON.stringify({ main: process.pid, helper: helper.pid }));
      console.log("waiting");
      setInterval(() => {}, 1000);
    });
  api
    .command("fixture-confirm")
    .description("asks before it acts")
    .option("-y, --yes", "don't ask")
    .action(() => console.log("confirmed"));
}
`;

// A project with the fixture plugin in its node_modules, and an environment
// for running toolsmith there without the real config file or global plugins.
function project(t) {
  const cwd = makeTree(t, pluginPackage("toolsmith-plugin-fixture", fixturePlugin));
  const env = { ...process.env, TOOLSMITH_CONFIG: join(tempDir(t), "none.json"), npm_config_prefix: join(tempDir(t), "prefix") };
  delete env.FORCE_COLOR;
  return { cwd, env };
}

// The commands in `cwd`, plugins loaded the way toolsmith ui loads them.
async function commandsIn({ cwd, env }) {
  const program = createProgram();
  const saved = process.env.npm_config_prefix;
  process.env.npm_config_prefix = env.npm_config_prefix;
  try {
    await loadPlugins(program, {}, { enabled: {}, version, packageName, all: true, quiet: true, cwd });
  } finally {
    if (saved === undefined) {
      delete process.env.npm_config_prefix;
    } else {
      process.env.npm_config_prefix = saved;
    }
  }
  return describeCommands(program);
}

async function until(condition, what, timeout = 20000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
};

// A file for fixture-wait's process ids. When the test ends, whatever those
// processes are, they're ended, so that a failing test leaves none behind.
function pidFile(t) {
  const file = join(tempDir(t), "pids.json");
  t.after(() => {
    if (existsSync(file)) {
      for (const pid of Object.values(JSON.parse(readFileSync(file, "utf8")))) {
        try {
          process.kill(pid);
        } catch {
          // Ended already.
        }
      }
    }
  });
  return file;
}

// The dashboard in a pretend terminal, in a project with the fixture plugin.
async function session(t, columns = 80, rows = 20) {
  const where = project(t);
  const term = fakeTerminal(columns, rows);
  const view = createDashboard({ folder: "project", commands: await commandsIn(where), ...where });
  const app = createApp({ ...term, view });
  app.start();
  const ui = {
    app,
    view,
    press: (...keys) => pressKeys(term, ...keys),
    type: (text) => pressKeys(term, ...text),
    // The screen as text: rows without the spaces that pad them, so that
    // patterns can use "\n" for the end of a row.
    screen: () =>
      app
        .rows()
        .map((row) => plain(row).trimEnd())
        .join("\n"),
    // The screen's text as one line, for messages that wrap.
    text: () => ui.screen().replace(/\s+/g, " "),
    until: (pattern, what = String(pattern)) => until(() => pattern.test(ui.screen()), what),
    // Opens the form of the command `name`, found with the filter.
    open: async (name) => {
      await ui.press("/");
      await ui.type(name);
      await ui.press(key.enter, key.enter);
      assert.equal(view.context(), "form");
      assert.match(app.rows()[1], new RegExp(`toolsmith ${name} `));
    },
  };
  t.after(() => app.stop());
  return ui;
}

test("the Commands panel offers every built-in command that runs, with its --help description", () => {
  assert.deepEqual(
    builtIn.map((command) => command.name),
    [
      "config",
      "dupes",
      "git clean-branches",
      "git recent",
      "git template list",
      "git template show",
      "git template use",
      "git template unset",
      "hello",
      "new",
      "plugins",
      "plugins enable",
      "plugins disable",
      "rename",
      "size",
    ],
  );
  const git = createProgram().commands.find((command) => command.name() === "git");
  assert.equal(find(builtIn, "git recent").description, git.commands.find((command) => command.name() === "recent").description());
  // The commands that can ask questions are the ones with --yes.
  assert.deepEqual(
    builtIn.filter((command) => command.asks).map((command) => command.name),
    ["git clean-branches", "new"],
  );
});

test("plugin commands are offered too, from a plugin loaded the way the CLI loads them", async (t) => {
  const commands = await commandsIn(project(t));
  const fixture = commands.slice(builtIn.length);
  assert.deepEqual(
    fixture.map((command) => [command.name, command.description]),
    [
      ["fixture-count", "prints numbered lines"],
      ["fixture-wait", "starts a helper process, and waits"],
      ["fixture-confirm", "asks before it acts"],
    ],
  );
  assert.equal(find(commands, "fixture-confirm").asks, true);
});

test("a form has a field for each argument and option, with defaults and choices", () => {
  const size = createForm(find(builtIn, "size"));
  assert.deepEqual(
    size.fields.map((each) => [each.label, each.kind, each.defaultText]),
    [
      ["[path]", "text", ""],
      ["--depth <n>", "text", "1"],
      ["--top <n>", "text", "10"],
      ["--files-only", "check", ""],
      ["--folders-only", "check", ""],
      ["--all", "check", ""],
      ["--json", "check", ""],
    ],
  );
  const newForm = createForm(find(builtIn, "new"));
  assert.equal(field(newForm, "--no-git").kind, "check");

  // A choice goes from none through the choices, and back.
  const recent = createForm(find(builtIn, "git recent"));
  recent.select(field(recent, "--group <by>"));
  const chosen = () => recent.args().join(" ");
  assert.equal(chosen(), "git recent");
  recent.toggle();
  assert.equal(chosen(), "git recent --group author");
  recent.toggle();
  assert.equal(chosen(), "git recent --group type");
  recent.toggle();
  assert.equal(chosen(), "git recent");
  recent.toggle(-1);
  assert.equal(chosen(), "git recent --group type");
});

test("a form checks values the way the command does, with the command's own messages", () => {
  const problems = (name, values) => {
    const form = createForm(find(builtIn, name));
    for (const [label, value] of Object.entries(values)) {
      const target = field(form, label);
      target[target.kind === "check" ? "checked" : "text"] = value;
    }
    return form.problems().map((problem) => problem.message);
  };
  assert.deepEqual(problems("size", { "--top <n>": "0" }), ["--top <n>: Use a whole number of 1 or more."]);
  assert.deepEqual(problems("dupes", { "--min-size <size>": "big" }), ["--min-size <size>: Use a number with an optional unit, like 500KB or 5MB."]);
  assert.deepEqual(problems("rename", {}), ["<find> is required", "<replace> is required"]);
  assert.deepEqual(problems("new", { "[directory]": "my-tool" }), ["fill in [template] too, or leave [directory] empty"]);
  assert.deepEqual(problems("git recent", { "--markdown": true, "--json": true }), ["--markdown can't be used with --json"]);
  assert.deepEqual(problems("git recent", { "--author <name>": "Ada", "--mine": true }), ["--author <name> can't be used with --mine"]);
  assert.deepEqual(problems("size", { "--top <n>": "3", "--depth <n>": "all" }), []);
});

test("the command line puts arguments in order, and keeps values that start with - from looking like options", () => {
  const form = createForm(find(builtIn, "rename"));
  field(form, "<find>").text = "IMG_";
  field(form, "<replace>").text = "photo ";
  field(form, "[paths...]").text = 'a "b c"';
  field(form, "--dry-run").checked = true;
  assert.deepEqual(form.args(), ["rename", "IMG_", "photo ", "a", "b c", "--dry-run"]);

  field(form, "<find>").text = "-x";
  assert.deepEqual(form.args(), ["rename", "--dry-run", "--", "-x", "photo ", "a", "b c"]);

  const newForm = createForm(find(builtIn, "new"));
  field(newForm, "--name <name>").text = "-weird";
  assert.deepEqual(newForm.args(), ["new", "--name=-weird"]);
});

test("command lines are quoted for PowerShell on Windows and for sh elsewhere", () => {
  const cases = [
    // argument, sh, PowerShell
    ["plain-word_1.2/x:y=z+", "plain-word_1.2/x:y=z+", "plain-word_1.2/x:y=z+"],
    ["two words", "'two words'", "'two words'"],
    ["it's", "'it'\\''s'", "'it''s'"],
    ["$HOME", "'$HOME'", "'$HOME'"],
    ["", "''", "''"],
    ["@splat", "'@splat'", "'@splat'"],
    ["a,b", "'a,b'", "'a,b'"],
    ["C:\\My Files", "'C:\\My Files'", "'C:\\My Files'"],
    ["‘quoted’", "'‘quoted’'", "'‘‘quoted’’'"],
  ];
  for (const [argument, sh, powershell] of cases) {
    assert.equal(quoteArgument(argument, "linux"), sh, argument);
    assert.equal(quoteArgument(argument, "darwin"), sh, argument);
    assert.equal(quoteArgument(argument, "win32"), powershell, argument);
  }
  assert.equal(quoteCommandLine(["hello", "Ada Lovelace"], "linux"), "hello 'Ada Lovelace'");
  assert.deepEqual(splitWords('a "b c"  d'), ["a", "b c", "d"]);
  assert.deepEqual(splitWords("   "), []);
  assert.deepEqual(splitWords('"not closed'), ["not closed"]);
  assert.deepEqual([350, 1234, 65000].map(formatDuration), ["350 ms", "1.2 s", "1 min 5 s"]);
});

test("a command runs as a child process of toolsmith, and its output, exit code and time are shown", async (t) => {
  const where = project(t);
  const run = runCommand(["hello", "Ada"], where);
  await until(() => !run.running, "the end");
  const lines = run.output.render(60, 3).map((line) => line.trimEnd());
  assert.deepEqual(lines.slice(0, 2), ["Hello, Ada!", ""]);
  assert.match(lines[2], /^\[exit code 0 after \d+(\.\d)? m?s\]$/);
  assert.match(run.status(), /^exit code 0 after /);
});

test("stderr is bold rather than colored, and a failing command's exit code is shown", async (t) => {
  const run = runCommand(["fixture-count", "2", "--fail"], project(t));
  await until(() => !run.running, "the end");
  assert.match(run.status(), /^exit code 3 after /);
  for (const color of [true, false]) {
    const rows = run.output.render(40, 5, { paint: paints(color) }).slice(0, 3);
    // stdout and stderr come through pipes of their own, so their lines can
    // arrive in either order.
    assert.deepEqual(rows.map((row) => plain(row).trimEnd()).sort(), ["failing on purpose", "line 1", "line 2"]);
    for (const row of rows) {
      assert.equal(row.startsWith("\x1b[1m"), plain(row).startsWith("failing"), `only stderr should be bold: ${JSON.stringify(row)}`);
    }
    assert.ok(!rows.join("").match(/\x1b\[(3\d|9\d)m/), "no colors in output");
  }
});

test("long output follows its end, and can be scrolled back", async (t) => {
  const run = runCommand(["fixture-count", "300"], project(t));
  await until(() => !run.running, "the end");
  const rows = run.output.render(40, 4).map((row) => row.trimEnd());
  assert.equal(rows[0], "line 299");
  assert.match(rows[3], /^\[exit code 0/);
  run.output.first();
  assert.equal(run.output.render(40, 4)[0].trimEnd(), "line 1");
});

test("cancelling ends the command and the programs it started, on every system", async (t) => {
  const where = project(t);
  const file = pidFile(t);
  const run = runCommand(["fixture-wait", file], where);
  await until(() => existsSync(file) && run.output.count() > 0, "the helper");
  const { main, helper } = JSON.parse(readFileSync(file, "utf8"));
  assert.ok(alive(main) && alive(helper));
  run.cancel();
  await until(() => !run.running, "the end");
  assert.match(run.status(), /^cancelled after /);
  await until(() => !alive(main) && !alive(helper), "both processes to end");
});

test("Enter in the Commands panel opens a form; Enter runs it, and the output panel shows how it ended", async (t) => {
  const ui = await session(t);
  await ui.open("hello");
  assert.match(ui.screen(), /> \[name\] +_ \(default: world\)/);
  await ui.type("Ada");
  assert.match(ui.screen(), /\$ toolsmith hello Ada\n/);
  await ui.press(key.enter);
  await ui.until(/exit code 0 after/);
  assert.match(ui.screen(), /\$ toolsmith hello Ada +exit code 0 after .*\nHello, Ada!\n/);
  // How it ended is also the output's last line, readable without colors.
  assert.match(ui.screen(), /\n\[exit code 0 after [^\]]+\]\n/);
  assert.equal(ui.view.context(), "output");
  await ui.press(key.escape);
  assert.equal(ui.view.context(), "form");
  assert.match(ui.screen(), /\[name\] +Ada_/);
  await ui.press(key.escape);
  assert.equal(ui.view.context(), "panels");
});

test("a form says what's wrong in the command's own words, and goes to that field", async (t) => {
  const ui = await session(t);
  await ui.open("size");
  await ui.press(key.down, key.down);
  await ui.type("0");
  await ui.press(key.up, key.up, key.enter);
  assert.equal(ui.view.context(), "form");
  assert.match(ui.screen(), /! --top <n>: Use a whole number of 1 or more\./);
  assert.match(ui.screen(), /> --top <n> +0_/);
  // Changing the field clears the message.
  await ui.press("\x7f");
  assert.doesNotMatch(ui.screen(), /! --top/);
});

test("a command that can ask runs only with --yes ticked; otherwise the form says why", async (t) => {
  const ui = await session(t, 80, 20);
  await ui.open("fixture-confirm");
  await ui.press(key.enter);
  assert.equal(ui.view.state.run, null);
  assert.match(
    ui.text(),
    / ! toolsmith fixture-confirm can ask questions before it acts, and the dashboard can't answer them\. Tick --yes to run it without asking, or run it in a terminal of its own\. /,
  );

  await ui.press(" ");
  assert.match(ui.screen(), /> --yes +\[x\]/);
  assert.match(ui.screen(), /\$ toolsmith fixture-confirm --yes\n/);
  await ui.press(key.enter);
  await ui.until(/exit code 0 after/);
  assert.match(ui.screen(), /\nconfirmed\n/);
});

test("Esc or Ctrl+C cancels a running command, its helper process too, and the dashboard stays open", async (t) => {
  const ui = await session(t);
  const file = pidFile(t);
  await ui.open("fixture-wait");
  await ui.type(file);
  for (const cancel of [key.escape, key.ctrlC]) {
    await ui.press(key.enter);
    await ui.until(/\nwaiting\n/);
    assert.equal(ui.view.context(), "running");
    assert.match(ui.screen(), /running, /);
    const { main, helper } = JSON.parse(readFileSync(file, "utf8"));
    await ui.press(cancel);
    await ui.until(/cancelled after/);
    await until(() => !alive(main) && !alive(helper), "both processes to end");
    assert.equal(ui.view.context(), "output");
    // Back to the form, for the next round.
    await ui.press(key.escape);
  }
  const ended = await Promise.race([ui.app.done.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 50))]);
  assert.equal(ended, false, "Ctrl+C on a running command shouldn't quit the dashboard");
});

test("quitting the dashboard while a command runs stops the command and its helper", async (t) => {
  const ui = await session(t);
  const file = pidFile(t);
  await ui.open("fixture-wait");
  await ui.type(file);
  await ui.press(key.enter);
  await ui.until(/\nwaiting\n/);
  const { main, helper } = JSON.parse(readFileSync(file, "utf8"));
  ui.app.stop();
  await until(() => !alive(main) && !alive(helper), "both processes to end");
  await until(() => !ui.view.state.run.running, "the command's process to close");
});

test("the form and the output use only the 16 basic colors, never magenta", async (t) => {
  const ui = await session(t);
  await ui.open("fixture-count");
  await ui.press(key.enter);
  await ui.type("3");
  const form = ui.app.rows().join("");
  await ui.press(key.enter);
  await ui.until(/exit code 0 after/);
  for (const text of [form, ui.app.rows().join("")]) {
    const codes = Array.from(text.matchAll(/\x1b\[([0-9;]*)m/g), ([, list]) => list.split(";").map(Number)).flat();
    assert.deepEqual(
      codes.filter((n) => ![1, 7, 22, 27, 33, 36, 39].includes(n)),
      [],
    );
  }
});

test("toolsmith ui lists plugin commands from the project's node_modules", async (t) => {
  const { cwd, env } = project(t);
  // Filter the Commands panel for the plugin's commands, then quit.
  const { stdout, stderr, code } = await runCli(["ui"], {
    cwd,
    env: { ...screenTerminalEnv, TOOLSMITH_CONFIG: env.TOOLSMITH_CONFIG, npm_config_prefix: env.npm_config_prefix },
    input: "/fixture\rq",
  });
  assert.equal(code, 0, stderr);
  const screen = plain(stdout);
  assert.match(screen, / Commands \/fixture /);
  for (const name of ["fixture-count", "fixture-wait", "fixture-confirm"]) {
    assert.ok(screen.includes(name), name);
  }
});
