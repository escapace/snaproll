import vue from '@vitejs/plugin-vue'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { defineConfig } from 'vite'
import constants from './scripts/constants.json'

const packageJSON = JSON.parse(await readFile(path.resolve('./package.json'), 'utf-8')) as {
  version: string
}

export default defineConfig((environment) => ({
  build: {
    outDir: 'lib/vite',
  },
  define: {
    ...constants.builds.browser.define,
    __ENVIRONMENT__: JSON.stringify(environment.mode),
    __VERSION__: JSON.stringify(packageJSON.version),
  },
  plugins: [vue()],
}))
