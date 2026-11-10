import { colorsFor } from "../output.js";

export function register(program, context) {
  program
    .command("ui")
    .description("open a full-screen dashboard in the terminal")
    .addHelpText(
      "after",
      `
Example:
  $ toolsmith ui

The Commands panel lists every command, plugin commands included. Enter opens
a form for its arguments and options, shows the command line they add up to,
and runs it, with its output in a panel that scrolls; Esc or Ctrl+C cancels a
command that's still running. A command that can ask questions only runs with
--yes ticked; otherwise run it in a terminal of its own.

The Files panel shows the current folder as a tree, without .git and
node_modules, with sizes. Right or Enter opens a folder and Left closes it;
Enter on a file shows it. e edits a file in $VISUAL or $EDITOR, o opens a file
or folder in its default app, and s, d and r run size, dupes and a rename
preview (--dry-run) on the selected folder.

In the dashboard, ? shows every shortcut. Arrow keys or h, j, k and l move,
Tab and Shift+Tab switch panels, Enter opens, Esc goes back, / filters the list
as you type, and q or Ctrl+C quits. With Node.js 22, the classic Windows
console sends Shift+Tab as Tab; Left or h goes to the previous panel there.

The dashboard needs a terminal of at least 40x10, and says so in a smaller one
until the window is made bigger. Its colors follow --no-color, NO_COLOR and the
"color" setting, like the other commands. The Git status panel is still being
built.

It needs a terminal for both its input and its output, so it doesn't run in
scripts, in CI, or with its input or output redirected. Use the plain commands
there, like toolsmith size or toolsmith git recent.`,
    )
    .action(async () => {
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        throw new Error(
          "toolsmith ui needs a terminal for its input and output; in scripts and pipes, use the plain commands instead (toolsmith --help lists them)",
        );
      }
      // Every command, plugin commands included, for the Commands panel.
      const everything = await context.allCommands();
      // Imported only now, so that other commands don't load the UI's code.
      const { runUi } = await import("../tui/app.js");
      await runUi({ color: colorsFor(process.stdout), program: everything });
    });
}
