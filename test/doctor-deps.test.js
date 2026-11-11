import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { auditCheck } from "../src/doctor/checks/audit.js";
import { outdatedCheck, updateKind } from "../src/doctor/checks/outdated.js";
import { doctor } from "../src/doctor/index.js";
import { detectPackageManager } from "../src/doctor/package-manager.js";
import { makeTree, runCli, tempDir } from "./helpers.js";

// toolsmith doctor's checks of the dependencies: outdated
// (src/doctor/checks/outdated.js) and audit (checks/audit.js), which run npm,
// and how they tell which package manager a project uses
// (src/doctor/package-manager.js). npm is never the real one: the in-process
// tests give the checks their own, and runCli puts a fake npm first on the
// PATH (test/fixtures/fake-npm), which prints the JSON in test/fixtures/npm/.

const fixture = (name) => fileURLToPath(new URL(`fixtures/npm/${name}`, import.meta.url));
const outdatedJson = readFileSync(fixture("outdated.json"), "utf8");
const auditJson = readFileSync(fixture("audit.json"), "utf8");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const packageJson = (fields) => json({ name: "demo", version: "1.0.0", ...fields });

// package.json for outdated.json: commander on line 5, debug 6, left-pad 7,
// picomatch 8, shared 9, tiny 10, and ms, a dev dependency, on line 13.
const outdatedDependencies = { commander: "^15.0.0", debug: "~2.6.0", "left-pad": "^1.3.0", picomatch: "^4.0.1", shared: "^1.0.0", tiny: "~0.1.0" };
const outdatedProject = {
  "package.json": packageJson({ dependencies: outdatedDependencies, devDependencies: { ms: "2.0.0" } }),
  "package-lock.json": "{}",
  "node_modules/": "",
};
// package.json for audit.json: abandoned on line 5, debug 6, mkdirp 7, semver 8.
const auditDependencies = { abandoned: "^1.0.0", debug: "^2.6.0", mkdirp: "^0.5.1", semver: "^7.0.0" };
const auditProject = { ...outdatedProject, "package.json": packageJson({ dependencies: auditDependencies }) };

// An npm for the checks: `answers` has what each command gives, by name
// ({ stdout, code, stderr }, or a function of the call that returns that or
// throws). `calls` lists the arguments of each run.
function fakeNpm(answers = {}) {
  const calls = [];
  const npm = async (args, options) => {
    calls.push(args.join(" "));
    const answer = answers[args[0]];
    const result = typeof answer === "function" ? await answer(options) : answer;
    return { code: 0, signal: null, stdout: "", stderr: "", ...result };
  };
  return { npm, calls };
}
const run = (check, root) => check.run({ root, signal: new AbortController().signal });

test("outdated: each kind of update, with the current, wanted and latest versions, and the command that gets it", async (t) => {
  const { npm, calls } = fakeNpm({ outdated: { stdout: outdatedJson, code: 1 } });
  const findings = await run(outdatedCheck({ npm }), makeTree(t, outdatedProject));
  assert.deepEqual(calls, ["outdated --json"]);
  const careful = ", after checking its changelog for breaking changes";
  assert.deepEqual(findings, [
    { file: "package.json", line: 7, severity: "warning", message: "left-pad isn't installed: wanted 1.3.0, latest 1.3.0", fix: "Run npm install." },
    {
      file: "package.json",
      line: 5,
      severity: "warning",
      message: "major update for commander: current 15.0.0, wanted 15.0.1, latest 16.1.0",
      fix: `Run npm update commander for 15.0.1; 16.1.0 needs npm install commander@16.1.0${careful}.`,
    },
    { file: "package.json", line: 6, severity: "warning", message: "major update for debug: current 2.6.9, wanted 2.6.9, latest 4.4.3", fix: `Run npm install debug@4.4.3${careful}.` },
    // 0.1 to 0.2 leaves the ^ range, so it can break things.
    {
      file: "package.json",
      line: 10,
      severity: "warning",
      message: "major update for tiny: current 0.1.0, wanted 0.1.2, latest 0.2.0",
      fix: `Run npm update tiny for 0.1.2; 0.2.0 needs npm install tiny@0.2.0${careful}.`,
    },
    { file: "package.json", line: 13, severity: "info", message: "minor update for ms: current 2.0.0, wanted 2.0.0, latest 2.1.3", fix: "Run npm install ms@2.1.3." },
    { file: "package.json", line: 8, severity: "info", message: "patch update for picomatch: current 4.0.1, wanted 4.0.3, latest 4.0.3", fix: "Run npm update picomatch for 4.0.3." },
    // Outdated in two workspaces.
    { file: "package.json", line: 9, severity: "info", message: "patch update for shared (in app): current 1.0.0, wanted 1.0.0, latest 1.0.5", fix: "Run npm install shared@1.0.5." },
    { file: "package.json", line: 9, severity: "info", message: "patch update for shared (in lib): current 1.0.2, wanted 1.0.2, latest 1.0.5", fix: "Run npm install shared@1.0.5." },
  ]);
});

test("outdated: nothing to update is no finding, whether npm prints {} or nothing", async (t) => {
  const root = makeTree(t, outdatedProject);
  for (const stdout of ["{}\n", ""]) {
    assert.deepEqual(await run(outdatedCheck(fakeNpm({ outdated: { stdout } })), root), []);
  }
  // A version that isn't from the registry, like a git URL, isn't compared.
  const odd = json({ fork: { current: "1.0.0", wanted: "git", latest: "git" } });
  assert.deepEqual(await run(outdatedCheck(fakeNpm({ outdated: { stdout: odd, code: 1 } })), root), [
    { file: "package.json", severity: "info", message: "fork 1.0.0 is installed, but package.json wants git", fix: "Run npm install, to install what package.json wants." },
  ]);
});

test("the kind of update follows npm's ^ and ~ ranges", () => {
  assert.equal(updateKind("1.2.3", "2.0.0"), "major");
  assert.equal(updateKind("1.2.3", "1.3.0"), "minor");
  assert.equal(updateKind("1.2.3", "1.2.9"), "patch");
  // Below 1.0.0, ^ allows less, so more updates can break things.
  assert.equal(updateKind("0.2.3", "0.3.0"), "major");
  assert.equal(updateKind("0.2.3", "0.2.5"), "patch");
  assert.equal(updateKind("0.0.3", "0.0.4"), "major");
  assert.equal(updateKind("1.0.0-beta.1", "1.0.0"), "patch");
  assert.equal(updateKind("1.2.3", "1.2.3"), undefined);
  assert.equal(updateKind("2.0.0", "1.9.0"), undefined);
  assert.equal(updateKind("1.0.0", "git"), undefined);
});

test("audit: npm's severities become errors, warnings and info, each with the package, the advisory and its fix", async (t) => {
  const { npm, calls } = fakeNpm({ audit: { stdout: auditJson, code: 1 } });
  const findings = await run(auditCheck({ npm }), makeTree(t, auditProject));
  assert.deepEqual(calls, ["audit --json"]);
  assert.deepEqual(findings, [
    {
      file: "package-lock.json",
      severity: "error",
      message: "critical vulnerability in minimist <0.2.4: Prototype Pollution in minimist (https://github.com/advisories/GHSA-xvch-5gv4-984h); it's a dependency of mkdirp",
      fix: "The fix is mkdirp@1.0.4, a major update that can break things: check its changelog, then run npm audit fix --force (or npm install mkdirp@1.0.4).",
    },
    {
      file: "package.json",
      line: 8,
      severity: "error",
      message: "high vulnerability in semver >=7.0.0 <7.5.2: semver vulnerable to Regular Expression Denial of Service (https://github.com/advisories/GHSA-c2qf-rxjj-qqgw)",
      fix: "Run npm audit fix.",
    },
    {
      file: "package-lock.json",
      severity: "warning",
      message: "moderate vulnerability in minimist <0.2.1: Prototype Pollution in minimist (https://github.com/advisories/GHSA-vh95-rmgr-6w4m); it's a dependency of mkdirp",
      fix: "The fix is mkdirp@1.0.4, a major update that can break things: check its changelog, then run npm audit fix --force (or npm install mkdirp@1.0.4).",
    },
    {
      file: "package.json",
      line: 6,
      severity: "info",
      message: "low vulnerability in debug <2.6.9: Regular Expression Denial of Service in debug (https://github.com/advisories/GHSA-gxpj-cx7g-858c)",
      fix: "Run npm audit fix, which installs debug@2.6.9.",
    },
    {
      file: "package.json",
      line: 5,
      severity: "info",
      message: "info vulnerability in abandoned *: abandoned is no longer maintained (https://github.com/advisories/GHSA-aaaa-bbbb-cccc)",
      fix: "No fix is available yet: see the advisory for a workaround, or replace the package.",
    },
  ]);
});

test("audit: no vulnerabilities is no finding, and a report npm 6 would write isn't read", async (t) => {
  const root = makeTree(t, auditProject);
  const none = json({ auditReportVersion: 2, vulnerabilities: {}, metadata: {} });
  assert.deepEqual(await run(auditCheck(fakeNpm({ audit: { stdout: none } })), root), []);
  const old = json({ advisories: {}, metadata: {} });
  assert.deepEqual(await run(auditCheck(fakeNpm({ audit: { stdout: old } })), root), [
    { severity: "error", message: "npm audit's report isn't one that toolsmith can read (auditReportVersion undefined)", fix: "Use npm 7 or later, which comes with Node.js 15 and later." },
  ]);
});

test("npm missing, no JSON or an error from npm or the registry is an error of that check", async (t) => {
  const root = makeTree(t, auditProject);
  const missing = () => {
    throw Object.assign(new Error("npm isn't installed, or isn't on your PATH"), { code: "ENOENT" });
  };
  for (const [check, command] of [
    [outdatedCheck, "outdated"],
    [auditCheck, "audit"],
  ]) {
    const findingsFor = async (answer) => run(check(fakeNpm({ [command]: answer })), root);
    assert.deepEqual(await findingsFor(missing), [
      {
        severity: "error",
        message: `npm isn't installed, or isn't on your PATH, so the ${command} check couldn't run`,
        fix: "Install Node.js with npm (https://nodejs.org), or add npm's folder to your PATH.",
      },
    ]);
    const broken = () => {
      throw Object.assign(new Error("spawn EACCES"), { code: "EACCES" });
    };
    assert.deepEqual(await findingsFor(broken), [{ severity: "error", message: `couldn't run npm ${command}: spawn EACCES` }]);
    const garbled = { stdout: "npm WARN something\n{ not json", code: 1, stderr: "npm warn config odd\nnpm error code E500\nnpm error A server error" };
    assert.deepEqual(await findingsFor(garbled), [
      { severity: "error", message: `npm ${command} --json gave no JSON object (exit code 1): code E500`, fix: `Run npm ${command} yourself to see what went wrong.` },
    ]);
    assert.equal((await findingsFor({ stdout: "[]", code: 1 }))[0].message, `npm ${command} --json gave no JSON object (exit code 1)`);
    assert.equal((await findingsFor({ stdout: "", code: null, signal: "SIGKILL" }))[0].message, `npm ${command} --json gave no JSON object (ended by SIGKILL)`);
    // What npm 11 printed with an unreachable registry.
    const refused = json({
      error: {
        code: "ECONNREFUSED",
        summary: "FetchError: request to http://127.0.0.1:9/minimist failed, reason: connect ECONNREFUSED 127.0.0.1:9",
        detail: "If you are behind a proxy, please make sure that the 'proxy' config is set properly.  See: 'npm help config'",
      },
    });
    assert.deepEqual(await findingsFor({ stdout: refused, code: 1 }), [
      {
        severity: "error",
        message: `npm ${command} failed: FetchError: request to http://127.0.0.1:9/minimist failed, reason: connect ECONNREFUSED 127.0.0.1:9 (ECONNREFUSED)`,
        fix: "If you are behind a proxy, please make sure that the 'proxy' config is set properly.  See: 'npm help config'",
      },
    ]);
  }
  // npm audit's own error, when the audit server can't be reached: the
  // reason is in "message".
  const endpoint = json({ message: "request to http://127.0.0.1:9/-/npm/v1/security/advisories/bulk failed, reason: connect ECONNREFUSED 127.0.0.1:9", error: { summary: "", detail: "" } });
  assert.deepEqual(await run(auditCheck(fakeNpm({ audit: { stdout: endpoint, code: 1 } })), root), [
    {
      severity: "error",
      message: "npm audit failed: request to http://127.0.0.1:9/-/npm/v1/security/advisories/bulk failed, reason: connect ECONNREFUSED 127.0.0.1:9",
      fix: "Run npm audit yourself to see npm's whole message.",
    },
  ]);
  const noLock = json({ error: { code: "ENOLOCK", summary: "This command requires an existing lockfile.", detail: "Try creating one first with: npm i --package-lock-only\nOriginal error: loadVirtual requires existing shrinkwrap file" } });
  assert.deepEqual(await run(auditCheck(fakeNpm({ audit: { stdout: noLock, code: 1 } })), root), [
    { severity: "error", message: "npm audit failed: This command requires an existing lockfile. (ENOLOCK)", fix: "Try creating one first with: npm i --package-lock-only" },
  ]);
});

test("the package manager is told by packageManager, then by the lockfiles, then by what's in node_modules", async (t) => {
  const detect = (tree, data) => detectPackageManager(makeTree(t, tree), data);
  assert.deepEqual(await detect({ "package-lock.json": "{}" }), { manager: "npm", because: "package-lock.json", lockfile: "package-lock.json" });
  assert.deepEqual(await detect({ "npm-shrinkwrap.json": "{}" }), { manager: "npm", because: "npm-shrinkwrap.json", lockfile: "npm-shrinkwrap.json" });
  assert.deepEqual(await detect({ "pnpm-lock.yaml": "" }), { manager: "pnpm", because: "pnpm-lock.yaml", lockfile: "pnpm-lock.yaml" });
  assert.deepEqual(await detect({ "yarn.lock": "" }), { manager: "yarn", because: "yarn.lock", lockfile: "yarn.lock" });
  assert.deepEqual(await detect({ "bun.lock": "" }), { manager: "bun", because: "bun.lock", lockfile: "bun.lock" });
  assert.deepEqual(await detect({ "pnpm-lock.yaml": "" }, { packageManager: "pnpm@9.1.0+sha512.abc" }), {
    manager: "pnpm",
    because: '"packageManager": "pnpm@9.1.0+sha512.abc" in package.json',
    lockfile: "pnpm-lock.yaml",
    conflict: undefined,
  });
  assert.equal((await detect({ "node_modules/": "" }, { packageManager: "yarn@4.2.2" })).manager, "yarn");
  assert.deepEqual(await detect({ "node_modules/.modules.yaml": "" }), { manager: "pnpm", because: "node_modules/.modules.yaml" });
  assert.deepEqual(await detect({ ".pnp.cjs": "" }), { manager: "yarn", because: ".pnp.cjs" });
  assert.deepEqual(await detect({ "node_modules/.yarn-integrity": "" }), { manager: "yarn", because: "node_modules/.yarn-integrity" });
  assert.deepEqual(await detect({ "node_modules/x/index.js": "" }), { manager: "npm", because: "node_modules" });
  assert.deepEqual(await detect({ "README.md": "" }), { manager: undefined });
  // Signs that disagree.
  assert.deepEqual(await detect({ "package-lock.json": "{}" }, { packageManager: "pnpm@9.1.0" }), {
    manager: "pnpm",
    because: '"packageManager": "pnpm@9.1.0" in package.json',
    lockfile: undefined,
    conflict: `package.json's "packageManager" says pnpm, but there's a package-lock.json (npm)`,
  });
  assert.deepEqual(await detect({ "package-lock.json": "{}", "yarn.lock": "" }), { conflict: "there are lockfiles of npm and Yarn: package-lock.json, yarn.lock" });
});

test("in a pnpm, Yarn or Bun project, both checks say so as info, and npm never runs", async (t) => {
  const deps = { dependencies: { commander: "^15.0.0" } };
  const cases = [
    [{ "pnpm-lock.yaml": "" }, "pnpm (pnpm-lock.yaml)", "Run pnpm outdated instead.", "Run pnpm audit instead."],
    [{ "yarn.lock": "" }, "Yarn (yarn.lock)", "Run yarn outdated (Yarn 1) or yarn upgrade-interactive (Yarn 2 and later) instead.", "Run yarn audit (Yarn 1) or yarn npm audit (Yarn 2 and later) instead."],
    [{ "bun.lockb": "" }, "Bun (bun.lockb)", "Check it with Bun's own commands instead.", "Check it with Bun's own commands instead."],
    [{ "node_modules/.pnpm/x": "" }, "pnpm (node_modules/.pnpm)", "Run pnpm outdated instead.", "Run pnpm audit instead."],
  ];
  for (const [tree, uses, outdatedFix, auditFix] of cases) {
    const root = makeTree(t, { "package.json": packageJson(deps), ...tree });
    const { npm, calls } = fakeNpm();
    assert.deepEqual(await run(outdatedCheck({ npm }), root), [
      { severity: "info", message: `the outdated check works only with npm so far, and this project uses ${uses}, so it didn't run`, fix: outdatedFix },
    ]);
    assert.deepEqual(await run(auditCheck({ npm }), root), [
      { severity: "info", message: `the audit check works only with npm so far, and this project uses ${uses}, so it didn't run`, fix: auditFix },
    ]);
    assert.deepEqual(calls, [], uses);
  }
  const declared = makeTree(t, { "package.json": packageJson({ ...deps, packageManager: "yarn@4.2.2" }), "node_modules/": "" });
  assert.match((await run(outdatedCheck(fakeNpm()), declared))[0].message, /uses Yarn \("packageManager": "yarn@4\.2\.2" in package\.json\)/);
});

test("signs of two package managers are a warning, and neither runs", async (t) => {
  const root = makeTree(t, { "package.json": packageJson({ dependencies: { a: "1" }, packageManager: "pnpm@9.1.0" }), "package-lock.json": "{}" });
  const { npm, calls } = fakeNpm();
  for (const check of [outdatedCheck({ npm }), auditCheck({ npm })]) {
    assert.deepEqual(await run(check, root), [
      {
        severity: "warning",
        message: `can't tell which package manager the project uses, so the ${check.name} check didn't run: package.json's "packageManager" says pnpm, but there's a package-lock.json (npm)`,
        fix: 'Remove the lockfiles of the package managers the project doesn\'t use, or correct "packageManager" in package.json.',
      },
    ]);
  }
  assert.deepEqual(calls, []);
});

test("nothing installed is a warning, audit needs a lockfile, and without dependencies there's nothing to check", async (t) => {
  const deps = packageJson({ dependencies: { a: "1" } });
  const { npm, calls } = fakeNpm({ outdated: { stdout: "{}" } });
  const bare = makeTree(t, { "package.json": deps });
  for (const check of [outdatedCheck({ npm }), auditCheck({ npm })]) {
    assert.deepEqual(await run(check, bare), [
      {
        severity: "warning",
        message: `the ${check.name} check has nothing to look at: the dependencies aren't installed (there's no lockfile and no node_modules folder)`,
        fix: "Install them with npm install, then run toolsmith doctor again.",
      },
    ]);
  }
  // node_modules without a lockfile: npm outdated works, npm audit doesn't.
  const unlocked = makeTree(t, { "package.json": deps, "node_modules/": "" });
  assert.deepEqual(await run(outdatedCheck({ npm }), unlocked), []);
  assert.deepEqual(await run(auditCheck({ npm }), unlocked), [
    {
      severity: "warning",
      message: "npm audit needs a package-lock.json, and the project has none, so the audit check didn't run",
      fix: "Make one with npm install --package-lock-only, then run toolsmith doctor again.",
    },
  ]);
  assert.deepEqual(calls, ["outdated --json"]);
  // No dependencies, or no package.json: nothing to check, and npm doesn't run.
  for (const tree of [{ "package.json": packageJson({ dependencies: {} }), "node_modules/": "" }, { "README.md": "" }]) {
    const root = makeTree(t, tree);
    assert.deepEqual(await run(outdatedCheck({ npm }), root), []);
    assert.deepEqual(await run(auditCheck({ npm }), root), []);
  }
  assert.deepEqual(calls, ["outdated --json"]);
  // A package.json that can't be read is an error, as in the license check.
  const [broken] = await run(auditCheck({ npm }), makeTree(t, { "package.json": "{ nope" }));
  assert.equal(broken.severity, "error");
  assert.match(broken.message, /^package\.json isn't valid JSON: /);
});

test("doctor's timeout stops npm: the check's run is aborted", async (t) => {
  let stopped = false;
  const npm = (args, { signal }) =>
    new Promise((resolve, reject) =>
      signal.addEventListener("abort", () => {
        stopped = true;
        reject(signal.reason);
      }),
    );
  const root = makeTree(t, { ...outdatedProject, "toolsmith.json": "{}" });
  const report = await doctor({ cwd: root, checks: [outdatedCheck({ npm })], timeout: 0.2, online: async () => true });
  assert.ok(stopped, "npm wasn't stopped");
  assert.deepEqual(
    report.findings.map(({ check, severity, message }) => ({ check, severity, message })),
    [{ check: "outdated", severity: "error", message: "the check didn't finish within 200 ms" }],
  );
});

// With the fake npm, through toolsmith itself.

// The environment for the fake npm: the JSON it prints and its exit codes,
// with a log of its runs.
function fakeNpmEnv(t, settings = {}) {
  const log = join(tempDir(t), "npm.log");
  return { log, env: { FAKE_NPM_LOG: log, ...settings } };
}
const runs = (log) => (existsSync(log) ? readFileSync(log, "utf8").trim().split(/\r?\n/).sort() : []);

test("toolsmith doctor runs npm outdated and npm audit without a shell, reads their JSON whatever the exit code, and reports by severity", async (t) => {
  const cwd = makeTree(t, {
    ...outdatedProject,
    "package.json": packageJson({ dependencies: { ...auditDependencies, ...outdatedDependencies }, devDependencies: { ms: "2.0.0" } }),
  });
  const { log, env } = fakeNpmEnv(t, { FAKE_NPM_OUTDATED: fixture("outdated.json"), FAKE_NPM_OUTDATED_EXIT: "1", FAKE_NPM_AUDIT: fixture("audit.json"), FAKE_NPM_AUDIT_EXIT: "1" });
  const { stdout, stderr, code } = await runCli(["doctor", "--only", "outdated,audit", "--json"], { cwd, env });
  assert.equal(stderr, "");
  assert.equal(code, 1);
  assert.deepEqual(runs(log), ["audit --json", "outdated --json"]);
  const report = JSON.parse(stdout);
  assert.deepEqual(report.checks, ["audit", "outdated"]);
  assert.deepEqual(report.summary, { errors: 2, warnings: 5, info: 6, ignored: 0 });
  assert.deepEqual(
    report.findings.map(({ check, severity, message }) => `${severity} ${check}: ${message.split(":")[0]}`),
    [
      "error audit: critical vulnerability in minimist <0.2.4",
      "error audit: high vulnerability in semver >=7.0.0 <7.5.2",
      "warning audit: moderate vulnerability in minimist <0.2.1",
      "warning outdated: left-pad isn't installed",
      "warning outdated: major update for commander",
      "warning outdated: major update for debug",
      "warning outdated: major update for tiny",
      "info audit: low vulnerability in debug <2.6.9",
      "info audit: info vulnerability in abandoned *",
      "info outdated: minor update for ms",
      "info outdated: patch update for picomatch",
      "info outdated: patch update for shared (in app)",
      "info outdated: patch update for shared (in lib)",
    ],
  );
  const text = await runCli(["doctor", "--only", "outdated"], { cwd, env });
  assert.equal(text.code, 0);
  assert.match(text.stdout, /^Warnings\n\n {2}outdated\n {4}package\.json:\d+: left-pad isn't installed: wanted 1\.3\.0, latest 1\.3\.0\n {6}Fix: Run npm install\.\n/);
  assert.ok(text.stdout.endsWith("Checked the current folder with 1 check: outdated.\n0 errors, 4 warnings, 4 info\n"), text.stdout);
});

test("without npm on the PATH, both checks say so, and the others still run", async (t) => {
  const cwd = makeTree(t, { ...auditProject, LICENSE: "Mine." });
  const { stdout, code } = await runCli(["doctor", "--json"], { cwd, env: { PATH: tempDir(t) } });
  assert.equal(code, 1);
  const report = JSON.parse(stdout);
  assert.deepEqual(report.checks, ["audit", "license", "outdated"]);
  assert.deepEqual(
    report.findings.filter((finding) => finding.check !== "license").map(({ check, severity, message }) => ({ check, severity, message })),
    [
      { check: "audit", severity: "error", message: "npm isn't installed, or isn't on your PATH, so the audit check couldn't run" },
      { check: "outdated", severity: "error", message: "npm isn't installed, or isn't on your PATH, so the outdated check couldn't run" },
    ],
  );
});

test("when a check runs out of time, npm and what it started are stopped", async (t) => {
  const cwd = makeTree(t, outdatedProject);
  const pidFile = join(tempDir(t), "pid.txt");
  const { env } = fakeNpmEnv(t, { FAKE_NPM_OUTDATED_HANG: pidFile });
  const started = Date.now();
  // Long enough for the fake npm to start and write its process ID.
  const { stdout, code } = await runCli(["doctor", "--only", "outdated", "--timeout", "3"], { cwd, env });
  assert.equal(code, 1);
  assert.match(stdout, /^Errors\n\n {2}outdated\n {4}the check didn't finish within 3\.0 s\n/);
  assert.ok(Date.now() - started < 20000, "toolsmith waited for npm");
  const pid = Number(readFileSync(pidFile, "utf8"));
  const alive = () => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  for (const end = Date.now() + 5000; alive() && Date.now() < end; ) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(!alive(), `the fake npm (process ${pid}) is still running`);
});

test("--offline skips both checks with a warning, and a pnpm project never gets npm", async (t) => {
  const { log, env } = fakeNpmEnv(t, { FAKE_NPM_OUTDATED: fixture("outdated.json"), FAKE_NPM_AUDIT: fixture("audit.json") });
  const offline = await runCli(["doctor", "--offline", "--only", "outdated,audit"], { cwd: makeTree(t, auditProject), env });
  assert.equal(offline.code, 0);
  assert.equal(
    offline.stderr,
    [
      "warning: skipped the audit check: it needs the network, and there's no connection",
      "warning: skipped the outdated check: it needs the network, and there's no connection",
      "",
    ].join("\n"),
  );
  assert.match(offline.stdout, /Checked the current folder with no checks\. Skipped: audit \(it needs the network, and there's no connection\), outdated \(/);

  const pnpm = makeTree(t, { "package.json": packageJson({ dependencies: { a: "1" } }), "pnpm-lock.yaml": "", "node_modules/.modules.yaml": "" });
  const { stdout, code } = await runCli(["doctor", "--only", "outdated,audit", "--json"], { cwd: pnpm, env });
  assert.equal(code, 0);
  assert.deepEqual(
    JSON.parse(stdout).findings.map(({ check, severity }) => `${check} ${severity}`),
    ["audit info", "outdated info"],
  );
  assert.deepEqual(runs(log), []);
});
