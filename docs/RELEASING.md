# Releasing toolsmith

Pushing a tag like `v1.2.3` releases that version. GitHub Actions runs the tests, publishes the package to npm as `@oleh-dev99/toolsmith`, and creates the GitHub Release. No npm token is stored in GitHub: the workflow signs in with [trusted publishing](https://docs.npmjs.com/trusted-publishers).

## Which version number

toolsmith follows [Semantic Versioning](https://semver.org/). What it promises to keep working is: command names, options and exit codes, the `--json` output, the settings in `~/.toolsmithrc`, and the plugin API in [PLUGINS.md](PLUGINS.md).

| Bump | When |
|---|---|
| major (`2.0.0`) | Something in that list changes or goes away |
| minor (`1.3.0`) | Something new, and everything in that list still works |
| patch (`1.2.4`) | Only fixes |

Before 1.0.0, a change that breaks something bumps the minor version instead (`0.1.x` to `0.2.0`). The example plugin's peer dependency has to include each new version; a test fails when it doesn't.

## Making a release

1. Start from an up-to-date `main`, and see what changed since the last release. These are raw commits, to write the notes from:

   ```sh
   git switch main
   git pull
   node bin/toolsmith.js git recent --from v0.1.0 --markdown
   ```

2. Write the notes under `[Unreleased]` in `CHANGELOG.md`, for the people using toolsmith, and commit them.

3. Make the release commit and tag, and push them:

   ```sh
   npm version minor -m "Release v%s"    # or patch, or major
   git push --follow-tags
   ```

   `npm version` updates `package.json` and the lock file, moves the notes into a new dated section of the changelog, commits, and creates the tag. If there's nothing under `[Unreleased]`, it stops before changing anything.

The [release workflow](../.github/workflows/release.yml) then runs the same tests as CI. Only if they all pass does it check that the tag matches `package.json` and the changelog, publish to npm, and create the GitHub Release with that version's notes.

**If it fails,** nothing is published unless the tests passed. Use "Re-run failed jobs" on GitHub, for example when GitHub had no macOS runner free ("The job was not acquired by Runner"). Re-running is safe: a version that's already on npm isn't published again.

## The first release

npm only lets you add a trusted publisher to a package that already exists, so the first version is published by hand. This needs an npm account or organization named `oleh-dev99`, with two-factor authentication on.

```sh
npm version 0.1.0 --allow-same-version -m "Release v%s"
npm login
npm publish
git push --follow-tags
```

The workflow sees that 0.1.0 is already on npm, and only creates the GitHub Release.

## Setting up trusted publishing

Do this just before the second release: a new connection expires if it hasn't published within 2 days. On npmjs.com, open the package's **Settings**, then **Trusted publishing**, and add GitHub Actions:

| Field | Value |
|---|---|
| Organization or user | `Oleh-dev99` |
| Repository | `Developer-CLI-toolkit` |
| Workflow filename | `release.yml` |
| Environment | leave empty |
| Allowed actions | turn on `npm publish`; new connections only allow staged publishing unless you do |

Every field is case-sensitive, and npm doesn't check them when you save. A mistake shows up at publish time, as an "Unable to authenticate" error. After the first publish through the workflow, set **Publishing access** to require two-factor authentication and disallow tokens; that doesn't affect trusted publishing.
