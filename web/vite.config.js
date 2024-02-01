import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
const isDev = process.env.NODE_ENV === 'development'
// https://vitejs.dev/config/
export default defineConfig({
  base: isDev ? '' : 'wt/',
  plugins: [vue()],
})
