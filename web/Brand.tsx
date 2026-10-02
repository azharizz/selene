import React from 'react';

export function Brand({markOnly = false}: {markOnly?: boolean}) {
  return <span className="wordmark" aria-label="SELENE"><svg viewBox="0 0 48 48" aria-hidden="true"><path d="M36 36A20 20 0 1 1 36 8 17 17 0 1 0 36 36Z" fill="#ff9900"/><path d="m28 16 12 8-12 8Z" fill="currentColor"/></svg>{!markOnly && <span>selene</span>}</span>;
}

export function LoadingMark() {
  return <span className="loading-mark" role="status" aria-label="Preparing your answer"><Brand markOnly/></span>;
}

export function Icon({name}: {name: 'back' | 'settings' | 'mic' | 'send' | 'more' | 'play' | 'pause' | 'close' | 'volume' | 'follow'}) {
  const paths = {back: 'm15 5-7 7 7 7M8 12h13', settings: 'M4 7h16M4 17h16M9 4v6m6 4v6', mic: 'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0ZM5 11v1a7 7 0 0 0 14 0v-1M12 19v3m-4 0h8', send: 'm9 4 8 8-8 8M3 12h14', more: 'M4 6h16M4 12h16M4 18h16', play: 'm8 4 12 8-12 8Z', pause: 'M8 4v16M16 4v16', volume: 'M11 5 6 9H3v6h3l5 4V5Zm4 4a5 5 0 0 1 0 6m3-9a9 9 0 0 1 0 12', follow: 'M10 13a5 5 0 0 0 7.07 0l2-2A5 5 0 0 0 12 3.93L10.86 5.1m3.14 5.9a5 5 0 0 0-7.07 0l-2 2A5 5 0 0 0 12 20.07l1.14-1.17'};
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={name === 'close' ? 'm6 6 12 12M18 6 6 18' : paths[name]}/></svg>;
}
