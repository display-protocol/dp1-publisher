import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      // "Load from series" calls the Feral File public API. feralfile.com answers 403
      // to any Origin it has not allow-listed: publisher.feralfile.com is allowed (so
      // production calls it directly), localhost is not. http-proxy forwards the
      // browser's Origin header even with changeOrigin (which only rewrites Host), so
      // the header is stripped here. Path and default live in src/lib/vendors/feralfile.ts.
      '/ff-api': {
        target: 'https://feralfile.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/ff-api/, '/api'),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.removeHeader('origin')
          })
        },
      },
    },
  },
})
