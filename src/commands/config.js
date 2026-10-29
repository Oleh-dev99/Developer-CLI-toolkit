export function register(program, context) {
  program
    .command("config")
    .description("show the config file in use and the effective settings")
    .addHelpText(
      "after",
      `
Settings are read from ~/.toolsmithrc, or from the file named by the
TOOLSMITH_CONFIG environment variable. The file is JSON, for example:
  { "color": false, "greeting": "Hi" }

Example:
  $ toolsmith config`,
    )
    .action(() => {
      const { path, found, settings } = context.config;
      const file = found ? path : `none, using defaults (no file at ${path})`;
      console.log(`Config file: ${file}`);
      console.log("Settings:");
      for (const [key, value] of Object.entries(settings)) {
        console.log(`  ${key}: ${JSON.stringify(value)}`);
      }
    });
}
