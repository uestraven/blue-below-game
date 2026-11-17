#!/usr/bin/env bash
#
# BLUE BELOW - local launcher.
#
#   ./play.sh                 build, serve on 127.0.0.1:4173, open a browser
#   ./play.sh --dev           dev server with hot reload instead
#   ./play.sh --port 5050     use a different port
#   ./play.sh --no-open       just print the URL
#   ./play.sh --no-build      skip the build and serve whatever is in dist/
#   ./play.sh --help
#
# The server binds to 127.0.0.1 only and is never reachable from another
# machine. If you are on a remote desktop and want to play from your laptop,
# forward the port over SSH rather than widening the bind:
#
#   ssh -N -L 4173:127.0.0.1:4173 <this-host>
#
# then open http://127.0.0.1:4173 on the laptop.
#
# Ctrl-C shuts the server down. So does closing the terminal: the trap below
# kills it on any exit path, and the script refuses to leave a stray listener
# behind.

set -euo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

PORT=4173
MODE=preview
DO_OPEN=1
DO_BUILD=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dev)      MODE=dev; PORT=5173; shift ;;
    --port)     PORT="${2:?--port needs a number}"; shift 2 ;;
    --port=*)   PORT="${1#*=}"; shift ;;
    --no-open)  DO_OPEN=0; shift ;;
    --no-build) DO_BUILD=0; shift ;;
    -h|--help)
      awk 'NR > 1 { if ($0 ~ /^#/) { sub(/^# ?/, ""); print } else { exit } }' "${BASH_SOURCE[0]}"
      exit 0 ;;
    *)
      echo "play.sh: unknown option '$1' (try --help)" >&2
      exit 2 ;;
  esac
done

say()  { printf '\033[36m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*" >&2; }
die()  { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- prereqs

command -v node >/dev/null 2>&1 || die "node is not on PATH. BLUE BELOW needs Node 20 or newer."
command -v npm  >/dev/null 2>&1 || die "npm is not on PATH."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if (( NODE_MAJOR < 20 )); then
  die "Node $(node -v) is too old. BLUE BELOW needs Node 20 or newer."
fi

if [[ ! -d node_modules ]]; then
  say "Installing dependencies (first run only)..."
  npm install --no-audit --no-fund || die "npm install failed. Check your network or npm registry settings."
fi

# ------------------------------------------------------------- free port

port_free() {
  node -e '
    const net = require("net");
    const s = net.createServer();
    s.once("error", () => process.exit(1));
    s.once("listening", () => s.close(() => process.exit(0)));
    s.listen(Number(process.argv[1]), "127.0.0.1");
  ' "$1" >/dev/null 2>&1
}

ORIGINAL_PORT="$PORT"
for _ in $(seq 0 20); do
  port_free "$PORT" && break
  PORT=$((PORT + 1))
done
port_free "$PORT" || die "Could not find a free port near $ORIGINAL_PORT."
if [[ "$PORT" != "$ORIGINAL_PORT" ]]; then
  warn "Port $ORIGINAL_PORT was busy; using $PORT instead."
fi

# ----------------------------------------------------------------- build

if [[ "$MODE" == preview && "$DO_BUILD" == 1 ]]; then
  say "Building..."
  npm run build >/tmp/blue-below-build.$$.log 2>&1 || {
    tail -30 /tmp/blue-below-build.$$.log >&2
    rm -f /tmp/blue-below-build.$$.log
    die "Build failed (output above)."
  }
  rm -f /tmp/blue-below-build.$$.log
fi

if [[ "$MODE" == preview && ! -f dist/index.html ]]; then
  die "No build in dist/. Run without --no-build."
fi

# ----------------------------------------------------------------- serve

SERVER_PID=""
SERVER_LOG=""

# Kill a process and everything it spawned, deepest first.
kill_tree() {
  local pid="$1" sig="${2:-TERM}" child
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    kill_tree "$child" "$sig"
  done
  kill "-$sig" "$pid" 2>/dev/null || true
}

cleanup() {
  local code=$?
  trap - EXIT INT TERM HUP
  if [[ -n "$SERVER_PID" ]]; then
    printf '\n'
    say "Shutting the server down..."
    kill_tree "$SERVER_PID" TERM
    for _ in $(seq 1 30); do
      kill -0 "$SERVER_PID" 2>/dev/null || break
      sleep 0.1
    done
    if kill -0 "$SERVER_PID" 2>/dev/null; then kill_tree "$SERVER_PID" KILL; fi
  fi
  # Backstop: npx can outlive its parent, so make sure nothing of ours is
  # still holding the port. --strictPort means only our process can be on it.
  if ! port_free "$PORT"; then
    pkill -f "vite $MODE --host 127.0.0.1 --port $PORT" 2>/dev/null || true
    sleep 0.4
  fi
  rm -f "${SERVER_LOG:-}" 2>/dev/null || true
  if port_free "$PORT"; then
    say "Port $PORT released. No listener left behind."
  else
    warn "Port $PORT still looks occupied. Check with: ss -ltnp | grep $PORT"
  fi
  exit "$code"
}

trap cleanup EXIT INT TERM HUP

say "Starting the $MODE server on 127.0.0.1:$PORT (loopback only)..."
SERVER_LOG="$(mktemp -t blue-below-server.XXXXXX.log)"
npx vite "$MODE" --host 127.0.0.1 --port "$PORT" --strictPort >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

URL="http://127.0.0.1:$PORT/"

# Wait for it to answer, or report why it did not.
READY=0
for _ in $(seq 1 120); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    warn "Server exited during start-up:"
    tail -20 "$SERVER_LOG" >&2
    exit 1
  fi
  if node -e '
      const http = require("http");
      http.get(process.argv[1], r => process.exit(r.statusCode < 500 ? 0 : 1))
          .on("error", () => process.exit(1));
    ' "$URL" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 0.25
done

if [[ "$READY" != 1 ]]; then
  warn "Server did not answer on $URL within 30s:"
  tail -20 "$SERVER_LOG" >&2
  exit 1
fi

# ------------------------------------------------------------------ open

opened=0
if [[ "$DO_OPEN" == 1 ]]; then
  if [[ "$(uname -s)" == "Darwin" ]] && command -v open >/dev/null 2>&1; then
    open "$URL" >/dev/null 2>&1 && opened=1
  elif [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]] && command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL" >/dev/null 2>&1 && opened=1
  fi
fi

cat <<BANNER

  ====================================================================
    B L U E   B E L O W
  ====================================================================

    $URL

$(if [[ "$opened" == 1 ]]; then
echo "    A browser should be opening. If it did not, paste the URL above."
else
echo "    Open that URL in a desktop browser with WebGL 2."
echo "    (No display detected here, or --no-open was passed.)"
fi)

    Playing from another machine? Do not widen the bind - tunnel it:
      ssh -N -L $PORT:127.0.0.1:$PORT $(hostname -f 2>/dev/null || hostname)
    then open http://127.0.0.1:$PORT on that machine.

    Controls:  WASD move  ·  mouse look  ·  Shift sprint  ·  E interact
               left click fire  ·  Esc close/pause  ·  Tab clue journal

    Click the page once to give it the mouse.

    Press Ctrl-C here to stop the server.

BANNER

# Hold the terminal until the server dies or the user interrupts.
wait "$SERVER_PID" 2>/dev/null || true
