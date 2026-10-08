"""Rebuild retired test-fixture narration from its caption source (macOS)."""
import json, subprocess
from pathlib import Path
root = Path(__file__).resolve().parent.parent
story = json.loads((root / 'test/fixtures/content/00-story.json').read_text())
assets = root / 'assets/media/the-red-kite/narration'
assets.mkdir(parents=True, exist_ok=True)
for cue in story['transcript']:
    path = assets / (cue['id'] + '.aiff')
    subprocess.run(['say', '-v', 'Samantha', '-r', '145', '-o', str(path), cue['text']], check=True)
    duration = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(path)]))
    assert duration <= cue['end'] - cue['start'], (cue['id'], duration)
    print(cue['id'], round(duration, 2), 'seconds, within caption interval')
