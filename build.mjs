// Builds src/ into:
//   dist/youtube-live/      unpacked extension — "Load unpacked" this in chrome://extensions
//   dist/youtube-live.zip   same files, zipped (manifest.json at the zip root)
//
//   node build.mjs          one-off build (folder + zip)
//   node build.mjs --watch  rebuild folder on change (no zip; inline sourcemaps)
import * as esbuild from 'esbuild'
import { zipSync } from 'fflate'
import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  watch as watchFs,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

const watch = process.argv.includes('--watch')
const NAME = 'youtube-live'
const distDir = 'dist'
const outdir = `${distDir}/${NAME}`
const zipPath = `${distDir}/${NAME}.zip`

// Static files copied as-is (manifest references them by these names).
const STATIC = ['manifest.json', 'styles.css']

function copyStatic() {
  mkdirSync(outdir, { recursive: true })
  for (const f of STATIC) cpSync(join('src', f), join(outdir, f))
}

/** Zip the contents of outdir (flat: the extension has no subfolders). */
function writeZip() {
  const files = {}
  for (const f of readdirSync(outdir).sort()) files[f] = readFileSync(join(outdir, f))
  writeFileSync(zipPath, zipSync(files, { level: 9 }))
}

/** esbuild plugin: copy static files after every successful (re)build, and zip
 *  on one-off builds only (watch builds carry inline sourcemaps — not for release). */
const packagePlugin = {
  name: 'package',
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length) return
      copyStatic()
      if (!watch) writeZip()
      const out = watch ? `${outdir}/` : `${outdir}/ + ${zipPath}`
      console.log(`[build] ${new Date().toLocaleTimeString()} → ${out}`)
    })
  },
}

rmSync(distDir, { recursive: true, force: true })

const options = {
  entryPoints: { content: 'src/content.ts' },
  outdir,
  bundle: true,
  // Content scripts are classic scripts, not ES modules → IIFE.
  format: 'iife',
  target: 'chrome120',
  sourcemap: watch ? 'inline' : false,
  logLevel: 'warning',
  plugins: [packagePlugin],
}

if (watch) {
  const ctx = await esbuild.context(options)
  await ctx.watch()
  // esbuild only watches files imported by the bundle; static files need their own watcher.
  // Debounced: one save fires several fs.watch events (notably on Windows).
  let timer
  watchFs('src', (_event, file) => {
    if (!STATIC.includes(String(file))) return
    clearTimeout(timer)
    timer = setTimeout(() => {
      try {
        copyStatic()
        console.log(`[build] ${new Date().toLocaleTimeString()} copied static files`)
      } catch (e) {
        console.warn('[build] static copy failed:', e.message) // e.g. file locked mid-save
      }
    }, 100)
  })
  console.log('[build] watching src/ …')
} else {
  await esbuild.build(options)
}
