import vue from '@vitejs/plugin-vue'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { defineConfig } from 'vite'
import constants from './scripts/constants.json'

const packageJSON = JSON.parse(await readFile(path.resolve('./package.json'), 'utf-8')) as {
  version: string
}

export default defineConfig({
  build: {
    outDir: 'lib/github-pages',
  },
  define: {
    ...constants.builds.browser.define,
    __ENVIRONMENT__: JSON.stringify('development'),
    __VERSION__: JSON.stringify(packageJSON.version),
  },
  plugins: [vue()],
  server: {
    allowedHosts: true,
  },
})
