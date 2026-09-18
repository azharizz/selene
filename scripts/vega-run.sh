#!/usr/bin/env bash
# Launch SELENE on the VVD.
#
# The app's WebView loads http://127.0.0.1:<port> per manifest.toml's
# network-traffic-policy. That is the GUEST's loopback, not the host's, so
# without a reverse forward the page never loads, no display power session is
# acquired, and the app is torn down right after launch ("Unable to create
# power components ... has display power session = false").
set -euo pipefail

app_url="$(node -p "require('./src/config.json').appUrl")"
app="${SELENE_APP:-com.selene.tv.main}"

vega_bin="$(command -v vega || true)"
: "${vega_bin:=$HOME/vega/bin/vega}"
[[ -x "$vega_bin" ]] || { echo "vega CLI not found (set PATH or install to ~/vega/bin)" >&2; exit 1; }
vda="$("$vega_bin" which vda)"

if [[ "$app_url" == http://127.0.0.1:* ]]; then
  port="${app_url##*:}"
  curl -fsS -o /dev/null "$app_url/" \
    || { echo "SELENE relay is not answering on 127.0.0.1:${port} — start it with: npm start" >&2; exit 1; }
  # Match the URL written by build:web from the parent .env. Re-adding is a no-op.
  "$vda" reverse "tcp:${port}" "tcp:${port}" >/dev/null
fi

"$vega_bin" device launch-app --appName "$app"
echo "launched $app"
