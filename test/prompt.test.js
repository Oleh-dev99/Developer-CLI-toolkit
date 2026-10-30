import assert from "node:assert/strict";
import { PassThrough, Writable } from "node:stream";
import { test } from "node:test";
import { createPrompt, PromptCancelled } from "../src/lib/prompt.js";
import { promptStreams } from "./helpers.js";

test("ask shows the default in brackets, and Enter takes it", async () => {
  const io = promptStreams("\nAda Lovelace\n");
  const prompt = createPrompt(io);
  assert.equal(await prompt.ask("Name", { defaultValue: "my-app" }), "my-app");
  assert.equal(await prompt.ask("Author", { defaultValue: "Grace Hopper" }), "Ada Lovelace");
  prompt.close();
  assert.equal(io.written(), "Name [my-app]: Author [Grace Hopper]: ");
});

test("ask explains a bad or empty answer and asks again", async () => {
  const io = promptStreams("a/b\n\nok\n");
  const prompt = createPrompt(io);
  const validate = (value) => (value.includes("/") ? `"${value}" has a slash.` : undefined);
  assert.equal(await prompt.ask("Name", { validate }), "ok");
  prompt.close();
  assert.equal(io.written(), 'Name:   "a/b" has a slash.\nName:   Please enter a value.\nName: ');
});

test("answers piped in all at once reach the right questions", async () => {
  const io = promptStreams("y\nno\n");
  const prompt = createPrompt(io);
  assert.equal(await prompt.confirm("First? "), true);
  assert.equal(await prompt.confirm("Second? "), false);
  // The input has ended, which is a no.
  assert.equal(await prompt.confirm("Third? "), false);
  prompt.close();
  assert.equal(io.written(), "First? Second? Third? \n");
});

test("the end of the input cancels a question", async () => {
  const io = promptStreams("");
  const prompt = createPrompt(io);
  await assert.rejects(prompt.ask("Name"), PromptCancelled);
  assert.equal(io.written(), "Name: \n");
});

test("Ctrl+C in a terminal cancels a question", async () => {
  const input = new PassThrough();
  const output = new Writable({ write: (chunk, encoding, callback) => callback() });
  const prompt = createPrompt({ input, output, terminal: true });
  const answer = prompt.ask("Name");
  input.write("\x03");
  await assert.rejects(answer, PromptCancelled);
});
