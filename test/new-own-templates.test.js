import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { gitEnv, makeRepo, makeTree, runCli, tempDir } from "./helpers.js";

// These tests are about the template; git init and npm install are skipped
// unless a test is about them.
const filesOnly = ["--author", "Ada Lovelace", "--no-git", "--no-install"];

// The files below `folder`, as sorted relative paths with "/".
const filesIn = (folder) =>
  readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(folder, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .sort();

const read = (...parts) => readFileSync(join(...parts), "utf8");

// A bare git repository to clone a template from, as a file:// URL, so no
// network is needed. On main, the first commit with the template is tagged v1
// and a second one changes the README; the branch next adds NEXT.md.
function templateRepository(t) {
  const work = makeRepo(t);
  const write = (path, text) => {
    mkdirSync(dirname(join(work.dir, path)), { recursive: true });
    writeFileSync(join(work.dir, path), text);
  };
  write("README.md", "# {{name}}, version 1\n");
  write("_gitignore", "node_modules/\n");
  write("src/{{name}}.js", 'export const name = "{{name}}";\n');
  work.git("add", "--all");
  work.git("commit", "--quiet", "-m", "version 1");
  work.git("tag", "v1");
  write("README.md", "# {{name}}, version 2\n");
  work.git("commit", "--quiet", "--all", "-m", "version 2");
  work.git("switch", "--quiet", "--create", "next");
  write("NEXT.md", "next\n");
  work.git("add", "--all");
  work.git("commit", "--quiet", "-m", "next");
  work.git("switch", "--quiet", "main");

  const bare = join(tempDir(t), "template.git");
  work.git("clone", "--quiet", "--bare", work.dir, bare);
  return pathToFileURL(bare).href;
}

test("a folder is a template: by a relative or absolute path, or from ~", async (t) => {
  // A home folder with a template that has no template.json, but has a .git
  // and a node_modules folder, which aren't copied.
  const home = makeTree(t, {
    "templates/api/README.md": "# {{name}} by {{author}}\n",
    "templates/api/_gitignore": "node_modules/\n",
    "templates/api/src/{{name}}.js": 'export const name = "{{name}}";\n',
    "templates/api/.git/HEAD": "ref: refs/heads/main\n",
    "templates/api/node_modules/left-pad/index.js": "\n",
  });
  const template = join(home, "templates", "api");
  const cwd = tempDir(t);
  const specs = { relative: relative(cwd, template), absolute: template, tilde: "~/templates/api" };

  for (const [folder, spec] of Object.entries(specs)) {
    const { stdout, stderr, code } = await runCli(["new", spec, folder, ...filesOnly], {
      cwd,
      // The home folder: HOME on Linux and macOS, USERPROFILE on Windows.
      env: { HOME: home, USERPROFILE: home },
    });
    assert.equal(code, 0, stderr);
    assert.ok(stdout.endsWith(`Created "${folder}" from ${spec} in ${folder}.\n`), stdout);
    assert.deepEqual(filesIn(join(cwd, folder)), [".gitignore", "README.md", `src/${folder}.js`]);
    assert.equal(read(cwd, folder, "README.md"), `# ${folder} by Ada Lovelace\n`);
  }
});

test("a built-in template's name wins over a folder with the same name", async (t) => {
  const cwd = makeTree(t, { "node-cli/README.md": "my own\n" });
  assert.equal((await runCli(["new", "node-cli", "built-in", ...filesOnly], { cwd })).code, 0);
  assert.ok(existsSync(join(cwd, "built-in", "package.json")), "the built-in template wasn't used");

  // ./node-cli is the folder.
  assert.equal((await runCli(["new", "./node-cli", "mine", ...filesOnly], { cwd })).code, 0);
  assert.deepEqual(filesIn(join(cwd, "mine")), ["README.md"]);
});

test("a git repository is cloned and used as a template, without its .git folder", async (t) => {
  const url = templateRepository(t);
  const cwd = tempDir(t);
  const env = gitEnv(t);

  const { stderr, code } = await runCli(["new", url, "app", ...filesOnly], { cwd, env });
  assert.equal(code, 0, stderr);
  assert.deepEqual(filesIn(join(cwd, "app")), [".gitignore", "README.md", "src/app.js"]);
  assert.equal(read(cwd, "app", "README.md"), "# app, version 2\n");

  // With git init, the project's history starts with toolsmith's commit, not
  // with the template's.
  const run = await runCli(["new", url, "with-git", "--author", "x", "--no-install"], { cwd, env });
  assert.equal(run.code, 0, run.stderr);
  const log = execFileSync("git", ["log", "--format=%s"], {
    cwd: join(cwd, "with-git"),
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  assert.equal(log, `Initial commit from toolsmith (${url})\n`);
});

test("a branch or tag after # picks what is cloned", async (t) => {
  const url = templateRepository(t);
  const cwd = tempDir(t);
  const env = gitEnv(t);

  assert.equal((await runCli(["new", `${url}#next`, "from-branch", ...filesOnly], { cwd, env })).code, 0);
  assert.deepEqual(filesIn(join(cwd, "from-branch")), [".gitignore", "NEXT.md", "README.md", "src/from-branch.js"]);

  assert.equal((await runCli(["new", `${url}#v1`, "from-tag", ...filesOnly], { cwd, env })).code, 0);
  assert.equal(read(cwd, "from-tag", "README.md"), "# from-tag, version 1\n");
});

test("a failed clone shows git's message, writes nothing and leaves no temp folder", async (t) => {
  const url = templateRepository(t);
  const cwd = tempDir(t);
  // The CLI's temp folder, to see what's left in it.
  const tmp = tempDir(t);
  const env = { ...gitEnv(t), TMPDIR: tmp, TEMP: tmp, TMP: tmp };
  const leftovers = () => readdirSync(tmp).filter((name) => name.startsWith("toolsmith-"));

  const missingBranch = await runCli(["new", `${url}#nope`, "app", ...filesOnly], { cwd, env });
  assert.equal(missingBranch.code, 1);
  assert.equal(
    missingBranch.stderr,
    "error: couldn't clone the template (git clone: Remote branch nope not found in upstream origin)\n",
  );

  const missingUrl = pathToFileURL(join(tempDir(t), "missing.git")).href;
  const missingRepository = await runCli(["new", missingUrl, "app", ...filesOnly], { cwd, env });
  assert.equal(missingRepository.code, 1);
  assert.match(
    missingRepository.stderr,
    /^error: couldn't clone the template \(git clone: '.*missing\.git' does not appear to be a git repository\)\n$/,
  );

  assert.deepEqual(readdirSync(cwd), [], "something was written");
  assert.deepEqual(leftovers(), []);

  // A clone that works is cleaned up too.
  assert.equal((await runCli(["new", url, "app", ...filesOnly], { cwd, env })).code, 0);
  assert.deepEqual(leftovers(), []);
});

test("a missing folder, a file or an empty template is an error", async (t) => {
  const cwd = makeTree(t, { "a-file.txt": "", "empty/": "", "only-description/template.json": "{}" });
  const errorFor = async (spec) => (await runCli(["new", spec, "app", ...filesOnly], { cwd })).stderr;

  assert.equal(
    await errorFor("./missing"),
    'error: the template folder ./missing doesn\'t exist; see "toolsmith new --list"\n',
  );
  assert.equal(
    await errorFor("a-file.txt"),
    'error: a-file.txt is a file, not a template folder; see "toolsmith new --list"\n',
  );
  assert.equal(await errorFor("empty"), "error: the template empty is empty\n");
  assert.equal(await errorFor("only-description"), "error: the template only-description is empty\n");
  assert.deepEqual(readdirSync(cwd).sort(), ["a-file.txt", "empty", "only-description"]);
});

test("an empty template from git is an error too, and its clone is deleted", async (t) => {
  const work = makeRepo(t);
  writeFileSync(join(work.dir, "template.json"), "{}");
  work.git("add", "--all");
  work.git("commit", "--quiet", "-m", "only a description");
  const url = pathToFileURL(work.dir).href;
  const tmp = tempDir(t);
  const env = { ...gitEnv(t), TMPDIR: tmp, TEMP: tmp, TMP: tmp };

  const { stderr, code } = await runCli(["new", url, "app", ...filesOnly], { cwd: tempDir(t), env });
  assert.equal(code, 1);
  assert.equal(stderr, `error: the template ${url} is empty\n`);
  assert.deepEqual(
    readdirSync(tmp).filter((name) => name.startsWith("toolsmith-")),
    [],
  );
});
