import { Option } from "commander";
import { count } from "../../lib/format.js";
import { ensureRepository, git } from "../../lib/git.js";
import { info } from "../../output.js";

// Conventional Commits types, in the order their groups are shown.
const types = {
  feat: "Features",
  fix: "Fixes",
  docs: "Docs",
  refactor: "Refactoring",
  test: "Tests",
  chore: "Chores",
  other: "Other",
};

// The git log fields for each commit. They are separated by NUL bytes, which
// can't appear in names or messages, so no commit message can break parsing.
const fields = ["%H", "%h", "%an", "%ae", "%aI", "%s"];

export function register(gitCommand) {
  gitCommand
    .command("recent")
    .description("summarize recent commits")
    .option("--since <date>", 'only commits after this, like "1 week ago" or 2024-03-01 (default: 7 days ago)')
    .option("--until <date>", "only commits before this")
    .option("--from <ref>", "only commits since this tag or commit, like v0.1.0")
    .addOption(new Option("--author <name>", "only commits whose author name or email contains this").conflicts("mine"))
    .option("--mine", "only your own commits (by your git user.email)")
    .addOption(new Option("--group <by>", "group by author or by Conventional Commits type").choices(["author", "type"]))
    .option("--merges", "include merge commits")
    .addOption(new Option("--markdown", "print Markdown, for a stand-up or release notes").conflicts("json"))
    .option("--json", "print the commits as JSON")
    .addHelpText(
      "after",
      `
Examples:
  What happened in the last 7 days:
  $ toolsmith git recent

  Your own commits since yesterday, for a stand-up:
  $ toolsmith git recent --mine --since yesterday --markdown

  Release notes since the last tag, by type:
  $ toolsmith git recent --from v0.1.0 --group type --markdown

  Who did what this month:
  $ toolsmith git recent --since "1 month ago" --group author

Commits are newest first. --group type sorts subjects like "feat: …" or
"fix(auth): …" into feat, fix, docs, refactor, test and chore, and everything
else into "other". Merge commits are left out unless you add --merges.`,
    )
    .action(async (options) => {
      await ensureRepository();
      const commits = await readCommits(options);
      const groups = options.group ? groupCommits(commits, options.group) : null;

      if (options.json) {
        const result = groups
          ? { groups: groups.map(({ key, title, commits }) => ({ group: key, title, commits })) }
          : { commits };
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      if (commits.length === 0) {
        info("No commits found.");
        return;
      }
      const showAuthor = options.group !== "author";
      if (options.markdown) {
        printMarkdown(commits, groups, showAuthor);
        return;
      }
      printText(commits, groups, showAuthor);
    });
}

async function readCommits(options) {
  const args = ["log", "-z", `--format=${fields.join("%x00")}`, "--regexp-ignore-case", "--fixed-strings"];
  if (!options.merges) {
    args.push("--no-merges");
  }
  // Each value is part of a single "--option=value" argument, so git never
  // reads it as an option of its own.
  const since = options.since ?? (options.from ? undefined : "7 days ago");
  if (since) {
    args.push(`--since=${since}`);
  }
  if (options.until) {
    args.push(`--until=${options.until}`);
  }
  if (options.author) {
    args.push(`--author=${options.author}`);
  }
  if (options.mine) {
    args.push(`--author=<${await userEmail()}>`);
  }
  args.push(options.from ? `${await commitHash(options.from)}..HEAD` : "HEAD");

  const values = (await git(args)).split("\0");
  const commits = [];
  for (let i = 0; i + fields.length <= values.length; i += fields.length) {
    const [hash, shortHash, author, email, date, subject] = values.slice(i, i + fields.length);
    commits.push({ hash, shortHash, author, email, date, subject, type: typeOf(subject) });
  }
  return commits;
}

// Resolves a tag or commit to its hash. --end-of-options keeps a value like
// "--output=x" from being taken as an option.
async function commitHash(ref) {
  try {
    return await git(["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`]);
  } catch {
    throw new Error(`there's no tag or commit named ${ref}`);
  }
}

async function userEmail() {
  try {
    return await git(["config", "user.email"]);
  } catch {
    throw new Error("--mine needs your git email; set it with: git config user.email you@example.com");
  }
}

// "feat: …", "fix(auth): …" and "feat!: …" have a Conventional Commits type.
function typeOf(subject) {
  const type = /^(\w+)(\([^)]*\))?!?: /.exec(subject)?.[1].toLowerCase();
  return Object.hasOwn(types, type ?? "") ? type : "other";
}

// Groups by type in a fixed order, or by author with the busiest first.
function groupCommits(commits, by) {
  if (by === "type") {
    return Object.entries(types)
      .map(([key, title]) => ({ key, title, commits: commits.filter((commit) => commit.type === key) }))
      .filter((group) => group.commits.length > 0);
  }
  return [...Map.groupBy(commits, (commit) => commit.author)]
    .map(([author, list]) => ({ key: author, title: author, commits: list }))
    .sort((a, b) => b.commits.length - a.commits.length || (a.title < b.title ? -1 : 1));
}

function printText(commits, groups, showAuthor) {
  const width = commits.reduce((max, commit) => Math.max(max, commit.author.length), 0);
  const line = (commit) =>
    [commit.shortHash, commit.date.slice(0, 10), ...(showAuthor ? [commit.author.padEnd(width)] : []), commit.subject].join(
      "  ",
    );
  if (!groups) {
    for (const commit of commits) {
      console.log(line(commit));
    }
  } else {
    for (const group of groups) {
      console.log(`${group.title} (${group.commits.length})`);
      for (const commit of group.commits) {
        console.log(`  ${line(commit)}`);
      }
      console.log("");
    }
  }
  info(`${count(commits.length, "commit")}.`);
}

function printMarkdown(commits, groups, showAuthor) {
  const bullet = (commit) =>
    `- ${commit.subject} (\`${commit.shortHash}\`${showAuthor ? `, ${commit.author}` : ""}, ${commit.date.slice(0, 10)})`;
  if (!groups) {
    for (const commit of commits) {
      console.log(bullet(commit));
    }
    return;
  }
  for (const [i, group] of groups.entries()) {
    console.log(`${i > 0 ? "\n" : ""}## ${group.title}\n`);
    for (const commit of group.commits) {
      console.log(bullet(commit));
    }
  }
}
