// The documentation site, built with VitePress from the pages in docs/ and
// published to GitHub Pages by .github/workflows/docs.yml. This is a plain
// object, without VitePress's defineConfig(), so that the tests can read it
// without installing the site's dependencies.

const repository = "https://github.com/Oleh-dev99/Developer-CLI-toolkit";

export default {
  lang: "en-US",
  title: "toolsmith",
  description: "A command-line toolkit for developers: project templates, git helpers, file tools and plugins",

  // A GitHub Pages project site lives under the repository's name.
  base: "/Developer-CLI-toolkit/",

  // RELEASING.md is for maintainers. The plugin guide keeps its file name,
  // because the README on npm and older releases link to it.
  srcExclude: ["RELEASING.md"],
  rewrites: { "PLUGINS.md": "plugins.md" },

  themeConfig: {
    nav: [
      { text: "Guide", link: "/getting-started" },
      { text: "Commands", link: "/commands" },
      { text: "Plugins", link: "/plugins" },
      { text: "Changelog", link: `${repository}/blob/main/CHANGELOG.md` },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting started", link: "/getting-started" },
          { text: "Configuration", link: "/configuration" },
        ],
      },
      {
        // Made from the CLI's own --help by `npm run docs:commands`.
        text: "Reference",
        items: [{ text: "Commands", link: "/commands" }],
      },
      {
        text: "Plugins",
        items: [{ text: "Writing plugins", link: "/plugins" }],
      },
    ],
    search: { provider: "local" },
    socialLinks: [{ icon: "github", link: repository }],
    footer: { message: "Released under the MIT License." },
  },
};
