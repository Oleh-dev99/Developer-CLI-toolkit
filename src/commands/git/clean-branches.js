import { count } from "../../lib/format.js";
import { branchExists, currentBranch, defaultBranch, ensureRepository, git } from "../../lib/git.js";
import { confirm, error, info, success } from "../../output.js";

export function register(gitCommand, context) {
  gitCommand
    .command("clean-branches")
    .description("delete local branches that are already merged into the base branch")
    .option("--base <name>", "the branch to compare with (default: main, or else master)")
    .option("-y, --yes", "delete without asking")
    .option("--dry-run", "only list the branches, delete nothing")
    .addHelpText(
      "after",
      `
Examples:
  See which branches would be deleted:
  $ toolsmith git clean-branches --dry-run

  Delete the branches merged into "develop", without asking:
  $ toolsmith git clean-branches --base develop --yes

Branches are deleted with "git branch -d", which refuses any branch that isn't
fully merged into the current branch, so no unmerged work is lost. The current
branch, the base branch and the "protectedBranches" in ~/.toolsmithrc (default:
main, master and develop) are never deleted.`,
    )
    .action(async (options) => {
      await ensureRepository();
      const base = options.base ?? (await defaultBranch());
      if (!(await branchExists(base))) {
        throw new Error(`there's no local branch named ${base}`);
      }
      const current = await currentBranch();
      const protectedBranches = new Set(context.config.settings.protectedBranches);

      const toDelete = [];
      const kept = [];
      for (const branch of await mergedBranches(base)) {
        if (branch === current) {
          kept.push(`${branch} (current branch)`);
        } else if (protectedBranches.has(branch)) {
          kept.push(`${branch} (protected)`);
        } else {
          toDelete.push(branch);
        }
      }

      if (toDelete.length > 0) {
        console.log(`Merged into ${base}:`);
        for (const branch of toDelete) {
          console.log(`  ${branch}`);
        }
      }
      if (kept.length > 0) {
        console.log(`Kept: ${kept.join(", ")}`);
      }
      if (toDelete.length === 0) {
        info("No merged branches to delete.");
        return;
      }
      if (options.dryRun) {
        info("Dry run: nothing was deleted.");
        return;
      }
      if (!options.yes && !(await confirm(`Delete ${count(toDelete.length, "branch", "branches")}? [y/N] `))) {
        info("Nothing was deleted.");
        return;
      }

      let deleted = 0;
      for (const branch of toDelete) {
        try {
          await git(["branch", "-d", branch]);
          deleted++;
        } catch (err) {
          error(`couldn't delete ${branch} (${err.message})`);
        }
      }
      if (deleted > 0) {
        success(`Deleted ${count(deleted, "branch", "branches")}.`);
      }
      if (deleted < toDelete.length) {
        throw new Error(
          `${count(toDelete.length - deleted, "branch", "branches")} couldn't be deleted; switching to ${base} first often helps`,
        );
      }
    });
}

// Local branches whose last commit is already in `base`, sorted by name.
async function mergedBranches(base) {
  const output = await git(["for-each-ref", `--merged=refs/heads/${base}`, "--format=%(refname:lstrip=2)", "refs/heads/"]);
  return output.split("\n").filter((branch) => branch !== "" && branch !== base);
}
