import { defineConfig } from 'vite'
import { readFileSync } from 'fs'

// Read version from package.json at build time
const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

// Build timestamp in AWST (UTC+8)
const now = new Date()
const awst = new Date(now.getTime() + 8 * 60 * 60 * 1000)
const buildDate = awst.getUTCFullYear() + '-' +
  String(awst.getUTCMonth() + 1).padStart(2, '0') + '-' +
  String(awst.getUTCDate()).padStart(2, '0')
const buildTime = String(awst.getUTCHours()).padStart(2, '0') + '.' +
  String(awst.getUTCMinutes()).padStart(2, '0')

export default defineConfig({
  // Step 1) Set the root directory to serve files from
  root: '.',

  // Step 2) Set base path to relative for subdirectory deployment
  // This ensures assets use ./assets/ instead of /assets/
  // Required for deployment at blastingapps.com/dist/
  base: './',

  // Step 3) Configure the dev server
  server: {
    port: 5173,
    open: '/kirra.html', // Automatically open kirra.html when dev server starts
    host: true // Allow external connections
  },

  // Step 4) Configure build options
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: './kirra.html'
      }
    }
  },

  // Step 5) Configure public directory for static assets
  // Files in public/ are copied to dist/ root during build
  publicDir: 'public',

  // Step 6) Inject build-time constants into source code
  // These replace the tokens at compile time (both dev and build)
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(buildDate),
    __BUILD_TIME__: JSON.stringify(buildTime)
  }
})
