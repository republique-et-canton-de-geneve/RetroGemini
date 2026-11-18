import { afterEach, describe, expect, it } from 'vitest';
import { createPublicAccess, renderPublicHtml } from '../server/services/publicAccess.js';
import { appPath, appUrl, localPath } from '../services/publicPath';
import { createPublicOriginResolver } from '../server/services/publicOrigin.js';

const proxy = 'https://tools.example.org/retrogemini/';
const request = (host: string) => ({ get: (name: string) => name.toLowerCase() === 'host' ? host : undefined });

describe('dual public access', () => {
  afterEach(() => document.querySelector('meta[name="app-base-path"]')?.remove());

  it('selects only the explicitly configured proxy host', () => {
    const access = createPublicAccess({ env: { PROXY_BASE_URL: proxy } });
    expect(access.basePath(request('tools.example.org'))).toBe('/retrogemini/');
    expect(access.basePath(request('native.example'))).toBe('/');
    expect(access.basePath(request('tools.example.org.attacker.test'))).toBe('/');
  });

  it('rejects credentials, query strings and unsafe public prefixes', () => {
    for (const value of ['https://user@host/app', 'https://host/app?x=1', 'http://host/app', 'https://host/%22']) {
      expect(() => createPublicAccess({ env: { PROXY_BASE_URL: value } })).toThrow();
    }
  });

  it('keeps token-bearing email links on the configured entry point', () => {
    const resolver = createPublicOriginResolver({ env: { PROXY_BASE_URL: proxy, PUBLIC_BASE_URL: 'https://native.example/' } });
    expect(resolver.resolveEmailLink(request('tools.example.org'), 'https://attacker.test/?reset=token')).toBe(proxy + '?reset=token');
    expect(resolver.resolveEmailLink(request('native.example'), 'https://attacker.test/?reset=token')).toBe('https://native.example/?reset=token');
    const proxyOnly = createPublicOriginResolver({ env: { PROXY_BASE_URL: proxy } });
    expect(proxyOnly.hasConfiguredBaseUrl(request('tools.example.org'))).toBe(true);
    expect(proxyOnly.hasConfiguredBaseUrl(request('attacker.test'))).toBe(false);
  });

  it('renders explicit resource URLs that also work on deep links', () => {
    const html = '<head><link href="./assets/app.css"><script src="./assets/app.js"></script></head>';
    const rendered = renderPublicHtml(html, '/retrogemini/');
    expect(rendered).toContain('href="/retrogemini/assets/app.css"');
    expect(rendered).toContain('src="/retrogemini/assets/app.js"');
    expect(rendered).toContain('name="app-base-path" content="/retrogemini/"');
    expect(renderPublicHtml(html, '/')).toContain('src="/assets/app.js"');
  });

  it('uses the document mount for APIs, socket paths, invitations and navigation', () => {
    document.head.insertAdjacentHTML('beforeend', '<meta name="app-base-path" content="/retrogemini/">');
    expect(appPath('/api/team/list')).toBe('/retrogemini/api/team/list');
    expect(appPath('/socket.io')).toBe('/retrogemini/socket.io');
    expect(localPath('/retrogemini/session/a')).toBe('/session/a');
    expect(localPath('/retrogemini-other/session/a')).toBe('/retrogemini-other/session/a');
    expect(appUrl('?join=encoded')).toBe(`${window.location.origin}/retrogemini/?join=encoded`);
  });
});
