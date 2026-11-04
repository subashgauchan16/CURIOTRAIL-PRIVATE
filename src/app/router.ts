// Hash routes work on GitHub Pages without server rewrites.

import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'start' }
  | { name: 'map'; id: string | null }
  | { name: 'quest'; id: string }
  | { name: 'complete'; id: string }
  | { name: 'practice'; id: string; scene: string }
  | { name: 'progress' }
  | { name: 'explore' };

export function parseHash(hash: string): Route {
  const path = (hash || '').replace(/^#/, '') || '/';
  let m: RegExpMatchArray | null;
  if (path === '/' || path === '') return { name: 'home' };
  if (path === '/start') return { name: 'start' };
  if (path === '/progress') return { name: 'progress' };
  if (path === '/explore') return { name: 'explore' };
  if ((m = path.match(/^\/map(?:\/([a-z0-9-]+))?$/))) return { name: 'map', id: m[1] ?? null };
  if ((m = path.match(/^\/quest\/([a-z0-9-]+)$/))) return { name: 'quest', id: m[1] };
  if ((m = path.match(/^\/complete\/([a-z0-9-]+)$/))) return { name: 'complete', id: m[1] };
  if ((m = path.match(/^\/practice\/([a-z0-9-]+)\/([a-z0-9-]+)$/))) return { name: 'practice', id: m[1], scene: m[2] };
  return { name: 'home' };
}

export function navigate(path: string, { replace = false } = {}) {
  const target = `#${path}`;
  if (location.hash === target) return;
  if (replace) {
    history.replaceState(null, '', target);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    location.hash = target;
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const handle = () => setRoute(parseHash(location.hash));
    window.addEventListener('hashchange', handle);
    return () => window.removeEventListener('hashchange', handle);
  }, []);
  return route;
}
