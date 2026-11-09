import { readFileSync, writeFileSync } from "node:fs";
import { error, success } from "../src/output.js";

// Keeps CHANGELOG.md in step with releases; see docs/RELEASING.md. It works on
// the CHANGELOG.md and package.json in the current folder.
//
//   node scripts/changelog.js check
//     Fails if there are no notes under [Unreleased]. `npm version` runs this
//     first, so that a release without notes stops before anything changes.
//
//   node scripts/changelog.js release
//     Moves the notes under [Unreleased] to a new section for the version in
//     package.json, dated today. `npm version` runs this after the bump.
//
//   node scripts/changelog.js notes v1.2.3
//     Checks that the tag fits package.json and prints that version's notes.
//     The release workflow runs this.

function main([action, tag]) {
  const { version } = JSON.parse(readFileSync("package.json", "utf8"));
  const text = readFileSync("CHANGELOG.md", "utf8");
  if (action === "check") {
    unreleasedNotes(text.split(/\r?\n/));
  } else if (action === "release") {
    writeFileSync("CHANGELOG.md", withRelease(text, version, new Date().toISOString().slice(0, 10)));
    success(`Moved the unreleased notes to ${version} in CHANGELOG.md.`);
  } else if (action === "notes" && tag) {
    if (tag !== `v${version}`) {
      throw new Error(`the tag ${tag} doesn't fit package.json, which says ${version}`);
    }
    console.log(notesFor(text, version));
  } else {
    throw new Error("use: node scripts/changelog.js check, release, or notes v1.2.3");
  }
}

// `text` with the notes under [Unreleased] moved to a new section for `version`
// below it. It keeps the file's line endings.
function withRelease(text, version, date) {
  const lines = text.split(/\r?\n/);
  if (findSection(lines, `## [${version}]`)) {
    throw new Error(`CHANGELOG.md already has a section for ${version}`);
  }
  const { unreleased, notes } = unreleasedNotes(lines);
  const released = [
    ...lines.slice(0, unreleased.heading + 1),
    "",
    `## [${version}] - ${date}`,
    "",
    ...notes.split("\n"),
    "",
    ...lines.slice(unreleased.end),
  ];
  return released.join(text.includes("\r\n") ? "\r\n" : "\n");
}

// The [Unreleased] section and its notes; throws if there are none.
function unreleasedNotes(lines) {
  const unreleased = findSection(lines, "## [Unreleased]");
  if (!unreleased) {
    throw new Error("CHANGELOG.md has no [Unreleased] section");
  }
  const notes = bodyOf(lines, unreleased);
  if (notes === "") {
    throw new Error("there's nothing under [Unreleased] in CHANGELOG.md; write down what changed first");
  }
  return { unreleased, notes };
}

function notesFor(text, version) {
  const lines = text.split(/\r?\n/);
  const section = findSection(lines, `## [${version}] - `);
  const notes = section ? bodyOf(lines, section) : "";
  if (notes === "") {
    throw new Error(`CHANGELOG.md has no notes for ${version}; "npm version" moves them out of [Unreleased]`);
  }
  return notes;
}

// Where the section whose heading starts with `start` is in `lines`: its
// heading's index and the index just after its last line, or null.
function findSection(lines, start) {
  const heading = lines.findIndex((line) => line.startsWith(start));
  if (heading === -1) {
    return null;
  }
  const next = lines.findIndex((line, index) => index > heading && line.startsWith("## "));
  return { heading, end: next === -1 ? lines.length : next };
}

function bodyOf(lines, { heading, end }) {
  return lines
    .slice(heading + 1, end)
    .join("\n")
    .trim();
}

try {
  main(process.argv.slice(2));
} catch (err) {
  error(err.message);
  process.exitCode = 1;
}
