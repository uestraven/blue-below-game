# Deploying BLUE BELOW to Cloudflare

The game is entirely client-side — one HTML file, one CSS file, one JS bundle,
and nothing else. No server code, no API, no database, no secrets, no runtime
network calls. So this is a static deploy: Cloudflare serves three files from
its edge and that is the whole architecture.

## Before you deploy: this makes the game public

`wrangler deploy` puts the build on the public internet at
`https://blue-below.<your-subdomain>.workers.dev`, readable by anyone who finds
the URL, and Cloudflare may cache it. A browser game with no user data and no
backend is legitimately public content, so there is deliberately **no
authentication** here — adding a login would lock out the only audience the
thing has.

What that does mean:

- **The source ships too.** The JS bundle is readable and un-obfuscated. Anyone
  can read the game's logic, including how the door code is generated. That is
  normal for a browser game and it is not a secret worth protecting, but know
  it before you publish.
- **This code was written on an internal machine.** It was swept for
  Amazon-internal references before this doc was written and is clean: no
  internal hostnames, systems, wikis or policies in anything that gets
  deployed. `play.sh` prints your machine's hostname in an SSH hint, but
  `play.sh` is not part of the deploy. Re-check if you add anything.
- **Nothing here deploys on its own.** `cf:deploy` runs only when you run it,
  and it needs credentials you have to provide.

If you would rather it not be world-readable, Cloudflare Access (Zero Trust)
can gate a Worker without touching this code. That is a dashboard-side change
and is out of scope for these files.

## One-time setup

```bash
npx wrangler login              # or export CLOUDFLARE_API_TOKEN=...
```

An API token needs **Workers Scripts: Edit**. Set `account_id` in
`wrangler.toml` if your token covers more than one account.

## Deploy

```bash
npm run cf:check      # validate the config and the upload plan, change nothing
npm run cf:deploy     # run the release gate, then deploy
```

`cf:deploy` will not deploy a build that fails the release gate — see below.

To change the hostname, edit `name` in `wrangler.toml`. For a custom domain,
add a `routes` entry and point DNS at Cloudflare.

## The release gate

```bash
npm run verify:release
```

29 checks against the exact artifact that gets uploaded. It exists because the
acceptance suite drives the game through a debug table that the release build
does not contain, so the tested artifact and the deployed artifact are not
byte-identical. The gate pins the difference to exactly that one thing:

- `dist/` has the expected files and `_headers` was copied in
- no inline `<script>` in the HTML, so the CSP can stay strict
- `window.__BB` is **absent at runtime** in the release build
- `_headers` parses the way Cloudflare parses it, with no malformed lines, under
  the 100-rule limit, and with every security header and cache rule present
- the game **boots and renders with the production CSP actually applied**
  (injected into every response via request interception, not just read out of
  a file), with no console errors

### Why the debug table is build-gated

`window.__BB` can read the run's generated door code straight out of memory.
Harmless on a local build, pointless spoiler on a public one. It is attached
inside an `import.meta.env.VITE_DEBUG_API` branch:

| Command | Debug table | Use |
|---|---|---|
| `npm run dev` | present (`.env.development`) | development |
| `npm run build:test` | present (`.env.test`) | what `npm test` drives |
| `npm run build` | **absent** | what gets deployed |

The branch folds to `false` at build time so the attachment is statically
removed. The method bodies themselves are class methods and still sit in the
bundle unreferenced — the release gate reports this rather than pretending
otherwise. They are unreachable: nothing exposes a handle to the game
instance.

## Response headers

`public/_headers` is copied into `dist/` by Vite and read by both Workers
static assets and Pages. The policy is default-deny with only what the game
actually needs:

```
default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; connect-src 'self'; base-uri 'none';
form-action 'none'; frame-ancestors 'none'; object-src 'none'
```

Each opening is there for a measured reason, not by default:

| Directive | Why |
|---|---|
| `script-src 'self'` | One same-origin module bundle. No inline scripts, no CDN, no `eval` — the bundle was checked for `eval`, `new Function`, workers and blobs, and has none |
| `style-src 'unsafe-inline'` | The interface templates use inline `style=` attributes (the settings sliders need a computed width). The only dynamic string that reaches markup is the journal's clue letters, which go through `escapeHtml`, so there is no injection path. Removing this would mean rewriting the screen templates in CSSOM |
| `img-src data:` | The three ending stills are drawn to a canvas and inlined as `data:` URLs |
| `connect-src 'self'` | Vite's module-preload polyfill fetches the same-origin bundle. The game itself fetches nothing |

Caching: hashed assets are `immutable` for a year (Vite content-hashes every
filename, so they can never go stale); `/` and `/index.html` are
`max-age=0, must-revalidate`, or a deploy would never reach anyone.

Unknown paths return a real 404 (`not_found_handling = "none"`) rather than
serving the game and making a broken link look like it worked.

## Local Workers emulation

```bash
npm run cf:dev
```

**This does not work on the machine this was built on.** `wrangler dev` runs
the real Workers runtime through `workerd`, a prebuilt binary needing
glibc ≥ 2.27; this host has 2.26. `npm run cf:dev` detects that and tells you
so instead of failing with an EPIPE.

It affects local emulation only — `wrangler deploy` is an HTTPS upload and does
not use `workerd`, so deploying from this host is fine. For local play use
`npm run play`, which works here.

## Cloudflare Pages instead

Pages works just as well and needs no local runtime. Point it at the repo and
set:

| Setting | Value |
|---|---|
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | leave blank (repo root) |

Node version needs no dashboard setting: `.nvmrc` (`22`) and the `engines`
field in `package.json` pin it, and Pages reads both. That pin matters — Vite 8
requires Node `^20.19.0 || >=22.12.0`, and the legacy Pages default of Node 18
cannot build this. If a build ever fails on a Node version, set a
`NODE_VERSION` environment variable to `22` in the Pages project as a belt-and-
braces override.

Nothing else needs configuring:

- `public/_headers` is copied into `dist/` by the build and picked up
  automatically, so the CSP and caching rules apply on Pages exactly as they do
  on Workers.
- `wrangler.toml` is ignored by Pages, so the Workers and Pages paths do not
  conflict. Use whichever you prefer.
- `npm install` pulls devDependencies (Pages does this by default), which is
  required: `tsc` and `vite` both live there. The `playwright` devDependency
  has no install script in the pinned version, so no browsers are downloaded
  during the build.
- `.npmrc` pins the public npm registry, so the install does not depend on
  whatever registry a given builder defaults to.

## What is verified and what is not

**Verified live** against the deployed Pages project at
`https://blue-below-game.pages.dev` (HTTP/2, certificate valid):

- the game is served and is the right build — the deployed bundle filename
  matches the local build hash exactly
- Cloudflare applies **every** rule from `public/_headers` at the edge: the
  full CSP, `x-content-type-options`, `referrer-policy`,
  `permissions-policy`, `cross-origin-opener-policy`, and both cache rules
  (`max-age=0, must-revalidate` on `/`, `immutable` on `/assets/*`)
- `_headers` is **not** served as a file; Cloudflare excludes it from the
  output as expected

Verified locally:

- `wrangler deploy --dry-run` accepts the config and reads every file in `dist/`
- Wrangler's own parser reports "Parsed 4 valid header rules" from `_headers`
- the game boots, renders and logs nothing with the production CSP applied
- the release build has no debug table at runtime
- the full acceptance suite passes (259/259) against the test-mode build

**Not verified:** the Workers path (`wrangler deploy`) has never actually been
deployed, so `not_found_handling` and `html_handling` are validated by Wrangler
only. Local Workers emulation does not run on the build host, for the glibc
reason above.

## Pages and Workers differ on unknown paths

Pages ignores `wrangler.toml`, so `not_found_handling = "none"` does not apply
there. Without a `404.html`, Pages answers any unmatched path with the game and
HTTP **200**, which makes a broken link look like it worked. `public/404.html`
fixes that: Pages serves it with a real 404 status. It is deliberately
self-contained, because the built stylesheet has a content-hashed name a static
file cannot reference, and its `<style>` block is permitted by the site CSP.

Confirm after a deploy:

```bash
H=https://blue-below-game.pages.dev
curl -sI  "$H/" | grep -i -E 'content-security|cache-control|x-content-type'
curl -s -o /dev/null -w '%{http_code}\n' "$H/nope"   # expect 404, not 200
```

## If the site will not load at all

`ERR_SSL_VERSION_OR_CIPHER_MISMATCH` and similar TLS errors happen before any
HTTP request, so they are never caused by this code, the CSP or the headers.
They mean the browser could not complete a TLS handshake with that hostname.
Causes, most likely first:

| Cause | Fix |
|---|---|
| A custom domain was added minutes ago and Universal SSL has not issued yet | Wait. Usually a few minutes, up to 24 h. The `*.pages.dev` URL works meanwhile |
| The custom domain is a **multi-level** subdomain (`game.blue.example.com`) | Universal SSL covers the apex and `*.example.com` only, never `*.*.example.com`. Needs Advanced Certificate Manager, or use a single-level subdomain |
| The domain's DNS is not on Cloudflare, or the record is grey-clouded | Point DNS at Cloudflare and enable the proxy |
| Minimum TLS Version set unusually high for the zone | Lower it in SSL/TLS → Edge Certificates |
| Hitting a `workers.dev` URL before that subdomain is enabled | Enable it in the Workers dashboard, or use Pages |

Diagnose a specific hostname with:

```bash
curl -sSv https://<your-host>/ 2>&1 | grep -E 'SSL|TLS|subject|issuer|HTTP'
openssl s_client -connect <your-host>:443 -servername <your-host> </dev/null 2>&1 | head -20
```

If `openssl` reports no peer certificate, the certificate has not been issued
for that hostname yet — that is the first row of the table above.
