import assert from "node:assert/strict";
import { test } from "node:test";
import { makeRepo, runCli } from "./helpers.js";

const ada = "Ada Lovelace <ada@example.com>";
const grace = "Grace Hopper <grace@example.com>";

// Commits at fixed dates by three authors, with v0.1.0 tagged after the fix.
// "first commit" and "update readme" are by the repository's own user.
function historyRepo(t) {
  const repo = makeRepo(t, { date: "2024-02-20T12:00:00Z" });
  repo.commit("feat: add login page", { date: "2024-03-01T12:00:00Z", author: ada });
  repo.commit("fix(auth): handle expired tokens", { date: "2024-03-03T12:00:00Z", author: grace });
  repo.git("tag", "v0.1.0");
  repo.commit("docs: explain the config file", { date: "2024-03-05T12:00:00Z", author: ada });
  repo.commit("feat!: drop Node 20", { date: "2024-03-07T12:00:00Z", author: grace });
  repo.commit("update readme", { date: "2024-03-09T12:00:00Z" });
  return repo;
}

// Short hashes by subject.
function shortHashes(repo) {
  const lines = repo.git("log", "--format=%h %s").split("\n");
  return Object.fromEntries(lines.map((line) => [line.slice(line.indexOf(" ") + 1), line.slice(0, line.indexOf(" "))]));
}

const recent = (repo, args) => runCli(["git", "recent", ...args], { cwd: repo.dir, env: repo.env });

// Just the subjects, from the JSON output.
async function subjects(repo, args) {
  const { stdout } = await recent(repo, [...args, "--json"]);
  return JSON.parse(stdout).commits.map(({ subject }) => subject);
}

// Explicit time zones, so the window is the same wherever the tests run.
const all = ["--since", "2024-01-01 00:00 +0000"];

test("--since and --until pick a time window, newest first", async (t) => {
  const repo = historyRepo(t);
  const h = shortHashes(repo);
  const { stdout, stderr, code } = await recent(repo, ["--since", "2024-03-04 00:00 +0000", "--until", "2024-03-31 00:00 +0000"]);
  assert.equal(code, 0);
  assert.equal(stderr, "");
  assert.equal(
    stdout,
    `${h["update readme"]}  2024-03-09  Toolsmith Tests  update readme\n` +
      `${h["feat!: drop Node 20"]}  2024-03-07  Grace Hopper     feat!: drop Node 20\n` +
      `${h["docs: explain the config file"]}  2024-03-05  Ada Lovelace     docs: explain the config file\n` +
      "3 commits.\n",
  );
});

test("without --since or --from it shows the last 7 days", async (t) => {
  const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const repo = makeRepo(t, { date: daysAgo(60) });
  repo.commit("old work", { date: daysAgo(30) });
  repo.commit("new work", { date: daysAgo(2) });
  assert.deepEqual(await subjects(repo, []), ["new work"]);
});

test("--from shows everything since a tag", async (t) => {
  const repo = historyRepo(t);
  // These commits are from 2024, so this also shows --from has no 7-day limit.
  assert.deepEqual(await subjects(repo, ["--from", "v0.1.0"]), [
    "update readme",
    "feat!: drop Node 20",
    "docs: explain the config file",
  ]);
  const missing = await recent(repo, ["--from", "v9"]);
  assert.equal(missing.code, 1);
  assert.equal(missing.stderr, "error: there's no tag or commit named v9\n");
});

test("--author matches part of the name or email, ignoring case", async (t) => {
  const repo = historyRepo(t);
  assert.deepEqual(await subjects(repo, [...all, "--author", "ADA"]), [
    "docs: explain the config file",
    "feat: add login page",
  ]);
  assert.deepEqual(await subjects(repo, [...all, "--author", "grace@example"]), [
    "feat!: drop Node 20",
    "fix(auth): handle expired tokens",
  ]);
});

test("--mine shows the commits by your git user.email", async (t) => {
  const repo = historyRepo(t);
  assert.deepEqual(await subjects(repo, [...all, "--mine"]), ["update readme", "first commit"]);
});

test("--group type sorts commits into Conventional Commits types", async (t) => {
  const repo = historyRepo(t);
  const h = shortHashes(repo);
  const row = (subject, date, author) => `  ${h[subject]}  ${date}  ${author.padEnd(15)}  ${subject}\n`;
  const { stdout, code } = await recent(repo, [...all, "--group", "type"]);
  assert.equal(code, 0);
  assert.equal(
    stdout,
    "Features (2)\n" +
      row("feat!: drop Node 20", "2024-03-07", "Grace Hopper") +
      row("feat: add login page", "2024-03-01", "Ada Lovelace") +
      "\nFixes (1)\n" +
      row("fix(auth): handle expired tokens", "2024-03-03", "Grace Hopper") +
      "\nDocs (1)\n" +
      row("docs: explain the config file", "2024-03-05", "Ada Lovelace") +
      "\nOther (2)\n" +
      row("update readme", "2024-03-09", "Toolsmith Tests") +
      row("first commit", "2024-02-20", "Toolsmith Tests") +
      "\n6 commits.\n",
  );
});

test("--group author lists each author's commits, busiest first", async (t) => {
  const repo = historyRepo(t);
  const h = shortHashes(repo);
  const row = (subject, date) => `  ${h[subject]}  ${date}  ${subject}\n`;
  repo.commit("fix: typo", { date: "2024-03-10T12:00:00Z", author: grace });
  const { stdout } = await recent(repo, [...all, "--group", "author"]);
  assert.equal(
    stdout,
    "Grace Hopper (3)\n" +
      `  ${shortHashes(repo)["fix: typo"]}  2024-03-10  fix: typo\n` +
      row("feat!: drop Node 20", "2024-03-07") +
      row("fix(auth): handle expired tokens", "2024-03-03") +
      "\nAda Lovelace (2)\n" +
      row("docs: explain the config file", "2024-03-05") +
      row("feat: add login page", "2024-03-01") +
      "\nToolsmith Tests (2)\n" +
      row("update readme", "2024-03-09") +
      row("first commit", "2024-02-20") +
      "\n7 commits.\n",
  );
});

test("--markdown prints a heading per group and a bullet per commit", async (t) => {
  const repo = historyRepo(t);
  const h = shortHashes(repo);
  const { stdout, code } = await recent(repo, ["--from", "v0.1.0", "--group", "type", "--markdown"]);
  assert.equal(code, 0);
  assert.equal(
    stdout,
    "## Features\n\n" +
      `- feat!: drop Node 20 (\`${h["feat!: drop Node 20"]}\`, Grace Hopper, 2024-03-07)\n` +
      "\n## Docs\n\n" +
      `- docs: explain the config file (\`${h["docs: explain the config file"]}\`, Ada Lovelace, 2024-03-05)\n` +
      "\n## Other\n\n" +
      `- update readme (\`${h["update readme"]}\`, Toolsmith Tests, 2024-03-09)\n`,
  );
});

test("--json prints every commit's details, or groups with --group", async (t) => {
  const repo = historyRepo(t);
  const { stdout, code } = await recent(repo, ["--from", "v0.1.0", "--json"]);
  assert.equal(code, 0);
  const [newest] = JSON.parse(stdout).commits;
  assert.equal(newest.hash, repo.git("rev-parse", "HEAD"));
  assert.equal(newest.shortHash, shortHashes(repo)["update readme"]);
  assert.equal(newest.author, "Toolsmith Tests");
  assert.equal(newest.email, "tests@example.com");
  assert.match(newest.date, /^2024-03-09T12:00:00/);
  assert.equal(newest.subject, "update readme");
  assert.equal(newest.type, "other");

  const grouped = JSON.parse((await recent(repo, ["--from", "v0.1.0", "--group", "type", "--json"])).stdout);
  assert.deepEqual(
    grouped.groups.map(({ group, commits }) => [group, commits.length]),
    [
      ["feat", 1],
      ["docs", 1],
      ["other", 1],
    ],
  );
});

test("merge commits are left out unless --merges is given", async (t) => {
  const repo = makeRepo(t, { date: "2024-03-01T12:00:00Z" });
  repo.git("checkout", "--quiet", "-b", "topic");
  repo.commit("work on topic", { date: "2024-03-02T12:00:00Z" });
  repo.git("checkout", "--quiet", "main");
  repo.commit("Merge branch 'topic'", { date: "2024-03-03T12:00:00Z", merge: "topic" });
  assert.deepEqual(await subjects(repo, all), ["work on topic", "first commit"]);
  assert.deepEqual(await subjects(repo, [...all, "--merges"]), ["Merge branch 'topic'", "work on topic", "first commit"]);
});

test("says so when there are no commits", async (t) => {
  const repo = historyRepo(t);
  const { stdout, code } = await recent(repo, ["--since", "2030-01-01 00:00 +0000"]);
  assert.equal(code, 0);
  assert.equal(stdout, "No commits found.\n");
  assert.deepEqual(JSON.parse((await recent(repo, ["--since", "2030-01-01 00:00 +0000", "--json"])).stdout), {
    commits: [],
  });
});
