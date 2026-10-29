export function register(program) {
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
  Hello, Ada!`,
    )
    .action((name) => {
      console.log(`Hello, ${name}!`);
    });
}
