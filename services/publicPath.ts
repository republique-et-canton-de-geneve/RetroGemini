/** Public paths follow the server-rendered mount, including on deep links. */
export const appBasePath = (): string => {
  const base = document.querySelector<HTMLMetaElement>('meta[name="app-base-path"]')?.content;
  return base && /^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base) ? base : '/';
};

export const appPath = (path = '/'): string => appBasePath() + path.replace(/^\/+/, '');

export const localPath = (pathname: string): string => {
  const base = appBasePath();
  if (pathname === base.slice(0, -1)) return '/';
  return base !== '/' && pathname.startsWith(base) ? '/' + pathname.slice(base.length) : pathname;
};

export const appUrl = (suffix = ''): string => window.location.origin + appBasePath() + suffix;

export const appFetch: typeof fetch = (input, init) =>
  fetch(typeof input === 'string' && input.startsWith('/api/') ? appPath(input) : input, init);
