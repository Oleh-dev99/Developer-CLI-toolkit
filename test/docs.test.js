import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import site from "../docs/.vitepress/config.js";
import { helpListing, runCli } from "./helpers.js";

// These tests read the site's pages and settings. Building it needs VitePress,
// which the docs workflow installs; the tests don't.

const root = fileURLToPath(new URL("..", import.meta.url));
const docs = join(root, "docs");
const read = (...parts) => readFileSync(join(...parts), "utf8");
const packageJson = JSON.parse(read(root, "package.json"));

// The lines of a page's ```sh code blocks.
const shellLines = (page) =>
  [...page.matchAll(/^```sh\r?\n([\s\S]*?)^```/gm)].flatMap(([, code]) => code.split(/\r?\n/));

test("the site is served from the repository's GitHub Pages address", () => {
  const repository = packageJson.repository.url.match(/github\.com\/[^/]+\/(.+?)\.git$/)[1];
  assert.equal(site.base, `/${repository}/`);
});

test("every link in the site's menus and on its home page leads to a page", () => {
  // A link like /plugins is plugins.md, or the file rewritten to it.
  const pageFor = (link) => {
    const page = `${link.slice(1)}.md`;
    return Object.keys(site.rewrites).find((file) => site.rewrites[file] === page) ?? page;
  };
  const home = read(docs, "index.md");
  const links = [
    ...site.themeConfig.nav.map((item) => item.link),
    ...site.themeConfig.sidebar.flatMap((group) => group.items.map((item) => item.link)),
    ...[...home.matchAll(/^\s+link: (\S+)/gm)].map(([, link]) => link),
  ].filter((link) => link.startsWith("/"));
  assert.ok(links.length > 0);
  for (const link of links) {
    assert.ok(existsSync(join(docs, pageFor(link))), `nothing in docs/ for ${link}`);
  }
});

test("getting started installs the published package, on the Node.js versions it supports", () => {
  const page = read(docs, "getting-started.md");
  assert.ok(page.includes(`npm install --global ${packageJson.name}\n`) || page.includes(`npm install --global ${packageJson.name}\r\n`));
  const minimum = packageJson.engines.node.replace(/^>=/, "");
  assert.ok(page.includes(`${minimum} or later`), `getting started doesn't say Node.js ${minimum} or later`);
});

test("every toolsmith command in the guide's examples exists", async () => {
  const builtIn = (await helpListing()).commands;
  const git = (await helpListing("git")).commands;
  const examples = ["getting-started.md", "configuration.md"]
    .flatMap((page) => shellLines(read(docs, page)))
    .filter((line) => line.startsWith("toolsmith "))
    .map((line) => line.split(" ").slice(1))
    .filter(([first]) => !first.startsWith("-"));
  assert.ok(examples.length > 0);
  for (const [first, second] of examples) {
    assert.ok(builtIn.includes(first), `"toolsmith ${first}" isn't a command`);
    if (first === "git") {
      assert.ok(git.includes(second), `"toolsmith git ${second}" isn't a command`);
    }
  }
});

test("the configuration page describes every setting, with its default", async () => {
  // `toolsmith config` without a config file prints every setting's default.
  const { stdout, code } = await runCli(["config"]);
  assert.equal(code, 0);
  const defaults = Object.fromEntries(
    [...stdout.matchAll(/^ {2}(\w+): (.+)$/gm)].map(([, key, value]) => [key, JSON.parse(value)]),
  );

  const sections = read(docs, "configuration.md").split(/^### /m).slice(1);
  const documented = Object.fromEntries(
    sections.map((section) => {
      const key = section.match(/^`(\w+)`/)[1];
      const value = section.match(/Default: `([^`]+)`/)?.[1];
      assert.ok(value, `the configuration page gives no default for ${key}`);
      return [key, JSON.parse(value)];
    }),
  );
  assert.deepEqual(documented, defaults);
});

test("the docs workflow publishes the site from main to GitHub Pages", () => {
  const workflow = read(root, ".github", "workflows", "docs.yml");
  assert.match(workflow, /^ {2}push:\r?\n {4}branches: \[main\]/m);
  assert.match(workflow, /^permissions:\r?\n {2}contents: read/m);
  assert.match(workflow, /run: npm ci\r?\n\s+working-directory: docs/);
  assert.match(workflow, /path: docs\/\.vitepress\/dist/);
  // Only the job that publishes may, without a stored token.
  assert.match(workflow, /pages: write/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /uses: actions\/deploy-pages@/);
  assert.doesNotMatch(workflow, /secrets\./);
});
