// Sparse lifecycle/control events only. Never log URLs, pairing tokens or questions.
export function reportMedia(player: HTMLVideoElement, contentId: string, event: string, detail = '') {
  const error = player.error;
  const quality = player.getVideoPlaybackQuality?.();
  const buffered = player.buffered;
  const record = {
    type: 'selene:media-diagnostic', contentId, event, detail: detail.slice(0, 200), time: Date.now(),
    currentTime: player.currentTime, duration: Number.isFinite(player.duration) ? player.duration : null,
    paused: player.paused, ended: player.ended, seeking: player.seeking,
    readyState: player.readyState, networkState: player.networkState,
    buffered: Array.from({length: buffered?.length ?? 0}, (_, i) => [buffered.start(i), buffered.end(i)]),
    totalVideoFrames: quality?.totalVideoFrames ?? null, droppedVideoFrames: quality?.droppedVideoFrames ?? null,
    videoWidth: player.videoWidth, videoHeight: player.videoHeight, playbackRate: player.playbackRate,
    errorCode: error?.code ?? null,
    errorMessage: (error?.message ?? '').replace(/https?:\/\/[^\s"'<>]+/g, '<media-url>').slice(0, 300),
    mp4Support: player.canPlayType?.('video/mp4') ?? '',
  };
  const message = JSON.stringify(record);
  console.info('[SELENE_MEDIA]', message);
  try {(window as Window & {ReactNativeWebView?: {postMessage: (value: string) => void}}).ReactNativeWebView?.postMessage(message);}
  catch { /* Diagnostics must never interrupt a playback command. */ }
}

export function observeMedia(player: HTMLVideoElement, contentId: string) {
  const events = ['loadstart', 'loadedmetadata', 'playing', 'pause', 'waiting', 'stalled', 'suspend', 'seeking', 'seeked', 'ended', 'error'];
  const report = (event: Event) => reportMedia(player, contentId, event.type);
  for (const event of events) player.addEventListener(event, report);
  return () => {for (const event of events) player.removeEventListener(event, report);};
}
