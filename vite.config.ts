import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'true'
  },
  plugins: [vue(), vueJsx()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  build: {
    copyPublicDir: true,
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          // Don't hash Live2D files (.skel, .atlas) or audio files as they're referenced by hardcoded paths
          if (assetInfo.name.endsWith('.skel') || assetInfo.name.endsWith('.atlas') || assetInfo.name.endsWith('.mp3') || assetInfo.name.endsWith('.ogg')) {
            return 'assets/[name][extname]'
          }
          // Hash other assets for cache busting
          if (assetInfo.name.endsWith('.png') || assetInfo.name.endsWith('.jpg')) {
            return 'assets/[name]-[hash][extname]'
          }
          return 'assets/[name]-[hash][extname]'
        }
      }
    }
  }
})
