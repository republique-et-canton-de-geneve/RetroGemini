import React from 'react';
import express from 'express';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { registerPublicRoutes } from '../server/routes/publicRoutes.js';
import InviteModal from '../components/InviteModal';
import { Team } from '../types';

// The QR code is produced client-side by the `qrcode` package (offline
// deployment rule). Mocking it is what lets these tests pin the exact payload
// string the component encodes, instead of grepping the source for it.
// The stub derives the returned data URL from the payload so that every
// rendered <img> can be traced back to the string it was generated from —
// with a constant data URL, a Wi-Fi QR wired to the session link would be
// indistinguishable in the DOM.
const { toDataURLMock, fakeQrDataUrl } = vi.hoisted(() => {
  const fakeQrDataUrl = (text: string) => `data:image/png;base64,${text.replace(/[^A-Za-z0-9]/g, '')}`;
  return {
    fakeQrDataUrl,
    toDataURLMock: vi.fn(async (text: string, _options?: unknown) => fakeQrDataUrl(text))
  };
});

vi.mock('qrcode', () => ({ default: { toDataURL: toDataURLMock } }));

// InviteModal asks the server for a session invite link on mount; that path is
// covered elsewhere and is irrelevant to the Wi-Fi feature.
vi.mock('../services/dataService', () => ({
  dataService: {
    createSessionInvite: vi.fn(async () => ({ inviteLink: 'https://retro.test/join/abc' })),
    // The Wi-Fi lookup authenticates since H31.
    getAuthenticatedPassword: vi.fn(() => 'team-password'),
    getSessionToken: vi.fn(() => 'rg1.team-session-token')
  }
}));

// Since H31 the route is an authenticated POST, so every request here carries
// the team credential. The authentication itself is covered by
// `wifiConfigAuthorization.test.ts`; these cases pin the configuration reading.
const request = async (app: express.Express, path: string) => {
  const server = app.listen(0);
  try {
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to bind test server');
    }
    return await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ teamId: 'team-1', sessionToken: 'rg1.valid' })
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
};

const appWithPublicRoutes = () => {
  const app = express();
  app.use(express.json());
  registerPublicRoutes({
    app,
    dataStore: { loadGlobalSettings: vi.fn() },
    teamService: {
      authenticateTeam: vi.fn(async (teamId: string) => ({ team: { id: teamId, name: 'Rocket Team' }, error: null }))
    },
    mailerService: { smtpEnabled: false, mailer: null },
    logService: { addServerLog: vi.fn() },
    escapeHtml: (value: string) => value,
    sanitizeEmailLink: (value: string) => value
  });
  return app;
};

describe('POST /api/wifi-config', () => {
  const originalSsid = process.env.WIFI_SSID;
  const originalPassword = process.env.WIFI_PASSWORD;

  const setEnv = (ssid?: string, password?: string) => {
    if (ssid === undefined) delete process.env.WIFI_SSID;
    else process.env.WIFI_SSID = ssid;
    if (password === undefined) delete process.env.WIFI_PASSWORD;
    else process.env.WIFI_PASSWORD = password;
  };

  afterEach(() => {
    setEnv(originalSsid, originalPassword);
  });

  it('returns the configured network when both WIFI_SSID and WIFI_PASSWORD are set', async () => {
    setEnv('Office Wi-Fi', 's3cr3t!');

    const response = await request(appWithPublicRoutes(), '/api/wifi-config');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ssid: 'Office Wi-Fi', password: 's3cr3t!' });
  });

  it('returns 404 wifi_not_configured when neither variable is set', async () => {
    setEnv(undefined, undefined);

    const response = await request(appWithPublicRoutes(), '/api/wifi-config');

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'wifi_not_configured' });
  });

  it('returns 404 wifi_not_configured when only the SSID is set', async () => {
    setEnv('Office Wi-Fi', undefined);

    const response = await request(appWithPublicRoutes(), '/api/wifi-config');

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'wifi_not_configured' });
  });

  it('returns 404 wifi_not_configured when only the password is set', async () => {
    setEnv(undefined, 's3cr3t!');

    const response = await request(appWithPublicRoutes(), '/api/wifi-config');

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'wifi_not_configured' });
  });

  it('treats empty environment values as unconfigured', async () => {
    setEnv('', '');

    const response = await request(appWithPublicRoutes(), '/api/wifi-config');

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'wifi_not_configured' });
  });
});

describe('InviteModal Wi-Fi tab', () => {
  const team: Team = {
    id: 'team-1',
    name: 'Rocket Team',
    passwordHash: 'hash',
    members: [],
    customTemplates: [],
    retrospectives: [],
    globalActions: []
  };

  const stubWifiConfig = (config: { ssid: string; password: string } | null) => {
    const fetchMock = vi.fn(async (input: string, _init?: unknown) => {
      if (String(input).includes('/api/wifi-config')) {
        return config
          ? new Response(JSON.stringify(config), { status: 200, headers: { 'content-type': 'application/json' } })
          : new Response(JSON.stringify({ error: 'wifi_not_configured' }), { status: 404 });
      }
      throw new Error(`Unexpected fetch: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  const qrPayloads = () => toDataURLMock.mock.calls.map(([text]) => text);

  beforeEach(() => {
    toDataURLMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const WIFI_PAYLOAD = 'WIFI:T:WPA;S:Office Wi-Fi;P:s3cr3t!;;';

  it('shows the Wi-Fi tab with the network name, the password and a Wi-Fi QR code', async () => {
    stubWifiConfig({ ssid: 'Office Wi-Fi', password: 's3cr3t!' });

    render(<InviteModal team={team} onClose={() => {}} />);

    fireEvent.click(await screen.findByText('WI-FI'));

    expect(await screen.findByText('Office Wi-Fi')).toBeInTheDocument();

    // The password is masked until the user reveals it.
    expect(screen.getByText('••••••••')).toBeInTheDocument();
    expect(screen.queryByText('s3cr3t!')).toBeNull();
    fireEvent.click(screen.getByText('visibility'));
    expect(screen.getByText('s3cr3t!')).toBeInTheDocument();

    // The QR code encodes the standard Wi-Fi provisioning payload, so a phone
    // camera can join the network without any internet access…
    await waitFor(() => {
      expect(qrPayloads()).toContain(WIFI_PAYLOAD);
    });
    // …and it is that payload's QR code — not the session-link one — that the
    // Wi-Fi tab actually displays.
    expect(await screen.findByAltText('Wi-Fi QR Code')).toHaveAttribute('src', fakeQrDataUrl(WIFI_PAYLOAD));
  });

  it('hides the Wi-Fi tab and encodes no Wi-Fi payload when the server reports no configuration', async () => {
    const fetchMock = stubWifiConfig(null);

    render(<InviteModal team={team} onClose={() => {}} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/wifi-config', expect.objectContaining({
      method: 'POST'
    })));
    // The session-link QR is still encoded, which proves the mount effects ran.
    await waitFor(() => expect(qrPayloads()).toContain('https://retro.test/join/abc'));

    expect(screen.getByText('EMAIL')).toBeInTheDocument();
    expect(screen.getByText('CODE & LINK')).toBeInTheDocument();
    expect(screen.queryByText('WI-FI')).toBeNull();
    expect(qrPayloads().some(payload => payload.startsWith('WIFI:'))).toBe(false);
  });
});
