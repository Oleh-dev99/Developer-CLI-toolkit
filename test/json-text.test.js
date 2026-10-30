import assert from "node:assert/strict";
import { test } from "node:test";
import { setTopLevelValue } from "../src/lib/json-text.js";

test("changing a value leaves everything else as it was", () => {
  const text =
    '{\r\n\t"color": false,\r\n\t"protectedBranches": ["main", "develop"],\r\n\t"plugins": {"a": true},\r\n' +
    '\t"greeting": "say \\"}\\" twice"\r\n}\r\n';
  assert.equal(
    setTopLevelValue(text, "plugins", { a: true, b: false }),
    '{\r\n\t"color": false,\r\n\t"protectedBranches": ["main", "develop"],\r\n\t"plugins": {\r\n\t\t"a": true,\r\n' +
      '\t\t"b": false\r\n\t},\r\n\t"greeting": "say \\"}\\" twice"\r\n}\r\n',
  );
});

test("a new key goes at the end, indented like the rest of the file", () => {
  const text = '{\n    "greeting": "Hi",\n    "templates": { "x": "a } b" }\n}\n';
  assert.equal(
    setTopLevelValue(text, "plugins", { a: false }),
    '{\n    "greeting": "Hi",\n    "templates": { "x": "a } b" },\n    "plugins": {\n        "a": false\n    }\n}\n',
  );
});

test("a one-line object stays on one line, and an empty one gets lines", () => {
  assert.equal(
    setTopLevelValue('{ "color": false }', "plugins", { a: false }),
    '{ "color": false, "plugins": { "a": false } }',
  );
  assert.equal(setTopLevelValue("{}", "plugins", { a: false }), '{\n  "plugins": {\n    "a": false\n  }\n}');
});

test("of a key that appears twice, the last one changes, as JSON.parse uses it", () => {
  assert.equal(
    setTopLevelValue('{"plugins": {}, "plugins": {"x": true}}', "plugins", { y: 1 }),
    '{"plugins": {}, "plugins": { "y": 1 }}',
  );
});

test("text that isn't a JSON object is an error", () => {
  assert.throws(() => setTopLevelValue("[1, 2]", "plugins", {}), { message: "the JSON isn't an object" });
  assert.throws(() => setTopLevelValue("{", "plugins", {}), SyntaxError);
});
