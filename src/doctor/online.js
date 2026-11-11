import { Resolver } from "node:dns/promises";
import { isIP } from "node:net";

// Whether there's a connection, for the checks that need the network: whether
// the name of npm's registry (or of the one in npm_config_registry) can be
// looked up, within `timeout` milliseconds. `resolve(host)` does the lookup,
// with the DNS servers themselves rather than a cache or the hosts file; tests
// pass their own, so that they never need a network. A registry given by its
// IP address has no name to look up, so it counts as reachable; the tests of
// toolsmith itself use one (see runCli in test/helpers.js).
export async function isOnline({ host = registryHost(), timeout = 3000, resolve } = {}) {
  if (isIP(host)) {
    return true;
  }
  let resolver;
  if (!resolve) {
    resolver = new Resolver({ timeout, tries: 1 });
    resolve = (name) => resolver.resolve4(name);
  }
  let timer;
  try {
    return await Promise.race([
      Promise.resolve()
        .then(() => resolve(host))
        .then(
          () => true,
          () => false,
        ),
      new Promise((done) => {
        timer = setTimeout(() => done(false), timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    resolver?.cancel();
  }
}

function registryHost() {
  try {
    return new URL(process.env.npm_config_registry).hostname || "registry.npmjs.org";
  } catch {
    return "registry.npmjs.org";
  }
}
