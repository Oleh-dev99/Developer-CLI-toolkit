import { success } from "../output.js";

export function register(program, context) {
  program
    .command("hello")
    .description("print a friendly greeting")
    .argument("[name]", "who to greet", "world")
    .addHelpText(
      "after",
      `
Examples:
  $ toolsmith hello
  Hello, world!

  $ toolsmith hello Ada
  Hello, Ada!

To change "Hello", set "greeting" in ~/.toolsmithrc.`,
    )
    .action((name) => {
      success(`${context.config.settings.greeting}, ${name}!`);
    });
}
