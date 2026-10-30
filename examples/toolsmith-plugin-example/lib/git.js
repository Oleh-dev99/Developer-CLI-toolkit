import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// The branch checked out in the git repository at `cwd`, or null when HEAD is
// detached. git runs without a shell, and in English, so its messages are
// the same everywhere.
export async function currentBranch(cwd = process.cwd()) {
  try {
    const { stdout } = await execFileAsync("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], {
      cwd,
      env: { ...process.env, LC_ALL: "C" },
    });
    return stdout.trim();
  } catch (err) {
    if (err.code === 1) {
      return null; // symbolic-ref --quiet says nothing else for a detached HEAD.
    }
    if (err.code === "ENOENT") {
      throw new Error("git isn't installed, or isn't on your PATH");
    }
    throw new Error((err.stderr || err.message).trim().split("\n")[0].replace(/^fatal: /, ""));
  }
}
