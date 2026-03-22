import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // Root-relative assets for Discord Activities
  server: {
    host: '0.0.0.0', // Allow any host for VM access
    port: 5173,
    strictPort: true,
  },
  envDir: '../', // Look for .env in the root bot directory
})
