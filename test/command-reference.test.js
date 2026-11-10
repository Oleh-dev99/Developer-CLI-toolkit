import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import site from "../docs/.vitepress/config.js";
import { helpListing, tempDir } from "./helpers.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const script = join(root, "scripts", "command-reference.js");
const committed = join(root, "docs", "commands.md");
// Windows checkouts may have CRLF line endings.
const read = (file) => readFileSync(file, "utf8").replaceAll("\r\n", "\n");

// Runs scripts/command-reference.js, without colors.
function run(...args) {
  const env = { ...process.env, NO_COLOR: "1" };
  delete env.FORCE_COLOR;
  return spawnSync(process.execPath, [script, ...args], { cwd: root, env, encoding: "utf8" });
}

test("the committed command reference is up to date", () => {
  const { status, stderr } = run("--check");
  assert.equal(status, 0, stderr);
});

test("--check reports a reference that's out of date, and writing it brings it up to date", (t) => {
  const file = join(tempDir(t), "commands.md");
  writeFileSync(file, "# Command reference\n\nAn old version.\n");

  const stale = run("--check", file);
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /^error: .*commands\.md is out of date; run "npm run docs:commands" to update it\n$/);
  assert.equal(read(file), "# Command reference\n\nAn old version.\n");

  const written = run(file);
  assert.equal(written.status, 0, written.stderr);
  assert.match(written.stdout, /^Wrote the reference for \d+ commands to .*commands\.md\.\n$/);
  assert.equal(read(file), read(committed));
  assert.equal(run("--check", file).status, 0);

  // A checkout with CRLF line endings is still up to date.
  writeFileSync(file, read(committed).replaceAll("\n", "\r\n"));
  assert.equal(run("--check", file).status, 0);

  assert.equal(run("--check", join(tempDir(t), "missing.md")).status, 1);
});

// Every command that `toolsmith <words> --help` leads to, depth first, in the
// order --help lists them, with its arguments and options.
async function commandsUnder(words = []) {
  const listing = await helpListing(...words);
  const names = listing.commands.filter((name) => name !== "help");
  const below = await Promise.all(names.map((name) => commandsUnder([...words, name])));
  return [{ title: ["toolsmith", ...words].join(" "), ...listing }, ...below.flat()];
}

test("the reference has every command that --help shows, with its arguments and options", async () => {
  const sections = new Map(
    read(committed)
      .split(/^## /m)
      .slice(1)
      .map((section) => [section.slice(0, section.indexOf("\n")), section]),
  );
  const commands = await commandsUnder();
  assert.ok(commands.some(({ title }) => title === "toolsmith git recent"));
  assert.deepEqual([...sections.keys()], commands.map(({ title }) => title));

  for (const { title, arguments: args, options } of commands) {
    const section = sections.get(title);
    for (const term of [...args, ...options.filter((option) => option !== "-h, --help")]) {
      assert.ok(section.includes(`| \`${term}\` |`), `the reference for "${title}" doesn't list ${term}`);
    }
  }
});

test("the command reference is in the site's sidebar", () => {
  const links = site.themeConfig.sidebar.flatMap((group) => group.items.map((item) => item.link));
  assert.ok(links.includes("/commands"));
});
