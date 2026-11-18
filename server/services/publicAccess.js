/** The proxy strips its URL prefix. Only the configured Host selects that prefix. */
export const createPublicAccess = ({ env = process.env } = {}) => {
  let proxy = null;
  if (env.PROXY_BASE_URL) {
    proxy = new URL(env.PROXY_BASE_URL);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(proxy.hostname);
    if ((proxy.protocol !== 'https:' && !(local && proxy.protocol === 'http:')) ||
        proxy.username || proxy.password || proxy.search || proxy.hash ||
        !/^\/(?:[A-Za-z0-9_-]+\/?)*$/.test(proxy.pathname)) {
      throw new Error('PROXY_BASE_URL must be an HTTPS application URL without credentials or query parameters');
    }
    proxy.pathname = proxy.pathname.replace(/\/*$/, '/');
  }

  const proxyUrl = (req) => {
    const host = req?.get?.('host');
    return proxy && typeof host === 'string' && host.toLowerCase() === proxy.host ? proxy : null;
  };
  return {
    proxyUrl,
    basePath: (req) => proxyUrl(req)?.pathname ?? '/',
  };
};

export const renderPublicHtml = (html, basePath) => {
  const withPaths = html.replace(/((?:src|href)=["'])(?:\.\/|\/(?!\/))/g, `$1${basePath}`);
  const meta = `<meta name="app-base-path" content="${basePath}">`;
  return withPaths.replace('</head>', `${meta}</head>`);
};
