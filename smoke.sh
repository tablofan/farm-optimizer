#!/bin/sh
# Browser smoke test: serves the repo, runs smoke-test.html in headless Chrome, and fails unless the
# page printed SMOKE-DONE with no SMOKE-FAIL line. Override the browser with CHROME=/path/to/chrome
# and the port with PORT=… .
set -eu
cd "$(dirname "$0")"
PORT="${PORT:-8731}"
CHROME="${CHROME:-$(command -v google-chrome || command -v google-chrome-stable || command -v chromium || command -v chromium-browser || true)}"
[ -n "$CHROME" ] || { echo "Chrome not found; set CHROME=/path/to/chrome" >&2; exit 2; }

python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER=$!
trap 'kill "$SERVER" 2>/dev/null || true' EXIT
i=0
until python3 -c "import urllib.request,sys; urllib.request.urlopen('http://127.0.0.1:$PORT/smoke-test.html', timeout=1)" 2>/dev/null; do
  i=$((i + 1)); [ "$i" -lt 40 ] || { echo "local server did not start on port $PORT" >&2; exit 2; }
  sleep 0.25
done

OUT="$("$CHROME" --headless=new --no-sandbox --disable-gpu --virtual-time-budget=30000 \
  --dump-dom "http://127.0.0.1:$PORT/smoke-test.html" 2>/dev/null)"
printf '%s\n' "$OUT" | grep -o 'SMOKE-[A-Z]*[^<]*' || true
printf '%s' "$OUT" | grep -q 'SMOKE-DONE' || { echo "FAIL: the smoke test did not finish" >&2; exit 1; }
if printf '%s' "$OUT" | grep -q 'SMOKE-FAIL'; then echo "FAIL: the smoke test has failures" >&2; exit 1; fi
echo "Smoke test passed."
