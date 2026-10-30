import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dotfiles } from "../src/commands/new.js";
import { runCli, tempDir } from "./helpers.js";

// Every folder in templates/ is a built-in template, so a new one is tested
// here without changing this file.
const templatesFolder = fileURLToPath(new URL("../templates/", import.meta.url));
const templateNames = readdirSync(templatesFolder, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const values = { name: "demo-project", author: "Ada Lovelace", year: String(new Date().getFullYear()) };

// The files below `folder`, as sorted relative paths with "/".
function filesIn(folder) {
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(folder, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .sort();
}

// What a template file is called in the generated project.
const generatedPath = (path) =>
  path
    .split("/")
    .map((part) => dotfiles.get(part) ?? part.replace(/\{\{(name|author|year)\}\}/g, (_, key) => values[key]))
    .join("/");

// Runs node in `cwd`. Test files get NODE_TEST_CONTEXT from the test runner; a
// "node --test" started from here would think it belongs to that run.
function node(args, cwd) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, args, { cwd, env, encoding: "utf8" });
}

test("new --list shows every built-in template with its description", async () => {
  const { stdout, code } = await runCli(["new", "--list"]);
  assert.equal(code, 0);
  const width = Math.max(...templateNames.map((name) => name.length));
  const lines = templateNames.map((name) => {
    const { description } = JSON.parse(readFileSync(join(templatesFolder, name, "template.json"), "utf8"));
    assert.ok(description, `templates/${name}/template.json needs a description`);
    return `${name.padEnd(width)}  ${description}`;
  });
  assert.equal(stdout, `${lines.join("\n")}\n`);
});

for (const template of templateNames) {
  test(`the ${template} template creates a complete project`, async (t) => {
    const cwd = tempDir(t);
    const args = ["new", template, values.name, "--author", values.author, "--no-git", "--no-install"];
    const { stderr, code } = await runCli(args, { cwd });
    assert.equal(code, 0, stderr);
    const project = join(cwd, values.name);
    const templateFiles = filesIn(join(templatesFolder, template)).filter((path) => path !== "template.json");
    const files = filesIn(project);

    // Every template file is there under its generated name, and template.json
    // (the template's description) isn't.
    assert.deepEqual(files, templateFiles.map(generatedPath).sort());

    for (const path of files) {
      assert.doesNotMatch(path, /\{\{|\}\}/, `a placeholder is left in the name ${path}`);
      const content = readFileSync(join(project, path), "utf8");
      assert.doesNotMatch(content, /\{\{\s*\w+\s*\}\}/, `a placeholder is left in ${path}`);
    }

    for (const path of templateFiles.filter((path) => path.split("/").at(-1) === "_gitignore")) {
      const gitignore = path.replace(/_gitignore$/, ".gitignore");
      assert.ok(files.includes(gitignore), `${gitignore} is missing`);
      assert.ok(!files.includes(path), `${path} wasn't renamed`);
    }

    // A Node.js project runs: each bin script, and its tests when "npm test"
    // is "node --test".
    if (files.includes("package.json")) {
      const packageJson = JSON.parse(readFileSync(join(project, "package.json"), "utf8"));
      const bins = typeof packageJson.bin === "string" ? [packageJson.bin] : Object.values(packageJson.bin ?? {});
      for (const script of bins) {
        const result = node([script], project);
        assert.equal(result.status, 0, `node ${script} failed: ${result.stderr}`);
        assert.match(result.stdout, /\S/, `node ${script} printed nothing`);
      }
      if (packageJson.scripts?.test === "node --test") {
        const result = node(["--test"], project);
        assert.equal(result.status, 0, `node --test failed:\n${result.stdout}${result.stderr}`);
      }
    }
  });
}
