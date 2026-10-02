#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

vega_bin="$(command -v vega || true)"
: "${vega_bin:=$HOME/vega/bin/vega}"
[[ -x "$vega_bin" ]] || { echo "Vega CLI not found. Add it to PATH or install it at ~/vega/bin." >&2; exit 1; }

package="build/aarch64-debug/selene_aarch64.vpkg"
[[ -f "$package" ]] || { echo "Debug package missing. Run: npm run build:debug" >&2; exit 1; }

app_url="$(node -p "require('./src/config.json').appUrl")"
vvd_log="$(mktemp -t selene-vvd)"
vvd_pid=""
vvd_owned=0
relay_pid=""
tunnel_pid=""
phone_mode="${SELENE_PHONE_PAIRING:-0}"
remote_phone=0
relay_port="${app_url##*:}"
private_url=""

cleanup() {
  echo "Stopping this test session..."
  if [[ -n "$relay_pid" ]]; then kill "$relay_pid" 2>/dev/null || true; fi
  if [[ -n "$tunnel_pid" ]]; then kill "$tunnel_pid" 2>/dev/null || true; fi
  if [[ "$vvd_owned" == 1 ]]; then "$vega_bin" virtual-device stop >/dev/null 2>&1 || true; fi
  if [[ -n "$vvd_pid" ]]; then kill "$vvd_pid" 2>/dev/null || true; fi
  rm -f "$vvd_log" "$vvd_log.ngrok"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ "$phone_mode" == 1 ]]; then
  if [[ "$app_url" == https://* ]]; then
    curl -fsS -o /dev/null "$app_url/api/health" || { echo "Configured HTTPS SELENE service is unreachable: $app_url" >&2; exit 1; }
    remote_phone=1
    private_url="$app_url"
  else
    command -v ngrok >/dev/null || { echo "ngrok is required for local phone pairing. Install it with: brew install ngrok" >&2; exit 1; }
    if curl -fsS -o /dev/null "$app_url/"; then
      echo "Stop the already-running local relay, then retry so it can start with the HTTPS phone URL." >&2
      exit 1
    fi
    if curl -fsS -o /dev/null http://127.0.0.1:4040/api/tunnels; then
      echo "An ngrok agent is already using the local tunnel API on port 4040. Stop it, then retry." >&2
      exit 1
    fi
  fi
fi

echo "Starting Vega Virtual Device at 1280x720..."
vvd_status="$("$vega_bin" virtual-device status 2>/dev/null || true)"
if [[ "$vvd_status" =~ '"running":true' ]]; then
  echo "A Vega Virtual Device is already running. Stop it first with: vega virtual-device stop" >&2
  exit 1
fi
npm run vega:vvd >"$vvd_log" 2>&1 &
vvd_pid=$!
vvd_owned=1

for _ in $(seq 1 180); do
  if grep -q "Vega virtual device is running" "$vvd_log"; then break; fi
  if ! kill -0 "$vvd_pid" 2>/dev/null; then
    cat "$vvd_log" >&2
    echo "Vega Virtual Device exited before it was ready." >&2
    exit 1
  fi
  sleep 1
done
if ! grep -q "Vega virtual device is running" "$vvd_log"; then
  tail -40 "$vvd_log" >&2
  echo "Timed out waiting for Vega Virtual Device startup." >&2
  exit 1
fi

if [[ "$phone_mode" == 1 && "$remote_phone" == 0 ]]; then
  echo "Starting temporary HTTPS tunnel for phone pairing..."
  ngrok http "$relay_port" --log=stdout >"$vvd_log.ngrok" 2>&1 &
  tunnel_pid=$!
  for _ in $(seq 1 45); do
    private_url="$(curl -fsS http://127.0.0.1:4040/api/tunnels 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).tunnels.find(t=>t.public_url.startsWith('https://'))?.public_url||'')}catch{console.log('')})")"
    [[ -n "$private_url" ]] && break
    if ! kill -0 "$tunnel_pid" 2>/dev/null; then
      cat "$vvd_log.ngrok" >&2
      echo "ngrok exited. Check its login with: ngrok config add-authtoken <your-token>" >&2
      exit 1
    fi
    sleep 1
  done
  if [[ -z "$private_url" ]]; then
    tail -40 "$vvd_log.ngrok" >&2
    echo "Timed out waiting for ngrok. Configure its account token, then retry." >&2
    exit 1
  fi
  echo "Phone pairing URL: $private_url"
  SELENE_PRIVATE_URL="$private_url" node --env-file=../.env server/index.mjs &
  relay_pid=$!
  ready=0
  for _ in $(seq 1 60); do
    if curl -fsS -o /dev/null "$app_url/"; then ready=1; break; fi
    if ! kill -0 "$relay_pid" 2>/dev/null; then
      echo "SELENE relay exited. Check ../.env and the startup error above." >&2
      exit 1
    fi
    sleep 1
  done
  [[ "$ready" == 1 ]] || { echo "Timed out waiting for SELENE relay at $app_url" >&2; exit 1; }
elif [[ "$remote_phone" == 0 ]] && ! curl -fsS -o /dev/null "$app_url/"; then
  echo "Starting SELENE relay..."
  node --env-file=../.env server/index.mjs &
  relay_pid=$!
  ready=0
  for _ in $(seq 1 60); do
    if curl -fsS -o /dev/null "$app_url/"; then ready=1; break; fi
    if ! kill -0 "$relay_pid" 2>/dev/null; then
      echo "SELENE relay exited. Check ../.env and the startup error above." >&2
      exit 1
    fi
    sleep 1
  done
  [[ "$ready" == 1 ]] || { echo "Timed out waiting for SELENE relay at $app_url" >&2; exit 1; }
elif [[ "$remote_phone" == 0 ]]; then
  echo "Using the already-running SELENE relay at $app_url."
else
  echo "Using the deployed HTTPS SELENE relay at $app_url. No local tunnel is needed."
fi

echo "Installing the existing debug package..."
"$vega_bin" device install-app --device VirtualDevice --packagePath "$package"
npm run vega:run
if [[ "$phone_mode" == 1 ]]; then
  echo "SELENE is running. On your phone, open $private_url and join with the code shown on the TV. Press Ctrl+C here to stop the VDA, relay, and tunnel."
else
  echo "SELENE is running. Use the Vega Virtual Device window and press Ctrl+C here to stop."
fi
while true; do sleep 3600; done
