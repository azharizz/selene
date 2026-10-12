import React from 'react';
import {visualToApl} from '../server/visual-avg.mjs';
import type {VisualArtifact} from './Visual';

export function AvgVisual({visual, play}: {visual: VisualArtifact; play: number}) {
  const frame = React.useRef<HTMLIFrameElement>(null);
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [reduced, setReduced] = React.useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [size, setSize] = React.useState('');
  const [mounted, setMounted] = React.useState(0);
  React.useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  React.useEffect(() => {
    const observer = new ResizeObserver(entries => {
      const bounds = entries[0]?.contentRect;
      if (bounds) setSize(`${Math.round(bounds.width)}x${Math.round(bounds.height)}`);
    });
    if (frame.current) observer.observe(frame.current);
    return () => observer.disconnect();
  }, []);
  React.useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === 'selene:apl-ready') setLoading(false);
      if (event.data?.type === 'selene:apl-error') {setLoading(false); setError(String(event.data.message || 'Official APL runtime failed'));}
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);
  React.useEffect(() => {
    setError(''); setLoading(true);
    try {
      const converted = visualToApl(visual, {reducedMotion: reduced});
      frame.current?.contentWindow?.postMessage({type: 'selene:apl-render', document: converted.document, commands: converted.commands}, '*');
    } catch (failure) {setLoading(false); setError(failure instanceof Error ? failure.message : 'AVG conversion failed');}
  }, [visual, play, reduced, size, mounted]);
  return <div className="avg-preview" aria-label={visual.description}>
    <iframe ref={frame} className="avg-runtime" data-renderer="apl-viewhost-web" data-reduced-motion={reduced} title={`Local AVG / APL: ${visual.description}`} sandbox="allow-scripts" src="/apl-preview.html" tabIndex={-1}
      onLoad={() => setMounted(value => value + 1)} onError={() => {setLoading(false); setError('Official APL runtime is unavailable; rebuild the local preview assets');}} />
    {loading && !error && <span className="avg-status" role="status">Loading local APL runtime…</span>}
    {error && <span className="avg-status" role="alert">AVG unavailable: {error}</span>}
  </div>;
}
