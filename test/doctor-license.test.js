import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import license from "../src/doctor/checks/license.js";
import { detectLicenses, expressionIds, namesLicense, suggestedId } from "../src/doctor/licenses.js";
import * as texts from "./fixtures/licenses.js";
import { makeTree } from "./helpers.js";

// toolsmith doctor's license check (src/doctor/checks/license.js), and how it
// tells licenses apart by their text (src/doctor/licenses.js).

const names = (text) => detectLicenses(text).map((found) => found.name);
const packageJson = (fields) => `${JSON.stringify({ name: "demo", version: "1.0.0", ...fields }, null, 2)}\n`;
const check = (tree) => (t) => license.run({ root: makeTree(t, tree), signal: new AbortController().signal });

test("common licenses are told apart by their text", () => {
  assert.deepEqual(names(texts.mit), ["MIT"]);
  assert.deepEqual(names(texts.isc), ["ISC"]);
  assert.deepEqual(names(texts.apache), ["Apache-2.0"]);
  assert.deepEqual(names(texts.bsd2), ["BSD-2-Clause"]);
  assert.deepEqual(names(texts.bsd3), ["BSD-3-Clause"]);
  assert.deepEqual(names(texts.bsd4), ["BSD-4-Clause"]);
  assert.deepEqual(names(texts.gpl2), ["GPL-2.0"]);
  assert.deepEqual(names(texts.gpl3), ["GPL-3.0"]);
  assert.deepEqual(names(texts.lgpl2), ["LGPL-2.0"]);
  assert.deepEqual(names(texts.lgpl21), ["LGPL-2.1"]);
  assert.deepEqual(names(texts.lgpl3), ["LGPL-3.0"]);
  assert.deepEqual(names(texts.agpl3), ["AGPL-3.0"]);
  assert.deepEqual(names(texts.mpl2), ["MPL-2.0"]);
  assert.deepEqual(names(texts.unlicense), ["Unlicense"]);
  // The older ISC text says "and" where the newer one says "and/or".
  assert.deepEqual(names(texts.isc.replace("and/or", "and")), ["ISC"]);
});

test("the text is matched whatever its line breaks, punctuation and Markdown", () => {
  const markdown = texts.mit
    .replace("MIT License", "# MIT License")
    .replace('(the "Software")', "(the “Software”)")
    .replaceAll("\n", "\r\n")
    .replace("copy\r\nof", "copy of");
  assert.deepEqual(names(markdown), ["MIT"]);
  assert.deepEqual(names(texts.mit.toUpperCase()), ["MIT"]);
});

test("a text that isn't a known license, or was changed, isn't guessed", () => {
  assert.deepEqual(names(""), []);
  assert.deepEqual(names("All rights reserved. Ask before you use this."), []);
  // MIT without the condition that the notice stays (that's MIT-0).
  const noNotice = texts.mit.replace(/The above copyright notice[\s\S]*?Software\.\n/, "");
  assert.deepEqual(names(noNotice), []);
  // ISC without the condition (that's 0BSD).
  assert.deepEqual(names(texts.isc.replace(/, provided that[\s\S]*?copies\./, ".")), []);
  // The title of a GNU license, mentioned in another one, isn't that license.
  assert.deepEqual(names(texts.gpl2), ["GPL-2.0"]);
});

test("a file with several licenses has its own first, then those of the code it includes", () => {
  const withNotices = `${texts.mit}\n\nThis package includes code under these licenses:\n\n${texts.bsd3}\n${texts.isc}`;
  assert.deepEqual(names(withNotices), ["MIT", "BSD-3-Clause", "ISC"]);
});

test("SPDX expressions name their licenses, in any case, with the GNU ones in either form", () => {
  assert.deepEqual(expressionIds("MIT"), ["MIT"]);
  assert.deepEqual(expressionIds("(MIT OR Apache-2.0)"), ["MIT", "Apache-2.0"]);
  assert.deepEqual(expressionIds("(MIT AND (BSD-3-Clause or ISC))"), ["MIT", "BSD-3-Clause", "ISC"]);
  assert.deepEqual(expressionIds("GPL-2.0-only WITH Classpath-exception-2.0"), ["GPL-2.0-only"]);
  const [mit] = detectLicenses(texts.mit);
  const [gpl3] = detectLicenses(texts.gpl3);
  assert.ok(namesLicense("mit", mit));
  assert.ok(namesLicense("(Apache-2.0 OR MIT)", mit));
  assert.ok(!namesLicense("ISC", mit));
  assert.ok(!namesLicense("MIT-0", mit));
  for (const id of ["GPL-3.0-only", "GPL-3.0-or-later", "GPL-3.0", "GPL-3.0+"]) {
    assert.ok(namesLicense(id, gpl3), id);
  }
  assert.ok(!namesLicense("GPL-2.0-or-later", gpl3));
  assert.equal(suggestedId(mit), '"MIT"');
  assert.equal(suggestedId(gpl3), '"GPL-3.0-only" or "GPL-3.0-or-later"');
});

test("a LICENSE file with the license that package.json names is all right, in any of their forms", async (t) => {
  assert.deepEqual(await check({ "package.json": packageJson({ license: "MIT" }), LICENSE: texts.mit })(t), []);
  assert.deepEqual(await check({ "package.json": packageJson({ license: "ISC" }), "LICENSE.md": texts.isc })(t), []);
  assert.deepEqual(await check({ "package.json": packageJson({ license: "GPL-3.0-or-later" }), COPYING: texts.gpl3 })(t), []);
  // Dual licensing, with a file for each license.
  const dual = { "package.json": packageJson({ license: "(MIT OR Apache-2.0)" }), "LICENSE-MIT": texts.mit, "LICENSE-APACHE": texts.apache };
  assert.deepEqual(await check(dual)(t), []);
  // package.json saved with a byte order mark.
  assert.deepEqual(await check({ "package.json": `﻿${packageJson({ license: "MIT" })}`, LICENSE: texts.mit })(t), []);
});

test("this repository's own license is in order", async () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  assert.deepEqual(await license.run({ root, signal: new AbortController().signal }), []);
});

test("a LICENSE file with another license than package.json names is an error at its \"license\"", async (t) => {
  const findings = await check({ "package.json": packageJson({ license: "MIT" }), LICENSE: texts.isc })(t);
  assert.deepEqual(findings, [
    {
      severity: "error",
      file: "package.json",
      line: 4,
      message: '"license" in package.json is MIT, but LICENSE has the ISC license text',
      fix: 'Make them agree: set "license" to "ISC", or put the MIT license text in LICENSE.',
    },
  ]);
  const [gpl] = await check({ "package.json": packageJson({ license: "MIT" }), COPYING: texts.gpl3 })(t);
  assert.match(gpl.fix, /set "license" to "GPL-3\.0-only" or "GPL-3\.0-or-later"/);
});

test("a license in package.json without a LICENSE file is an error, and no license at all a warning", async (t) => {
  assert.deepEqual(await check({ "package.json": packageJson({ license: "MIT" }) })(t), [
    {
      severity: "error",
      file: "package.json",
      line: 4,
      message: '"license" in package.json is MIT, but there\'s no LICENSE file with its text',
      fix: "Add a LICENSE file with the MIT license text, with the year and your name in it.",
    },
  ]);
  const [none] = await check({ "package.json": packageJson({}) })(t);
  assert.equal(none.severity, "warning");
  assert.equal(none.file, "package.json");
  assert.equal(none.line, undefined);
  assert.equal(none.message, 'the project has no license: no LICENSE file, and no "license" in package.json');
  assert.match(none.fix, /choosealicense\.com.*"UNLICENSED"/);
  // An empty "license" is none.
  assert.equal((await check({ "package.json": packageJson({ license: " " }) })(t))[0].message, none.message);
  // A private package needs no license.
  assert.deepEqual(await check({ "package.json": packageJson({ private: true }) })(t), []);
});

test("UNLICENSED needs no LICENSE file, but contradicts an open source one", async (t) => {
  assert.deepEqual(await check({ "package.json": packageJson({ license: "UNLICENSED" }) })(t), []);
  // Terms of one's own are what UNLICENSED leads one to expect.
  assert.deepEqual(await check({ "package.json": packageJson({ license: "unlicensed" }), LICENSE: "Proprietary. All rights reserved." })(t), []);
  const [open] = await check({ "package.json": packageJson({ license: "UNLICENSED" }), LICENSE: texts.mit })(t);
  assert.equal(open.severity, "warning");
  assert.equal(open.message, '"license" in package.json is UNLICENSED, meaning that no one else may use the code, but LICENSE has the MIT license text');
  assert.equal(open.fix, 'Set "license" to "MIT", or remove LICENSE if the code isn\'t open source.');
});

test("a text that toolsmith doesn't know is a warning, not a guess", async (t) => {
  const changed = texts.mit.replace("free of charge", "for a small fee");
  assert.deepEqual(await check({ "package.json": packageJson({ license: "MIT" }), LICENSE: changed })(t), [
    {
      severity: "warning",
      file: "LICENSE",
      message: "can't tell which license LICENSE has: its text isn't one that toolsmith knows",
      fix: 'If it\'s meant to be a common license, use the standard MIT text, from https://spdx.org/licenses/MIT.html; if it\'s a license of your own, set "license" in package.json to "SEE LICENSE IN LICENSE".',
    },
  ]);
});

test('"SEE LICENSE IN" points to a file of any text, which must be there', async (t) => {
  const own = { license: "SEE LICENSE IN TERMS.txt" };
  assert.deepEqual(await check({ "package.json": packageJson(own), "TERMS.txt": "Terms of my own." })(t), []);
  assert.deepEqual(await check({ "package.json": packageJson({ license: "SEE LICENSE IN LICENSE" }), LICENSE: "Terms of my own." })(t), []);
  assert.deepEqual(await check({ "package.json": packageJson(own) })(t), [
    {
      severity: "error",
      file: "package.json",
      line: 4,
      message: '"license" in package.json points to TERMS.txt, but there\'s no such file',
      fix: 'Add TERMS.txt with the license\'s terms, or correct the file name in "license".',
    },
  ]);
});

test('a LICENSE file without "license" in package.json is a warning that suggests it', async (t) => {
  assert.deepEqual(await check({ "package.json": packageJson({}), "LICENSE.txt": texts.bsd3 })(t), [
    {
      severity: "warning",
      file: "package.json",
      message: 'package.json has no "license", but LICENSE.txt has the BSD-3-Clause license text',
      fix: 'Add "license": "BSD-3-Clause" to package.json.',
    },
  ]);
});

test("without a package.json, only the LICENSE file is checked", async (t) => {
  assert.deepEqual(await check({ LICENSE: texts.mit })(t), []);
  assert.equal((await check({ LICENSE: "Mine." })(t))[0].severity, "warning");
  assert.deepEqual(await check({ "README.md": "# Demo\n" })(t), [
    {
      severity: "warning",
      message: "the project has no LICENSE file",
      fix: 'Choose a license (https://choosealicense.com) and put its text in a LICENSE file, and its SPDX identifier in "license" in package.json; or set "license" to "UNLICENSED" if no one else may use the code.',
    },
  ]);
});

test("a package.json that can't be read is an error at the line where it goes wrong", async (t) => {
  const [broken] = await check({ "package.json": '{\n  "name": "demo",\n  "license": "MIT"\n  "version": "1.0.0"\n}\n', LICENSE: texts.mit })(t);
  assert.equal(broken.severity, "error");
  assert.equal(broken.file, "package.json");
  assert.equal(broken.line, 4);
  assert.match(broken.message, /^package\.json isn't valid JSON: /);
  assert.deepEqual(await check({ "package.json": "[]\n", LICENSE: texts.mit })(t), [
    { severity: "error", file: "package.json", message: "package.json doesn't hold a JSON object", fix: "Make it an object, like npm init writes." },
  ]);
  const [object] = await check({ "package.json": packageJson({ license: { type: "MIT" } }), LICENSE: texts.mit })(t);
  assert.equal(object.severity, "warning");
  assert.equal(object.line, 4);
  assert.equal(object.message, '"license" in package.json isn\'t text like "MIT"');
});

test("license files go by their names, in any case and with an extension or suffix, but code isn't one", async (t) => {
  const tree = {
    "package.json": packageJson({ license: "MIT" }),
    "licence.md": texts.mit,
    "license-checker.js": "console.log('not a license');\n",
    "LICENSE.json": "{}",
    "docs/LICENSE": "Not in the project's folder.",
  };
  assert.deepEqual(await check(tree)(t), []);
  const findings = await check({ ...tree, "COPYING.LESSER": "Mine." })(t);
  assert.deepEqual(
    findings.map((finding) => finding.file),
    ["COPYING.LESSER"],
  );
});
