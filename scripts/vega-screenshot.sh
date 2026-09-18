#!/usr/bin/env bash
# Capture a VVD frame via QEMU QMP screendump.
#
# The obvious paths do not work on Vega:
#   - `screencap` is Android-only and does not exist on Vega OS (0-byte file).
#   - on-device `screenshooter`/`gwsi-tool-screenshooter` need a 1920*1080*4 =
#     8294400 B Wayland shm buffer, but /dev/shm on the VVD is capped at 5 MiB,
#     so the allocation fails ("Permission denied") and it writes a 0-byte PNG.
# QMP renders host-side from the emulated framebuffer, so neither limit applies.
set -euo pipefail

out="${1:-artifacts/vega-launch.png}"
port="${VVD_QMP_PORT:-5554}"
sock="${VVD_QMP_SOCK:-/tmp/qmp-socket-${port}.sock}"

[[ -S "$sock" ]] || { echo "QMP socket not found: $sock (is the VVD running? npm run vega:vvd)" >&2; exit 1; }

mkdir -p "$(dirname "$out")"
ppm="$(mktemp -t vega-shot).ppm"
trap 'rm -f "$ppm"' EXIT

python3 - "$sock" "$ppm" <<'PY'
import json, socket, sys
sock, out = sys.argv[1], sys.argv[2]
s = socket.socket(socket.AF_UNIX); s.settimeout(30); s.connect(sock)
f = s.makefile("rwb"); f.readline()  # greeting

def cmd(c):
    f.write((json.dumps(c) + "\n").encode()); f.flush()
    while True:
        d = json.loads(f.readline().decode().strip())
        if "event" not in d:
            return d

cmd({"execute": "qmp_capabilities"})
r = cmd({"execute": "screendump", "arguments": {"filename": out}})
if "error" in r:
    sys.exit("screendump failed: %s" % r["error"])
PY

[[ -s "$ppm" ]] || { echo "screendump produced no data" >&2; exit 1; }
sips -s format png "$ppm" --out "$out" >/dev/null
echo "$out ($(stat -f%z "$out") bytes)"
