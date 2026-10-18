"""Regenerate the README art from docs/assets/src/readme-art.html (needs Playwright + FFmpeg).

  python3 docs/assets/generate-readme-assets.py                 banner + animated diagrams
  python3 docs/assets/generate-readme-assets.py --film F.mp4    also cut the launch-film GIFs from F.mp4
"""
import functools, http.server, os, shutil, subprocess, sys, tempfile, threading
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'src')
# scene, output, size, loop seconds (None = still), fps, GIF width
ART = [('banner', 'selene-readme-banner.png', (2400, 760), None, 0, 0),
       ('thumb', 'selene-thumbnail.png', (1500, 1000), None, 0, 0),  # Devpost project thumbnail, 3:2
       ('g1', 'selene-gallery-1.png', (1500, 1000), None, 0, 0),
       ('g2', 'selene-gallery-2.png', (1500, 1000), None, 0, 0),
       ('g3', 'selene-gallery-3.png', (1500, 1000), None, 0, 0),
       ('g4', 'selene-gallery-4.png', (1500, 1000), None, 0, 0),
       ('loop', 'selene-moment-loop.gif', (1600, 760), 6, 15, 1200),
       ('arch', 'selene-architecture.gif', (1600, 1000), 4, 15, 1200),
       ('evidence', 'selene-evidence-window.gif', (1600, 760), 6, 15, 1200)]
# launch-film excerpts: output, start, duration
FILM = [('film-svg-avg.gif', 54.0, 6.0), ('film-placement.gif', 66.0, 6.0), ('film-second-screen.gif', 73.2, 4.2),
        ('film-agent.gif', 79.5, 6.0), ('film-thread.gif', 116.0, 6.0), ('film-conversation.gif', 142.0, 6.5), ('film-logo.gif', 10.0, 4.5)]


def gif(frames_glob, fps, width, out, ss=None, dur=None, src=None):
    # film frames carry per-frame grain, which GIF cannot compress: denoise first
    pre = 'hqdn3d=10:10:14:14,' if src else ''
    pal = f'{pre}fps={fps},scale={width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle'
    inp = ['-ss', str(ss), '-t', str(dur), '-i', src] if src else ['-framerate', str(fps), '-i', frames_glob]
    subprocess.run(['ffmpeg', '-v', 'error', '-y', *inp, '-filter_complex', pal, '-loop', '0', out], check=True)


def main():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=SRC))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{srv.server_address[1]}/readme-art.html'
    with sync_playwright() as p:
        b = p.chromium.launch()
        for scene, out, (w, hh), loop, fps, gw in ([] if '--film-only' in sys.argv else ART):
            pg = b.new_page(viewport={'width': w, 'height': hh})
            pg.goto(f'{base}?s={scene}'); pg.evaluate('window.READY')
            dst = os.path.join(HERE, out)
            if loop is None:
                pg.screenshot(path=dst)
            else:
                tmp = tempfile.mkdtemp()
                for i in range(loop * fps):  # exactly one loop: frame N would equal frame 0
                    pg.evaluate(f'window.seek({i / fps})')
                    pg.screenshot(path=os.path.join(tmp, f'{i:04d}.png'))
                gif(os.path.join(tmp, '%04d.png'), fps, gw, dst)
                shutil.rmtree(tmp)
            pg.close()
            print(out, f'{os.path.getsize(dst) / 1e6:.1f} MB')
        b.close()
    if '--film' in sys.argv:
        film = sys.argv[sys.argv.index('--film') + 1]
        for out, ss, dur in FILM:
            dst = os.path.join(HERE, out)
            gif(None, 10, 720, dst, ss, dur, film)
            print(out, f'{os.path.getsize(dst) / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
