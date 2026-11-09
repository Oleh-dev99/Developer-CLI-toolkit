import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { npmCli, tempDir } from "./helpers.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

// The files below `folder` in the repository, as paths from its root with "/".
const filesIn = (folder) =>
  readdirSync(join(root, folder), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join("/"));

test("the npm package has toolsmith's code and templates, and nothing else", (t) => {
  const cli = npmCli();
  if (!cli) {
    t.skip("npm's own script wasn't found next to Node.js");
    return;
  }
  // npm keeps its logs in its cache folder, so that's a temp folder too.
  const env = { ...process.env, npm_config_cache: tempDir(t), npm_config_update_notifier: "false" };
  const args = [cli, "pack", "--dry-run", "--json"];
  const result = spawnSync(process.execPath, args, { cwd: root, env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const [packed] = JSON.parse(result.stdout);

  // npm always adds package.json, the README and the license; "files" adds
  // the rest. Tests, docs and the example plugin stay out.
  const expected = ["LICENSE", "README.md", "package.json", ...packageJson.files.flatMap((folder) => filesIn(folder))];
  assert.deepEqual(packed.files.map((file) => file.path).sort(), expected.sort());
  assert.ok(expected.includes(packageJson.bin.toolsmith), "the command's script isn't in the package");
});

test("toolsmith is published under its scoped name, and the command is still toolsmith", () => {
  assert.equal(packageJson.name, "@oleh-dev99/toolsmith");
  // Scoped packages are private unless they're published as public.
  assert.deepEqual(packageJson.publishConfig, { access: "public" });
  assert.deepEqual(Object.keys(packageJson.bin), ["toolsmith"]);
});

test("package.json says what npm shows about toolsmith", () => {
  for (const field of ["description", "keywords", "homepage", "bugs", "repository", "license", "engines"]) {
    assert.ok(packageJson[field], `package.json has no "${field}"`);
  }
  assert.equal(packageJson.license, "MIT");
  assert.match(readFileSync(join(root, "LICENSE"), "utf8"), /^MIT License/);
  assert.deepEqual(packageJson.files, ["bin/", "src/", "templates/"]);
});
