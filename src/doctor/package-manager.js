import { join } from "node:path";
import { exists } from "./package.js";

// Which package manager a project uses, so that doctor's checks run that one,
// or none at all, but never another.

// The lockfiles of each package manager.
const lockfiles = [
  ["package-lock.json", "npm"],
  ["npm-shrinkwrap.json", "npm"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
];

// What each package manager leaves in a project that has no lockfile, like
// one that doesn't commit it.
const traces = [
  ["node_modules/.modules.yaml", "pnpm"],
  ["node_modules/.pnpm", "pnpm"],
  [".pnp.cjs", "yarn"],
  ["node_modules/.yarn-state.yml", "yarn"],
  ["node_modules/.yarn-integrity", "yarn"],
  ["node_modules/.package-lock.json", "npm"],
];

// How each package manager is written in a sentence.
export const managerNames = { npm: "npm", pnpm: "pnpm", yarn: "Yarn", bun: "Bun" };
const named = (manager) => managerNames[manager] ?? manager;

// The package manager of the project in `root`, whose package.json holds
// `data` (or undefined), as { manager, because, lockfile, conflict }:
//   manager   "npm", "pnpm", "yarn", "bun", another name from
//             "packageManager", or undefined when nothing is installed
//   because   what told: "pnpm-lock.yaml", or the "packageManager" field
//   lockfile  the manager's lockfile, if there is one
//   conflict  set instead, when the signs disagree: why it can't be told
// "packageManager" in package.json (as Corepack uses it) comes first, then the
// lockfiles, then what the managers leave in node_modules. Just a
// node_modules folder means npm.
export async function detectPackageManager(root, data) {
  const found = [];
  for (const [file, manager] of lockfiles) {
    if (await exists(join(root, file))) {
      found.push({ file, manager });
    }
  }
  const declared = typeof data?.packageManager === "string" ? /^\s*([a-z][\w-]*)(?:@|\s*$)/.exec(data.packageManager)?.[1] : undefined;
  if (declared) {
    const others = found.filter((lockfile) => lockfile.manager !== declared);
    return {
      manager: declared,
      because: `"packageManager": "${data.packageManager}" in package.json`,
      lockfile: found.find((lockfile) => lockfile.manager === declared)?.file,
      conflict:
        others.length > 0
          ? `package.json's "packageManager" says ${named(declared)}, but there's ${others.map((lockfile) => `a ${lockfile.file} (${named(lockfile.manager)})`).join(" and ")}`
          : undefined,
    };
  }
  const managers = [...new Set(found.map((lockfile) => lockfile.manager))];
  if (managers.length > 1) {
    return { conflict: `there are lockfiles of ${managers.map(named).join(" and ")}: ${found.map((lockfile) => lockfile.file).join(", ")}` };
  }
  if (managers.length === 1) {
    return { manager: managers[0], because: found[0].file, lockfile: found[0].file };
  }
  for (const [trace, manager] of traces) {
    if (await exists(join(root, trace))) {
      return { manager, because: trace };
    }
  }
  if (await exists(join(root, "node_modules"))) {
    return { manager: "npm", because: "node_modules" };
  }
  return { manager: undefined };
}
