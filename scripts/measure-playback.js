// Paste into the TV WebView console before pressing Play or during playback.
// One local 10-second observation, no playback commands or network requests.
// This measures progress and decoder counters, not perceived audio quality.
(() => {
  const video = document.querySelector('video');
  if (!video || document.hidden) throw new Error('Keep a TV video element visible before observing.');
  const snapshot = () => ({code: video.error?.code ?? null, message: video.error?.message ?? '',
    currentTime: video.currentTime, readyState: video.readyState, networkState: video.networkState,
    mp4Support: video.canPlayType('video/mp4')});
  if (video.error) {console.error('Existing media startup error', snapshot()); return;}
  if (video.paused || video.ended || video.seeking || video.readyState < 2) {
    console.info('Watching startup for 30 seconds. Press Play.', snapshot());
    const cleanup = () => {clearTimeout(deadline); video.removeEventListener('error', failed); video.removeEventListener('playing', ready);};
    const failed = () => {cleanup(); console.error('Media startup error', snapshot());};
    const ready = () => {cleanup(); console.info('Playback started. Run this script again for the 10-second progress sample.', snapshot());};
    const deadline = setTimeout(() => {cleanup(); console.warn('No playback start within 30 seconds', snapshot());}, 30000);
    video.addEventListener('error', failed, {once: true}); video.addEventListener('playing', ready, {once: true});
    return;
  }
  const started = performance.now(), position = video.currentTime, rate = video.playbackRate;
  const quality = video.getVideoPlaybackQuality?.();
  let waits = 0;
  const waiting = () => waits++;
  const boundaries = ['pause', 'seeking', 'ratechange', 'ended', 'emptied', 'loadstart', 'abort'];
  const cancel = () => {cleanup(); console.info('Playback observation cancelled: playback or visibility changed. Run it again when ready.');};
  const failed = () => {
    const error = video.error;
    console.error('Playback media error', {
      code: error?.code ?? null, message: error?.message ?? '', currentTime: video.currentTime,
      duration: Number.isFinite(video.duration) ? video.duration : null,
      readyState: video.readyState, networkState: video.networkState,
    });
    cancel();
  };
  const cleanup = () => {
    clearTimeout(timer);
    video.removeEventListener('waiting', waiting);
    video.removeEventListener('error', failed);
    for (const event of boundaries) video.removeEventListener(event, cancel);
    document.removeEventListener('visibilitychange', cancel);
  };
  const timer = setTimeout(() => {
    cleanup();
    const elapsed = (performance.now() - started) / 1000;
    const progressed = video.currentTime - position;
    const endQuality = video.getVideoPlaybackQuality?.();
    let bufferedAhead = 0;
    for (let i = 0; i < video.buffered.length; i++) {
      if (video.buffered.start(i) <= video.currentTime && video.currentTime < video.buffered.end(i)) {
        bufferedAhead = video.buffered.end(i) - video.currentTime;
        break;
      }
    }
    console.table({
      wall_seconds: elapsed, media_seconds: progressed,
      media_seconds_per_wall_second: progressed / elapsed, expected_playback_rate: rate,
      waiting_events: waits, buffered_ahead_seconds: bufferedAhead, ready_state: video.readyState,
      total_video_frames: quality && endQuality ? endQuality.totalVideoFrames - quality.totalVideoFrames : null,
      dropped_video_frames: quality && endQuality ? endQuality.droppedVideoFrames - quality.droppedVideoFrames : null,
    });
  }, 10000);
  video.addEventListener('waiting', waiting);
  video.addEventListener('error', failed, {once: true});
  for (const event of boundaries) video.addEventListener(event, cancel);
  document.addEventListener('visibilitychange', cancel);
})();
