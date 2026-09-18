#!/usr/bin/env bash
set -euo pipefail

vega_bin="$(command -v vega || true)"
: "${vega_bin:=$HOME/vega/bin/vega}"
[[ -x "$vega_bin" ]] || { echo "vega CLI not found (set PATH or install to ~/vega/bin)" >&2; exit 1; }
vega_home="$(cd "$(dirname "$vega_bin")/.." && pwd)"
sdk_version="$("$vega_bin" --version | awk '/Active SDK Version:/ {print $4; exit}')"
vvd_root="${VVD_ROOT:-$vega_home/sdk/vega-sdk/main/$sdk_version/vvd}"
vvd_bin="$vvd_root/bin/virtualdevice"
instances_path="$vvd_root/instances"

if [[ ! -x "$vvd_bin" ]]; then
  echo "Vega virtual-device binary not found: $vvd_bin" >&2
  exit 1
fi

gui_args=()
if [[ "${VVD_GUI:-on}" == "off" ]]; then
  gui_args+=(--gui-off)
fi

# ponytail: software rendering avoids the bundled Mac AArch64 host-Vulkan crash;
# restore GL only after the SDK's host renderer is fixed.
"$vvd_bin" create-and-launch \
  --image-path "$vvd_root/images/tv" \
  --instances-path "$instances_path" \
  --log-path "$vvd_root" \
  --name default_instance \
  --gl-accel-off \
  "${gui_args[@]}" \
  --virtualizer-log file

echo "Vega virtual device is running with software rendering. Keep this command alive; stop it with: vega virtual-device stop"
while true; do
  sleep 3600
done
