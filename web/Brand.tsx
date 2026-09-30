import React from 'react';

export function Brand() {
  return <span className="wordmark" aria-label="SELENE"><svg viewBox="0 0 48 48" aria-hidden="true"><path d="M36 36A20 20 0 1 1 36 8 17 17 0 1 0 36 36Z" fill="#ff9900"/><path d="m28 16 12 8-12 8Z" fill="currentColor"/></svg><span>selene</span></span>;
}

export function Icon({name}: {name: 'back' | 'settings' | 'mic' | 'send' | 'more' | 'play' | 'pause' | 'close'}) {
  const paths = {back: 'm15 5-7 7 7 7M8 12h13', settings: 'M4 7h16M4 17h16M9 4v6m6 4v6', mic: 'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0ZM5 11v1a7 7 0 0 0 14 0v-1M12 19v3m-4 0h8', send: 'm9 4 8 8-8 8M3 12h14', more: 'M4 6h16M4 12h16M4 18h16', play: 'm8 4 12 8-12 8Z', pause: 'M8 4v16M16 4v16'};
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={name === 'close' ? 'm6 6 12 12M18 6 6 18' : paths[name]}/></svg>;
}
