#!/usr/bin/env bash
# Generate a test clip ON the VVD with Vega's built-in GStreamer and pull it back.
#
# Vega OS ships no sample media files, but it does ship videotestsrc/audiotestsrc
# and 143 GStreamer plugins, so test content is synthesized rather than stored.
# Note: no x264enc on device -> VP8/WebM. gst-launch-1.0 trips an APMF assert
# during teardown ("schema.elsz >= 1"), AFTER the file is written; harmless here.
set -euo pipefail

pattern="${1:-smpte}"      # smpte | snow | ball | pinwheel | gradient | ... (24 total)
seconds="${2:-2}"
out="${3:-artifacts/testsrc-${pattern}.webm}"
fps=30

vega_bin="$(command -v vega || true)"
: "${vega_bin:=$HOME/vega/bin/vega}"
[[ -x "$vega_bin" ]] || { echo "vega CLI not found (set PATH or install to ~/vega/bin)" >&2; exit 1; }
vda="$("$vega_bin" which vda)"

frames=$(( seconds * fps ))
"$vda" shell "rm -f /tmp/testsrc.webm && gst-launch-1.0 -q \
  videotestsrc num-buffers=${frames} pattern=${pattern} \
  ! video/x-raw,width=1280,height=720,framerate=${fps}/1 \
  ! videoconvert ! vp8enc deadline=1 ! webmmux ! filesink location=/tmp/testsrc.webm" \
  >/dev/null 2>&1 || true   # teardown assert sets a nonzero rc; the file is already flushed

size=$("$vda" shell 'stat -c %s /tmp/testsrc.webm 2>/dev/null || echo 0' | tr -d '\r')
[[ "${size:-0}" -gt 0 ]] || { echo "device produced no video (is the VVD running?)" >&2; exit 1; }

mkdir -p "$(dirname "$out")"
"$vda" pull /tmp/testsrc.webm "$out" >/dev/null
echo "$out ($(stat -f%z "$out") bytes, ${seconds}s ${pattern} @ ${fps}fps)"
