import { count } from "../../lib/format.js";
import { branchExists, currentBranch, defaultBranch, ensureRepository, git } from "../../lib/git.js";
import { createPrompt } from "../../lib/prompt.js";
import { error, info, success } from "../../output.js";

// git commit-tree needs a name and email; the squash check's throwaway commit
// gets these, so it works even where no git identity is set up.
const checkIdentity = {
  GIT_AUTHOR_NAME: "toolsmith",
  GIT_AUTHOR_EMAIL: "toolsmith@localhost",
  GIT_COMMITTER_NAME: "toolsmith",
  GIT_COMMITTER_EMAIL: "toolsmith@localhost",
};

export function register(gitCommand, context) {
  gitCommand
    .command("clean-branches")
    .description("delete local branches that are already merged into the base branch")
    .option("--base <name>", "the branch to compare with (default: main, or else master)")
    .option("--remote", "also delete merged branches on origin (asks separately)")
    .option("-y, --yes", "delete without asking")
    .option("--dry-run", "only list the branches, delete nothing")
    .addHelpText(
      "after",
      `
Examples:
  See which branches would be deleted:
  $ toolsmith git clean-branches --dry-run

  Compare with "develop", and also clean up origin (asks separately):
  $ toolsmith git clean-branches --base develop --remote

Merged branches are deleted with "git branch -d", which refuses any branch that
isn't fully merged into the current branch. Squash-merged branches look unmerged
to git, so they're deleted with "git branch -D"; a branch counts as
squash-merged only if all of its changes are already in the base. The current
branch, the base branch and the "protectedBranches" in ~/.toolsmithrc (default:
main, master and develop) are never deleted, here or on origin. --remote runs
"git fetch --prune" first.`,
    )
    .action(async (options) => {
      await ensureRepository();
      const base = options.base ?? (await defaultBranch());
      if (!(await branchExists(base))) {
        throw new Error(`there's no local branch named ${base}`);
      }
      if (options.remote) {
        if (!(await git(["remote"])).split("\n").includes("origin")) {
          throw new Error("there's no remote named origin");
        }
        await git(["fetch", "--prune", "--quiet", "origin"]);
      }
      const current = await currentBranch();
      const protectedBranches = new Set(context.config.settings.protectedBranches);
      const mayDelete = (name) => name !== base && name !== current && !protectedBranches.has(name);

      const merged = [];
      const squashed = [];
      const kept = [];
      for (const { name, squash } of await findMergedBranches("refs/heads/", base)) {
        if (name === current) {
          kept.push(`${name} (current branch)`);
        } else if (protectedBranches.has(name)) {
          kept.push(`${name} (protected)`);
        } else {
          (squash ? squashed : merged).push(name);
        }
      }
      const remote = options.remote
        ? (await findMergedBranches("refs/remotes/origin/", base)).map(({ name }) => name).filter(mayDelete)
        : [];

      printList(`Merged into ${base}:`, merged);
      printList(`Squash-merged into ${base}:`, squashed);
      if (kept.length > 0) {
        console.log(`Kept: ${kept.join(", ")}`);
      }
      printList("On origin:", remote);

      const local = [...merged.map((name) => [name, "-d"]), ...squashed.map((name) => [name, "-D"])];
      if (local.length === 0 && remote.length === 0) {
        info("No merged branches to delete.");
        return;
      }
      if (options.dryRun) {
        info("Dry run: nothing was deleted.");
        return;
      }

      const prompts = createPrompt();
      const ask = (question) => options.yes || prompts.confirm(question);
      let localFailures = 0;
      let remoteFailures = 0;
      try {
        if (local.length > 0) {
          if (await ask(`Delete ${count(local.length, "branch", "branches")}? [y/N] `)) {
            // -d refuses squash-merged branches, because git can't see that
            // they're merged; those were checked above and get -D.
            localFailures = await deleteEach(local, ([name, flag]) => ["branch", flag, name], "");
          } else {
            info(options.remote ? "Local branches were kept." : "Nothing was deleted.");
          }
        }
        if (remote.length > 0) {
          if (await ask(`Delete ${count(remote.length, "branch", "branches")} on origin? [y/N] `)) {
            remoteFailures = await deleteEach(remote, (name) => ["push", "--quiet", "origin", "--delete", name], " on origin");
          } else {
            info("Branches on origin were kept.");
          }
        }
      } finally {
        prompts.close();
      }

      const failures = localFailures + remoteFailures;
      if (failures > 0) {
        const hint = localFailures > 0 ? `; switching to ${base} first often helps` : "";
        throw new Error(`${count(failures, "branch", "branches")} couldn't be deleted${hint}`);
      }
    });
}

function printList(title, names) {
  if (names.length > 0) {
    console.log(title);
    for (const name of names) {
      console.log(`  ${name}`);
    }
  }
}

// Runs the git command for each item, reports what failed, and returns how many
// failed. `where` is added to the messages, like " on origin".
async function deleteEach(items, gitArgs, where) {
  let deleted = 0;
  for (const item of items) {
    const name = Array.isArray(item) ? item[0] : item;
    try {
      await git(gitArgs(item));
      deleted++;
    } catch (err) {
      error(`couldn't delete ${name}${where} (${err.message})`);
    }
  }
  if (deleted > 0) {
    success(`Deleted ${count(deleted, "branch", "branches")}${where}.`);
  }
  return items.length - deleted;
}

// Branches under `prefix` ("refs/heads/" or "refs/remotes/origin/") that are
// merged ({ squash: false }) or squash-merged ({ squash: true }) into `base`,
// sorted by name.
async function findMergedBranches(prefix, base) {
  const list = async (filter) => {
    const refs = await git(["for-each-ref", `${filter}=refs/heads/${base}`, "--format=%(refname)", prefix]);
    return refs
      .split("\n")
      .filter((ref) => ref !== "")
      .map((ref) => ref.slice(prefix.length))
      .filter((name) => name !== base && name !== "HEAD");
  };
  const found = (await list("--merged")).map((name) => ({ name, squash: false }));
  for (const name of await list("--no-merged")) {
    if (await isSquashMerged(`${prefix}${name}`, base)) {
      found.push({ name, squash: true });
    }
  }
  return found.sort((a, b) => (a.name < b.name ? -1 : 1));
}

// A squash merge leaves no link between the branch and the base, so build a
// throwaway commit holding all of the branch's changes on top of where it
// started, and ask git cherry whether the base already has an equivalent
// change. The commit only lands in git's object store: no branch or other ref
// points to it, and the working tree isn't touched.
async function isSquashMerged(ref, base) {
  let start;
  try {
    start = await git(["merge-base", `refs/heads/${base}`, ref]);
  } catch {
    return false; // No common history.
  }
  const tree = await git(["rev-parse", `${ref}^{tree}`]);
  if (tree === (await git(["rev-parse", `${start}^{tree}`]))) {
    return false; // No changes at all, so there's nothing to have merged.
  }
  const commit = await git(["commit-tree", "--no-gpg-sign", tree, "-p", start, "-m", "toolsmith squash check"], {
    env: checkIdentity,
  });
  return (await git(["cherry", `refs/heads/${base}`, commit])).startsWith("-");
}
