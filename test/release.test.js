import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { makeRepo, makeTree, npmCli, tempDir } from "./helpers.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const script = join(root, "scripts", "changelog.js");
const read = (...parts) => readFileSync(join(...parts), "utf8");

const changelog = `# Changelog

## [Unreleased]

### Added

- A new thing.

## [1.0.0] - 2026-01-02

- The first release.
`;

// Runs scripts/changelog.js in `cwd`, without colors.
function run(cwd, ...args) {
  const env = { ...process.env, NO_COLOR: "1" };
  delete env.FORCE_COLOR;
  return spawnSync(process.execPath, [script, ...args], { cwd, env, encoding: "utf8" });
}

// A folder with a package.json at `version`, and `text` as its CHANGELOG.md.
const project = (t, version, text = changelog) =>
  makeTree(t, { "package.json": JSON.stringify({ name: "demo", version }), "CHANGELOG.md": text });

test("release moves the unreleased notes to a dated section for the new version", (t) => {
  const cwd = project(t, "1.1.0");
  const { status, stderr } = run(cwd, "release");
  assert.equal(status, 0, stderr);
  const result = read(cwd, "CHANGELOG.md");
  assert.equal(
    result.replace(/\d{4}-\d{2}-\d{2}/, "<today>"),
    `# Changelog

## [Unreleased]

## [1.1.0] - <today>

### Added

- A new thing.

## [1.0.0] - 2026-01-02

- The first release.
`,
  );
});

test("release keeps the changelog's line endings", (t) => {
  const cwd = project(t, "1.1.0", changelog.replaceAll("\n", "\r\n"));
  assert.equal(run(cwd, "release").status, 0);
  const result = read(cwd, "CHANGELOG.md");
  assert.match(result, /## \[1\.1\.0\] - [\d-]+\r\n/);
  assert.doesNotMatch(result, /[^\r]\n/);
});

test("release refuses when there are no notes, or the version is already there", (t) => {
  const empty = "# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2026-01-02\n\n- The first release.\n";
  const cases = [
    ["1.1.0", empty, "error: there's nothing under [Unreleased] in CHANGELOG.md; write down what changed first\n"],
    ["1.0.0", changelog, "error: CHANGELOG.md already has a section for 1.0.0\n"],
    ["1.1.0", "# Changelog\n", "error: CHANGELOG.md has no [Unreleased] section\n"],
  ];
  for (const [version, text, message] of cases) {
    const cwd = project(t, version, text);
    const { status, stderr } = run(cwd, "release");
    assert.equal(status, 1);
    assert.equal(stderr, message);
    assert.equal(read(cwd, "CHANGELOG.md"), text);
  }
});

test("check passes only when there are unreleased notes", (t) => {
  assert.equal(run(project(t, "1.0.0"), "check").status, 0);

  const empty = run(project(t, "1.0.0", "# Changelog\n\n## [Unreleased]\n"), "check");
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /nothing under \[Unreleased\]/);
});

test("notes prints a version's notes, once the tag fits package.json", (t) => {
  const cwd = project(t, "1.0.0");
  const { stdout, status } = run(cwd, "notes", "v1.0.0");
  assert.equal(status, 0);
  assert.equal(stdout, "- The first release.\n");

  const wrongTag = run(cwd, "notes", "v2.0.0");
  assert.equal(wrongTag.status, 1);
  assert.equal(wrongTag.stdout, "");
  assert.equal(wrongTag.stderr, "error: the tag v2.0.0 doesn't fit package.json, which says 1.0.0\n");

  // Still under [Unreleased]: the release can't go ahead.
  const notMoved = run(project(t, "1.1.0"), "notes", "v1.1.0");
  assert.equal(notMoved.status, 1);
  assert.equal(notMoved.stderr, 'error: CHANGELOG.md has no notes for 1.1.0; "npm version" moves them out of [Unreleased]\n');

  assert.equal(run(cwd).status, 1);
});

test("npm version moves the notes, and commits and tags them with the new version", (t) => {
  const cli = npmCli();
  if (!cli) {
    t.skip("npm's own script wasn't found next to Node.js");
    return;
  }
  const repo = makeRepo(t);
  const quoted = JSON.stringify(script);
  writeFileSync(join(repo.dir, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\n");
  writeFileSync(
    join(repo.dir, "package.json"),
    JSON.stringify({
      name: "demo",
      version: "1.0.0",
      scripts: {
        preversion: `node ${quoted} check`,
        version: `node ${quoted} release && git add CHANGELOG.md`,
      },
    }),
  );
  repo.git("add", "--all");
  repo.commit("add the project");
  const env = { ...process.env, ...repo.env, npm_config_cache: tempDir(t), npm_config_update_notifier: "false" };
  const args = [cli, "version", "minor", "-m", "Release v%s"];
  const npmVersion = () => spawnSync(process.execPath, args, { cwd: repo.dir, env, encoding: "utf8" });

  // Without notes, it stops before changing anything.
  assert.notEqual(npmVersion().status, 0);
  assert.equal(JSON.parse(read(repo.dir, "package.json")).version, "1.0.0");
  assert.equal(repo.git("tag", "--list"), "");
  assert.equal(repo.git("status", "--porcelain"), "");

  writeFileSync(join(repo.dir, "CHANGELOG.md"), changelog);
  repo.git("add", "--all");
  repo.commit("write the notes");
  const { status, stderr } = npmVersion();
  assert.equal(status, 0, stderr);

  assert.equal(JSON.parse(read(repo.dir, "package.json")).version, "1.1.0");
  assert.equal(repo.git("log", "-1", "--format=%s"), "Release v1.1.0");
  assert.equal(repo.git("tag", "--list"), "v1.1.0");
  assert.equal(repo.git("status", "--porcelain"), "");
  const changed = repo.git("show", "--name-only", "--format=", "HEAD").split("\n").sort();
  assert.deepEqual(changed, ["CHANGELOG.md", "package.json"]);
  assert.match(run(repo.dir, "notes", "v1.1.0").stdout, /- A new thing\./);
});

test("the release workflow runs on version tags, after the tests, and uses no npm token", () => {
  const release = read(root, ".github", "workflows", "release.yml");
  assert.match(release, /tags: \["v\[0-9\]\+\.\[0-9\]\+\.\[0-9\]\+"\]/);
  assert.match(release, /uses: \.\/\.github\/workflows\/ci\.yml/);
  assert.match(release, /needs: test/);
  assert.match(release, /id-token: write/);
  assert.match(release, /node scripts\/changelog\.js notes "\$GITHUB_REF_NAME"/);
  assert.doesNotMatch(release, /NPM_TOKEN|NODE_AUTH_TOKEN|secrets\./);
  assert.match(read(root, ".github", "workflows", "ci.yml"), /^ {2}workflow_call:/m);
});

test("the changelog has a place for the next release's notes", () => {
  assert.match(read(root, "CHANGELOG.md"), /^## \[Unreleased\]/m);
});
