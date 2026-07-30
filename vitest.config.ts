import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      // Coverage scope: the tested logic modules. Widened well beyond the
      // original `services/**` (which measured only ~2.6% of the repo) to also
      // gate the backend services, the HTTP route handlers and the shared
      // client utilities — the code whose correctness the unit suite is
      // responsible for. React components stay out of the threshold scope on
      // purpose: they are exercised by the Playwright e2e suite, not by unit
      // coverage.
      //
      // `server/routes/**` was tested behaviourally but never *measured* until
      // it was added here; `utils/**` is matched on both extensions so a
      // JavaScript helper (e.g. `utils/inviteLink.js`) cannot sit outside the
      // gate purely because of its file extension.
      include: [
        'services/**/*.ts',
        'server/services/**/*.js',
        'server/routes/**/*.js',
        'utils/**/*.{ts,js}',
      ],
      exclude: [
        'node_modules/',
        'dist/',
        'build/',
        '**/*.config.{js,ts}',
        '**/*.d.ts',
        'coverage/',
        'vitest.setup.ts',
        '**/__tests__/**',
        '**/*.test.{ts,tsx}',
        '**/*.spec.{ts,tsx}',
        'index.tsx',
        'types.ts',
        'server.js',
        // Exclude React components from coverage thresholds (require E2E tests)
        'components/**',
        'App.tsx',
      ],
      // Ratcheted to lock in the current measured coverage on the widened scope
      // (actuals 86.26% lines / 87.03% funcs / 73.94% branch / 83.79% stmts
      // across 4 467 statements) with a ~3-point margin for Node 22/26 matrix
      // variance. Raise these as coverage improves; never lower them to make a
      // change pass.
      thresholds: {
        lines: 83,
        functions: 84,
        branches: 71,
        statements: 81,
      },
    },
    include: ['**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'build', 'e2e'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './'),
    },
  },
});
