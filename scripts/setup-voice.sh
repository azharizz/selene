#!/bin/sh
set -eu
# Run from anywhere; voice dependencies and weights never enter the television bundle.
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
command -v uv >/dev/null 2>&1 || { printf '%s\n' 'Install uv from https://docs.astral.sh/uv/getting-started/installation/ first.' >&2; exit 1; }
command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1 || { printf '%s\n' 'Install FFmpeg (ffmpeg and ffprobe) for FireOS M4A recordings first.' >&2; exit 1; }
umask 077
uv venv --python 3.11 "$ROOT/.venv-voice"
uv pip install --python "$ROOT/.venv-voice/bin/python" 'torch==2.8.0' 'torchaudio==2.8.0' 'speechbrain==1.0.3' 'soundfile==0.13.1' 'huggingface-hub==0.36.0' 'numpy==2.3.3' 'scipy==1.16.2'
# Download/load the real CPU ECAPA weights now, rather than declaring availability from file existence.
"$ROOT/.venv-voice/bin/python" "$ROOT/scripts/speaker-worker.py" --check
