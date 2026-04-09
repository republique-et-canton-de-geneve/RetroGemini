import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Railway/Cloud platforms inject PORT env variable
const port = parseInt(process.env.PORT || '8080', 10);

export default defineConfig({
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true
      }
    }
  },
  preview: {
    port: port,
    host: '0.0.0.0',
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: true,
  }
});
