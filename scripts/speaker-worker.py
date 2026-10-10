#!/usr/bin/env python3
"""Opt-in speaker characteristics only: no age, family role or authentication inference."""
import contextlib
import json
import math
import os
from pathlib import Path
import sys

os.environ.setdefault('HF_HUB_DISABLE_XET', '1')


def main():
    # Library progress output is never the JSON protocol, and never contains recorded audio.
    with contextlib.redirect_stdout(sys.stderr):
        import numpy as np
        import soundfile as sf
        from scipy.signal import resample_poly
        import torch
        from speechbrain.inference.speaker import EncoderClassifier
        torch.set_num_threads(2)
        checking = sys.argv[1:] == ['--check']
        if not checking:
            if len(sys.argv) != 2:
                raise ValueError('invalid_audio')
            info = sf.info(sys.argv[1])
            if info.format != 'WAV' or info.subtype != 'PCM_16' or info.channels != 1 or not 8000 <= info.samplerate <= 48000 or not 2 <= info.duration <= 20:
                raise ValueError('invalid_audio')
            audio, rate = sf.read(sys.argv[1], dtype='float32')
            if not np.isfinite(audio).all() or not len(audio):
                raise ValueError('invalid_audio')
            if rate != 16000:
                divisor = math.gcd(rate, 16000)
                audio = resample_poly(audio, 16000 // divisor, rate // divisor).astype('float32')
            # Energy + periodicity screen, NOT diarization or a reliable overlapping-speaker detector.
            # Record one person alone. Detected low quality is rejected, never assigned a nearest speaker.
            frames = audio[:len(audio) // 480 * 480].reshape(-1, 480)
            rms = np.sqrt(np.mean(frames ** 2, axis=1))
            active = rms > max(0.008, float(rms.max()) * 0.08)
            voiced = 0
            for frame in frames[active]:
                frame = frame - frame.mean()
                correlation = np.correlate(frame, frame, mode='full')[479:]
                if correlation[0] > 0 and float(correlation[40:321].max() / correlation[0]) > 0.25:
                    voiced += 1
            if voiced * 0.03 < 0.6 or int(active.sum()) * 0.03 < 1.0 or float(np.mean(np.abs(audio) >= 0.999)) > 0.02:
                raise ValueError('low_quality')
            positions = np.flatnonzero(active)
            audio = audio[max(0, int(positions[0]) - 2) * 480:min(len(audio), (int(positions[-1]) + 3) * 480)]
            audio = audio / max(float(np.max(np.abs(audio))), 1e-8)
        cache = Path(os.environ.get('SELENE_VOICE_MODEL_DIR', str(Path.home() / '.cache/selene/ecapa')))
        cache.mkdir(parents=True, exist_ok=True, mode=0o700)
        model = EncoderClassifier.from_hparams(source='speechbrain/spkrec-ecapa-voxceleb', savedir=str(cache), run_opts={'device': 'cpu'})
        if checking:
            result = {'available': True}
        else:
            with torch.inference_mode():
                value = model.encode_batch(torch.from_numpy(audio).unsqueeze(0)).reshape(-1)
                value = torch.nn.functional.normalize(value, dim=0).cpu().tolist()
            if len(value) != 192 or not all(math.isfinite(number) for number in value):
                raise ValueError('worker_unavailable')
            result = {'embedding': value}
    print(json.dumps(result, allow_nan=False), flush=True)


if __name__ == '__main__':
    try:
        main()
    except ValueError as error:
        code = str(error)
        print(json.dumps({'error': code if code in ('invalid_audio', 'low_quality') else 'worker_unavailable'}), flush=True)
        sys.exit(1)
    except Exception:
        # No traceback/path/library errors containing private inputs leave this worker.
        print(json.dumps({'error': 'worker_unavailable'}), flush=True)
        sys.exit(1)
