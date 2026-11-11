import assert from "node:assert/strict";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { findProject, loadDoctorConfig } from "../src/doctor/config.js";
import { doctor, jsonReport, listChecks, markdownReport, textReport } from "../src/doctor/index.js";
import { isOnline } from "../src/doctor/online.js";
import { applySettings, chooseChecks, runChecks } from "../src/doctor/run.js";
import { isc, mit } from "./fixtures/licenses.js";
import { helpListing, loadedAtStart, makeTree, runCli, tempDir } from "./helpers.js";

// toolsmith doctor: the command, and its check framework (src/doctor/),
// with checks of the tests' own. doctor-license.test.js has the license check.

const root = fileURLToPath(new URL("..", import.meta.url));
const packageJson = (fields) => `${JSON.stringify({ name: "demo", version: "1.0.0", ...fields }, null, 2)}\n`;
const sameFolder = (a, b) => realpathSync.native(a) === realpathSync.native(b);

// A check for the tests: `run` gives its findings.
const fake = (name, run, extra = {}) => ({ name, description: `the ${name} check`, run, ...extra });
const finds = (name, ...findings) => fake(name, async () => findings);

// A project in a temp folder; the toolsmith.json makes it the project, so the
// search for one never goes above the temp folder.
const project = (t, settings = {}) => makeTree(t, { "toolsmith.json": JSON.stringify(settings) });

test("toolsmith doctor is a command, and only it loads doctor's code, when it runs", async () => {
  assert.ok((await helpListing()).commands.includes("doctor"));
  const files = loadedAtStart();
  assert.ok(files.includes("src/commands/doctor.js"), "the walk didn't reach the doctor command");
  assert.deepEqual(
    files.filter((file) => file.startsWith("src/doctor/")),
    [],
  );
  assert.match(readFileSync(join(root, "src", "commands", "doctor.js"), "utf8"), /await import\("\.\.\/doctor\/index\.js"\)/);
});

test("a project in order: no problems, exit code 0, in text, JSON and Markdown", async (t) => {
  const cwd = makeTree(t, { "package.json": packageJson({ license: "MIT" }), LICENSE: mit });
  const text = await runCli(["doctor"], { cwd });
  assert.equal(text.stderr, "");
  assert.equal(text.stdout, "No problems found. Checked the current folder with 1 check: license.\n0 errors, 0 warnings, 0 info\n");
  assert.equal(text.code, 0);

  const json = await runCli(["doctor", "--json"], { cwd });
  assert.equal(json.code, 0);
  const report = JSON.parse(json.stdout);
  assert.ok(sameFolder(report.root, cwd));
  assert.deepEqual(
    { ...report, root: undefined },
    { root: undefined, config: null, failOn: "error", failed: false, checks: ["license"], skipped: [], findings: [], summary: { errors: 0, warnings: 0, info: 0, ignored: 0 } },
  );

  const markdown = await runCli(["doctor", "--markdown"], { cwd });
  assert.equal(markdown.code, 0);
  assert.equal(markdown.stdout, "## toolsmith doctor\n\nNo problems found. Checked with 1 check: license.\n\n**0 errors, 0 warnings, 0 info**\n");
});

test("an error ends the run with exit code 1; the report is grouped by severity, then by check, and ends with the summary", async (t) => {
  const cwd = makeTree(t, { "package.json": packageJson({ license: "MIT" }), LICENSE: isc, "COPYING.md": "Terms of my own.\n" });
  const { stdout, stderr, code } = await runCli(["doctor"], { cwd });
  assert.equal(stderr, "");
  assert.equal(
    stdout,
    [
      "Errors",
      "",
      "  license",
      '    package.json:4: "license" in package.json is MIT, but LICENSE has the ISC license text',
      '      Fix: Make them agree: set "license" to "ISC", or put the MIT license text in LICENSE.',
      "",
      "Warnings",
      "",
      "  license",
      "    COPYING.md: can't tell which license COPYING.md has: its text isn't one that toolsmith knows",
      '      Fix: If it\'s meant to be a common license, use the standard MIT text, from https://spdx.org/licenses/MIT.html; if it\'s a license of your own, set "license" in package.json to "SEE LICENSE IN COPYING.md".',
      "",
      "Checked the current folder with 1 check: license.",
      "1 error, 1 warning, 0 info",
      "",
    ].join("\n"),
  );
  assert.equal(code, 1);

  const json = await runCli(["doctor", "--json"], { cwd });
  assert.equal(json.code, 1);
  const report = JSON.parse(json.stdout);
  assert.equal(report.failed, true);
  assert.deepEqual(report.summary, { errors: 1, warnings: 1, info: 0, ignored: 0 });
  assert.deepEqual(
    report.findings.map(({ check, severity, file, line }) => ({ check, severity, file, line })),
    [
      { check: "license", severity: "error", file: "package.json", line: 4 },
      { check: "license", severity: "warning", file: "COPYING.md", line: undefined },
    ],
  );
  // A finding without a line has none in the JSON.
  assert.ok(!("line" in report.findings[1]));

  const markdown = await runCli(["doctor", "--markdown"], { cwd });
  assert.equal(markdown.code, 1);
  assert.match(markdown.stdout, /^## toolsmith doctor\n\n### Errors\n\n\*\*license\*\*\n\n- `package\.json:4`: "license" in package\.json is MIT, but LICENSE has the ISC license text {2}\n {2}Fix: /);
  assert.match(markdown.stdout, /\n### Warnings\n\n\*\*license\*\*\n\n- `COPYING\.md`: /);
  assert.ok(markdown.stdout.endsWith("\n\n**1 error, 1 warning, 0 info**\n"));
});

test("--fail-on warning or info makes those fail the run too", async (t) => {
  const warningOnly = makeTree(t, { "package.json": packageJson({}), LICENSE: mit });
  assert.equal((await runCli(["doctor"], { cwd: warningOnly })).code, 0);
  assert.equal((await runCli(["doctor", "--fail-on", "warning"], { cwd: warningOnly })).code, 1);
  assert.equal((await runCli(["doctor", "--fail-on", "info"], { cwd: warningOnly })).code, 1);
  // toolsmith.json makes the license check's findings info.
  const infoOnly = makeTree(t, { "package.json": packageJson({}), LICENSE: mit, "toolsmith.json": JSON.stringify({ doctor: { severity: { license: "info" } } }) });
  const { stdout, code } = await runCli(["doctor", "--fail-on", "warning", "--json"], { cwd: infoOnly });
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(stdout).summary, { errors: 0, warnings: 0, info: 1, ignored: 0 });
  assert.equal((await runCli(["doctor", "--fail-on", "info"], { cwd: infoOnly })).code, 1);
  const wrong = await runCli(["doctor", "--fail-on", "fatal"], { cwd: infoOnly });
  assert.equal(wrong.code, 1);
  assert.match(wrong.stderr, /^error: option '--fail-on <severity>' argument 'fatal' is invalid\. Allowed choices are error, warning, info\.\n$/);
});

test("--json and --markdown don't go together, and --timeout takes seconds above 0", async (t) => {
  const cwd = project(t);
  const both = await runCli(["doctor", "--json", "--markdown"], { cwd });
  assert.equal(both.code, 1);
  assert.match(both.stderr, /^error: option '--markdown' cannot be used with option '--json'\n$/);
  for (const value of ["0", "-1", "soon", ""]) {
    const { stderr, code } = await runCli(["doctor", "--timeout", value], { cwd });
    assert.equal(code, 1);
    assert.match(stderr, /Use a number of seconds above 0, like 30 or 2\.5\.\n$/, value);
  }
  assert.equal((await runCli(["doctor", "--timeout", "2.5"], { cwd })).code, 0);
});

test("--only and --skip choose checks by name, and an unknown name is an error", async (t) => {
  const cwd = makeTree(t, { "package.json": packageJson({ license: "MIT" }) });
  const only = await runCli(["doctor", "--only", "license", "--json"], { cwd });
  assert.deepEqual(JSON.parse(only.stdout).checks, ["license"]);
  const skip = await runCli(["doctor", "--skip", "license"], { cwd });
  assert.equal(skip.stdout, "No problems found. Checked the current folder with no checks.\n0 errors, 0 warnings, 0 info\n");
  assert.equal(skip.code, 0);
  for (const args of [["--only", "licence"], ["--skip", "license,outdated"], ["--only", "license", "--only", "dupes"]]) {
    const { stdout, stderr, code } = await runCli(["doctor", ...args], { cwd });
    assert.equal(stdout, "");
    assert.match(stderr, /^error: unknown check "\w+" in --(only|skip); the checks are: license \(see "toolsmith doctor --list"\)\n$/, args.join(" "));
    assert.equal(code, 1);
  }
  const empty = await runCli(["doctor", "--only", ","], { cwd });
  assert.equal(empty.code, 1);
  assert.match(empty.stderr, /Name at least one check, like license\.\n$/);
  // Several names, in one option or more, and in any order.
  assert.deepEqual(chooseChecks([fake("a"), fake("b"), fake("c")], { only: ["c", "a"], skip: ["a"] }).run.map((check) => check.name), ["c"]);
});

test("--list shows the checks, and which need the network", async () => {
  const { stdout, code } = await runCli(["doctor", "--list"]);
  assert.equal(code, 0);
  assert.equal(stdout, 'license  a LICENSE file with the license that "license" in package.json names\n1 check.\n');
  assert.equal(listChecks([fake("a", null), fake("online", null, { network: true })]), "a       the a check\nonline  the online check (needs the network)\n2 checks.\n");
});

test("the project is the nearest folder with a toolsmith.json, or else with a package.json, from the current one up", (t) => {
  const top = makeTree(t, { "toolsmith.json": "{}", "packages/app/package.json": "{}", "packages/app/src/deep/x.js": "" });
  assert.deepEqual(findProject(join(top, "packages", "app", "src", "deep")), { root: top, config: join(top, "toolsmith.json") });
  const npmOnly = makeTree(t, { "package.json": "{}", "src/deep/x.js": "" });
  assert.deepEqual(findProject(join(npmOnly, "src", "deep")), { root: npmOnly, config: null });
  // With neither, the folder itself, unless some folder above the temp
  // folder has one of them.
  const bare = tempDir(t);
  const above = [];
  for (let dir = dirname(bare); dirname(dir) !== dir; dir = dirname(dir)) {
    above.push(dir);
  }
  if (!above.some((dir) => existsSync(join(dir, "toolsmith.json")) || existsSync(join(dir, "package.json")))) {
    assert.deepEqual(findProject(bare), { root: bare, config: null });
  }
});

test("toolsmith doctor finds its project from a folder inside it, and toolsmith.json ignores findings by check and by location", async (t) => {
  const cwd = makeTree(t, { "package.json": packageJson({ license: "MIT" }), LICENSE: isc, "COPYING.md": "Mine.", "src/app.js": "" });
  const settings = (doctorSection) => writeFileSync(join(cwd, "toolsmith.json"), JSON.stringify({ doctor: doctorSection }));

  settings({ ignore: [{ check: "license", file: "*.md" }] });
  const byFile = await runCli(["doctor", "--json"], { cwd: join(cwd, "src") });
  const report = JSON.parse(byFile.stdout);
  assert.ok(sameFolder(report.root, cwd));
  assert.ok(sameFolder(report.config, join(cwd, "toolsmith.json")));
  assert.deepEqual(report.summary, { errors: 1, warnings: 0, info: 0, ignored: 1 });
  assert.equal(byFile.code, 1);
  const text = await runCli(["doctor"], { cwd: join(cwd, "src") });
  assert.match(text.stdout, /\nChecked \S.* with 1 check: license\. 1 finding ignored by toolsmith\.json\.\n1 error, 0 warnings, 0 info\n$/);

  settings({ ignore: [{ check: "license", file: "package.json", line: 4 }, { check: "license", file: "COPYING.md", line: 1 }] });
  assert.deepEqual(JSON.parse((await runCli(["doctor", "--json"], { cwd })).stdout).summary, { errors: 0, warnings: 1, info: 0, ignored: 1 });

  settings({ ignore: ["license"] });
  const whole = await runCli(["doctor", "--json"], { cwd });
  assert.equal(whole.code, 0);
  const ignored = JSON.parse(whole.stdout);
  assert.deepEqual(ignored.checks, []);
  assert.deepEqual(ignored.skipped, [{ check: "license", reason: "ignored in toolsmith.json" }]);
  assert.match((await runCli(["doctor"], { cwd })).stdout, /with no checks\. Skipped: license \(ignored in toolsmith\.json\)\.\n/);

  settings({ severity: { license: "warning" }, timeout: 5 });
  assert.deepEqual(JSON.parse((await runCli(["doctor", "--json"], { cwd })).stdout).summary, { errors: 0, warnings: 2, info: 0, ignored: 0 });
});

test("a toolsmith.json that isn't valid stops doctor with an error that names the file and the key", async (t) => {
  const cases = [
    ["{ nope", /^error: config file .*toolsmith\.json is not valid JSON: /],
    ["[]", /^error: config file .*toolsmith\.json must contain a JSON object\n$/],
    ['{ "doctor": [] }', /^error: "doctor" in config file .*toolsmith\.json must be an object, got \[\]\n$/],
    ['{ "doctor": { "ignore": "license" } }', /^error: "doctor\.ignore" in config file .*toolsmith\.json must be a list of check names and \{ "check", "file" \} objects, got "license"\n$/],
    ['{ "doctor": { "ignore": [{ "check": "license" }] } }', /^error: "doctor\.ignore\[0\]" in config file .*toolsmith\.json must be a check name, or an object with "check", "file" and an optional "line", got \{"check":"license"\}\n$/],
    ['{ "doctor": { "ignore": [{ "check": "license", "file": "LICENSE", "lines": 3 }] } }', /^error: "doctor\.ignore\[0\]" in config file/],
    ['{ "doctor": { "ignore": ["license", { "check": "license", "file": "LICENSE", "line": 0 }] } }', /^error: "doctor\.ignore\[1\]\.line" in config file .*toolsmith\.json must be a line number from 1, got 0\n$/],
    ['{ "doctor": { "severity": { "license": "fatal" } } }', /^error: "doctor\.severity\.license" in config file .*toolsmith\.json must be "error", "warning" or "info", got "fatal"\n$/],
    ['{ "doctor": { "severity": ["license"] } }', /^error: "doctor\.severity" in config file .*toolsmith\.json must be a map of check names to "error", "warning" or "info", got \["license"\]\n$/],
    ['{ "doctor": { "timeout": -1 } }', /^error: "doctor\.timeout" in config file .*toolsmith\.json must be a number of seconds above 0, got -1\n$/],
    ['{ "doctor": { "timeout": "30" } }', /^error: "doctor\.timeout" in config file .*toolsmith\.json must be a number of seconds above 0, got "30"\n$/],
  ];
  for (const [contents, message] of cases) {
    const cwd = makeTree(t, { "toolsmith.json": contents });
    const { stdout, stderr, code } = await runCli(["doctor"], { cwd });
    assert.equal(stdout, "", contents);
    assert.match(stderr, message, contents);
    assert.equal(code, 1, contents);
  }
});

test("what toolsmith.json has that doctor doesn't know only gives a warning", async (t) => {
  const cwd = makeTree(t, {
    "package.json": packageJson({ license: "MIT" }),
    LICENSE: mit,
    "toolsmith.json": JSON.stringify({ docter: {}, doctor: { colour: true, ignore: ["licence", { check: "lisence", file: "LICENSE" }], severity: { licenses: "info" } } }),
  });
  const { stdout, stderr, code } = await runCli(["doctor"], { cwd });
  assert.equal(code, 0);
  assert.match(stdout, /^No problems found\./);
  const warnings = stderr.trimEnd().split("\n");
  assert.equal(warnings.length, 5, stderr);
  assert.match(warnings[0], /^warning: unknown setting "docter" in config file .*toolsmith\.json \(ignored\)$/);
  assert.match(warnings[1], /^warning: unknown setting "doctor\.colour" in config file .*toolsmith\.json \(ignored\)$/);
  assert.match(warnings[2], /^warning: unknown check "licence" in "doctor\.ignore\[0\]" in config file .*toolsmith\.json \(ignored\); the checks are: license$/);
  assert.match(warnings[3], /^warning: unknown check "lisence" in "doctor\.ignore\[1\]" in config file /);
  assert.match(warnings[4], /^warning: unknown check "licenses" in "doctor\.severity" in config file /);
});

test("the checks run at the same time; one that crashes or runs out of time is an error of its own, and the others still run", async (t) => {
  // "waits" only ends once "opens" has run: not if they run one at a time.
  let open;
  const opened = new Promise((resolve) => (open = resolve));
  let aborted = false;
  const checks = [
    fake("waits", async () => {
      await opened;
      return [{ severity: "info", message: "waited" }];
    }),
    fake("opens", async () => {
      open();
      return [];
    }),
    fake("throws", () => {
      throw new Error("a bug at once");
    }),
    fake("rejects", async () => {
      throw new TypeError("a bug later");
    }),
    fake(
      "hangs",
      ({ signal }) =>
        new Promise((resolve) =>
          signal.addEventListener("abort", () => {
            aborted = true;
            // What it gives after its time is up doesn't count.
            setTimeout(() => resolve([{ severity: "error", message: "too late" }]), 10);
          }),
        ),
    ),
    finds("fine", { severity: "warning", message: "still here", file: "a.js", line: 2, fix: "Look at it." }),
  ];
  const report = await doctor({ cwd: project(t), checks, timeout: 0.5 });
  assert.ok(aborted, "the check that ran out of time wasn't told");
  assert.deepEqual(report.checks, ["waits", "opens", "throws", "rejects", "hangs", "fine"]);
  assert.deepEqual(report.findings, [
    { check: "hangs", severity: "error", message: "the check didn't finish within 500 ms", fix: 'Give the checks more time with --timeout, or "timeout" in the "doctor" section of toolsmith.json.', file: undefined, line: undefined },
    { check: "rejects", severity: "error", message: "the check crashed: a bug later", fix: "This is a bug in the check; run toolsmith doctor --debug to see where it happened.", file: undefined, line: undefined },
    { check: "throws", severity: "error", message: "the check crashed: a bug at once", fix: "This is a bug in the check; run toolsmith doctor --debug to see where it happened.", file: undefined, line: undefined },
    { check: "fine", severity: "warning", message: "still here", file: "a.js", line: 2, fix: "Look at it." },
    { check: "waits", severity: "info", message: "waited", file: undefined, line: undefined, fix: undefined },
  ]);
  assert.deepEqual(report.summary, { errors: 3, warnings: 1, info: 1, ignored: 0 });
  assert.equal(report.failed, true);
});

test("a check that returns something other than a list of findings has crashed", async () => {
  const bad = [
    ["nothing", undefined, /got undefined$/],
    ["text", "all good", /got 'all good'$/],
    ["severity", [{ severity: "fatal", message: "m" }], /a finding's severity isn't "error", "warning" or "info": \{ severity: 'fatal', message: 'm' \}$/],
    ["message", [{ severity: "info", message: " " }], /a finding has no message: /],
    ["file", [{ severity: "info", message: "m", file: 3 }], /a finding's file isn't a path: /],
    ["line", [{ severity: "info", message: "m", line: 2 }], /a finding's line isn't a line number from 1, with a file: /],
    ["fraction", [{ severity: "info", message: "m", file: "a", line: 1.5 }], /a finding's line isn't a line number from 1, with a file: /],
    ["fix", [{ severity: "info", message: "m", fix: ["do this"] }], /a finding's fix isn't text: /],
    ["null", [null], /a finding is null$/],
  ];
  const { results } = await runChecks(
    bad.map(([name, returned]) => fake(name, async () => returned)),
    { root, timeout: 5000 },
  );
  for (const [index, [name, , message]] of bad.entries()) {
    assert.equal(results[index].failure, "crashed", name);
    assert.match(results[index].findings[0].message, /^the check returned something that isn't a list of findings: /, name);
    assert.match(results[index].findings[0].message, message, name);
  }
});

test("a check that needs the network is skipped, with a warning, without a connection, which is asked about once and only then", async (t) => {
  const cwd = project(t);
  let asked = 0;
  const online = (answer) => async () => {
    asked++;
    return answer;
  };
  const checks = [
    finds("local", { severity: "info", message: "here" }),
    fake("registry", async () => [{ severity: "error", message: "old" }], { network: true }),
    fake("audit", async () => [{ severity: "error", message: "unsafe" }], { network: true }),
  ];
  const warnings = [];
  const offline = await doctor({ cwd, checks, online: online(false), onWarning: (warning) => warnings.push(warning) });
  assert.equal(asked, 1);
  assert.deepEqual(offline.checks, ["local"]);
  assert.deepEqual(offline.skipped, [
    { check: "registry", reason: "it needs the network, and there's no connection" },
    { check: "audit", reason: "it needs the network, and there's no connection" },
  ]);
  assert.deepEqual(warnings, ["skipped the registry check: it needs the network, and there's no connection", "skipped the audit check: it needs the network, and there's no connection"]);
  // Skipping doesn't fail the run, even with --fail-on info.
  assert.equal((await doctor({ cwd, checks: checks.slice(1), online: online(false), failOn: "info" })).failed, false);
  assert.match(textReport(offline), /\nChecked \S.* with 1 check: local\. Skipped: registry \(it needs the network, and there's no connection\), audit \(it needs the network, and there's no connection\)\.\n/);

  asked = 0;
  const connected = await doctor({ cwd, checks, online: online(true) });
  assert.equal(asked, 1);
  assert.deepEqual(connected.checks, ["local", "registry", "audit"]);
  // Not asked when no check needs it, and never with --offline.
  asked = 0;
  await doctor({ cwd, checks: checks.slice(0, 1), online: online(true) });
  assert.equal(asked, 0);
  assert.deepEqual((await doctor({ cwd, checks, offline: true })).checks, ["local"]);
});

test("the connection is a lookup of the registry's name, which tests make without a network", async () => {
  const hosts = [];
  assert.equal(await isOnline({ resolve: async (host) => hosts.push(host) }), true);
  assert.deepEqual(hosts, ["registry.npmjs.org"]);
  assert.equal(await isOnline({ host: "registry.example.com", resolve: async (host) => assert.equal(host, "registry.example.com") }), true);
  assert.equal(await isOnline({ resolve: async () => Promise.reject(Object.assign(new Error("no route"), { code: "ECONNREFUSED" })) }), false);
  assert.equal(
    await isOnline({
      resolve: () => {
        throw new Error("at once");
      },
    }),
    false,
  );
  // A lookup that doesn't answer in time counts as no connection.
  const start = Date.now();
  assert.equal(await isOnline({ timeout: 50, resolve: () => new Promise(() => {}) }), false);
  assert.ok(Date.now() - start < 2000);
});

test("toolsmith.json's severity changes a check's findings, but never its own failure", async (t) => {
  const cwd = project(t, { doctor: { severity: { lint: "info", broken: "info" } } });
  const report = await doctor({
    cwd,
    checks: [
      finds("lint", { severity: "error", message: "e" }, { severity: "warning", message: "w" }),
      fake("broken", async () => {
        throw new Error("bug");
      }),
    ],
  });
  assert.deepEqual(
    report.findings.map(({ check, severity }) => `${check} ${severity}`),
    ["broken error", "lint info", "lint info"],
  );
});

test("ignore rules match a check's findings by file or glob pattern, and line", () => {
  const results = [
    {
      check: "lint",
      findings: [
        { severity: "error", message: "1", file: "docs/a.md", line: 3 },
        { severity: "error", message: "2", file: "docs/deep/b.md" },
        { severity: "error", message: "3", file: "src/a.js", line: 3 },
        { severity: "error", message: "4", file: "src/a.js", line: 4 },
        { severity: "error", message: "5" },
        { severity: "error", message: "6", file: ".github/ci.yml" },
        { severity: "error", message: "7", file: "photo[1].jpg" },
      ],
    },
    { check: "other", findings: [{ severity: "error", message: "8", file: "docs/a.md" }] },
  ];
  const rules = [
    { check: "lint", file: "docs/**" },
    { check: "lint", file: "src/a.js", line: 4 },
    { check: "lint", file: "**/*.yml" },
    { check: "lint", file: "photo[1].jpg" },
  ];
  const { findings, ignored } = applySettings(results, { rules });
  assert.deepEqual(
    findings.map((finding) => `${finding.check} ${finding.message}`),
    ["lint 3", "lint 5", "other 8"],
  );
  assert.equal(ignored, 5);
});

test("the Markdown report keeps its own markup out of the findings' text", () => {
  const report = {
    root,
    config: null,
    checks: ["lint"],
    skipped: [],
    findings: [{ check: "lint", severity: "warning", message: "a *bold* <b>claim</b> | with [links](x) & #1", file: "a`b.md", line: 2, fix: "Use `code`_now_." }],
    summary: { errors: 0, warnings: 1, info: 0, ignored: 0 },
    failOn: "error",
    failed: false,
  };
  assert.equal(
    markdownReport(report),
    [
      "## toolsmith doctor",
      "",
      "### Warnings",
      "",
      "**lint**",
      "",
      "- `` a`b.md:2 ``: a \\*bold\\* &lt;b&gt;claim&lt;/b&gt; \\| with \\[links\\](x) &amp; \\#1  ",
      "  Fix: Use \\`code\\`\\_now\\_.",
      "",
      "Checked with 1 check: lint.",
      "",
      "**0 errors, 1 warning, 0 info**",
      "",
    ].join("\n"),
  );
  const json = JSON.parse(jsonReport(report));
  assert.deepEqual(json.findings, report.findings);
  assert.equal(textReport(report).split("\n").at(-2), "0 errors, 1 warning, 0 info");
});

test("the text report colors only through the paint it's given", async (t) => {
  const report = await doctor({ cwd: project(t), checks: [finds("lint", { severity: "error", message: "e" }, { severity: "info", message: "i" })] });
  const painted = textReport(report, { paint: (format, text) => `<${format}>${text}</${format}>` });
  assert.match(painted, /^<red>Errors<\/red>\n\n {2}<bold>lint<\/bold>\n {4}e\n\n<cyan>Info<\/cyan>\n/);
  assert.ok(painted.endsWith("<red>1 error, 0 warnings, 1 info</red>\n"));
  assert.ok(!/magenta/.test(painted));
});

test("loadDoctorConfig without a toolsmith.json has nothing to say", () => {
  assert.deepEqual(loadDoctorConfig(null, ["license"]), { settings: { ignored: new Set(), rules: [], severity: {}, timeout: undefined }, warnings: [] });
});

test("the command reference and the docs page describe doctor", () => {
  const reference = readFileSync(join(root, "docs", "commands.md"), "utf8");
  assert.match(reference, /^## toolsmith doctor$/m);
  const page = readFileSync(join(root, "docs", "doctor.md"), "utf8");
  for (const option of ["--only", "--skip", "--fail-on", "--timeout", "--offline", "--json", "--markdown"]) {
    assert.ok(page.includes(option), `docs/doctor.md doesn't mention ${option}`);
  }
  assert.match(page, /## Exit codes/);
});
