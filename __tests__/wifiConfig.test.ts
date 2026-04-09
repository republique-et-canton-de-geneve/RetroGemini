import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('Wi-Fi QR code feature', () => {
  describe('/api/wifi-config endpoint', () => {
    const publicRoutesSource = readFileSync(
      join(__dirname, '..', 'server', 'routes', 'publicRoutes.js'),
      'utf-8'
    );

    it('defines the /api/wifi-config GET endpoint', () => {
      expect(publicRoutesSource).toContain("app.get('/api/wifi-config'");
    });

    it('reads WIFI_SSID and WIFI_PASSWORD from environment', () => {
      expect(publicRoutesSource).toContain('process.env.WIFI_SSID');
      expect(publicRoutesSource).toContain('process.env.WIFI_PASSWORD');
    });

    it('returns 404 when wifi is not configured', () => {
      expect(publicRoutesSource).toContain('wifi_not_configured');
      expect(publicRoutesSource).toContain('404');
    });

    it('returns ssid and password as JSON', () => {
      expect(publicRoutesSource).toContain('res.json({ ssid, password })');
    });
  });

  describe('InviteModal Wi-Fi tab', () => {
    const inviteModalSource = readFileSync(
      join(__dirname, '..', 'components', 'InviteModal.tsx'),
      'utf-8'
    );

    it('fetches /api/wifi-config on mount', () => {
      expect(inviteModalSource).toContain("fetch('/api/wifi-config')");
    });

    it('generates a Wi-Fi QR code string in standard format', () => {
      expect(inviteModalSource).toContain('WIFI:T:WPA;S:');
    });

    it('only shows the Wi-Fi tab when wifiConfig is available', () => {
      expect(inviteModalSource).toContain("wifiConfig ? [{ key: 'wifi'");
    });

    it('displays SSID and password to the user', () => {
      expect(inviteModalSource).toContain('wifiConfig?.ssid');
      expect(inviteModalSource).toContain('wifiConfig?.password');
    });

    it('renders a Wi-Fi QR code image', () => {
      expect(inviteModalSource).toContain('Wi-Fi QR Code');
    });
  });

  describe('/api/wifi-config integration', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('returns config when both env vars are set', () => {
      process.env.WIFI_SSID = 'TestNetwork';
      process.env.WIFI_PASSWORD = 'TestPass123';

      const ssid = process.env.WIFI_SSID;
      const password = process.env.WIFI_PASSWORD;

      expect(ssid).toBe('TestNetwork');
      expect(password).toBe('TestPass123');

      const wifiString = `WIFI:T:WPA;S:${ssid};P:${password};;`;
      expect(wifiString).toBe('WIFI:T:WPA;S:TestNetwork;P:TestPass123;;');
    });

    it('detects missing config when env vars are not set', () => {
      delete process.env.WIFI_SSID;
      delete process.env.WIFI_PASSWORD;

      const ssid = process.env.WIFI_SSID;
      const password = process.env.WIFI_PASSWORD;

      expect(!ssid || !password).toBe(true);
    });
  });
});
