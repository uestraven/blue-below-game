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
| Output directory | `dist` |
| Node version | 20 or newer |

`public/_headers` is picked up automatically. `wrangler.toml` is ignored by
Pages, so the two paths do not conflict.

## What is verified and what is not

Verified on this machine:

- `wrangler deploy --dry-run` accepts the config and reads all 5 files from `dist/`
- Wrangler's own parser reports **"Parsed 4 valid header rules"** from `_headers`
- the game boots, renders and logs nothing with the production CSP applied
- the release build has no debug table at runtime
- the full acceptance suite still passes (259/259) against the test-mode build

**Not verified:** no actual deploy has happened, because that needs your
Cloudflare credentials and is your call to make, not mine. So Cloudflare's
edge behaviour — that it applies these `_headers` rules as written, and that
`not_found_handling` and `html_handling` behave as configured — has only been
validated by Wrangler locally, never observed live. The first deploy is worth
checking with:

```bash
curl -sI https://blue-below.<your-subdomain>.workers.dev/ | grep -i -E 'content-security|cache-control|x-content-type'
curl -s -o /dev/null -w '%{http_code}\n' https://blue-below.<your-subdomain>.workers.dev/nope   # expect 404
```

Local Workers emulation is also unverified here, for the glibc reason above.
