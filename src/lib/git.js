import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// English messages, so checks like "not a git repository" work everywhere.
const gitEnv = { ...process.env, LC_ALL: "C" };

// Runs git with `args` and returns its output. git is started directly, without
// a shell, so arguments such as branch names can never run other commands. A
// failure throws an error with git's message, its `exitCode` and `stderr`.
export async function git(args, { cwd = process.cwd() } = {}) {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, env: gitEnv, maxBuffer: 64 * 1024 * 1024 });
    return stdout.trimEnd();
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error("git isn't installed, or isn't on your PATH");
    }
    const detail = (err.stderr || err.message).trim().split("\n")[0].replace(/^(error|fatal): /, "");
    throw Object.assign(new Error(`git ${args[0]}: ${detail}`), { exitCode: err.code, stderr: err.stderr ?? "" });
  }
}

// Throws a clear error unless `cwd` is inside a git repository.
export async function ensureRepository(cwd = process.cwd()) {
  try {
    await git(["rev-parse", "--git-dir"], { cwd });
  } catch (err) {
    if (/not a git repository/i.test(err.stderr ?? "")) {
      throw new Error(`${cwd} isn't in a git repository`);
    }
    throw err;
  }
}

export async function branchExists(name, { cwd } = {}) {
  try {
    await git(["show-ref", "--verify", "--quiet", `refs/heads/${name}`], { cwd });
    return true;
  } catch {
    return false;
  }
}

// The checked-out branch, or null when HEAD is detached.
export async function currentBranch({ cwd } = {}) {
  try {
    return (await git(["symbolic-ref", "--quiet", "HEAD"], { cwd })).replace(/^refs\/heads\//, "");
  } catch {
    return null;
  }
}

// The branch others get merged into: "main", or else "master".
export async function defaultBranch({ cwd } = {}) {
  for (const name of ["main", "master"]) {
    if (await branchExists(name, { cwd })) {
      return name;
    }
  }
  throw new Error("found no main or master branch; choose the base branch with --base <name>");
}
