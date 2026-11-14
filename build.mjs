// Bundles src/ into dist/ (the folder you "Load unpacked" in chrome://extensions).
//   node build.mjs          one-off build
//   node build.mjs --watch  rebuild on change
import * as esbuild from 'esbuild'
import { cpSync, mkdirSync, rmSync } from 'node:fs'

const watch = process.argv.includes('--watch')
const outdir = 'dist'

// Static files copied as-is (manifest references them by these names).
const STATIC = ['manifest.json', 'styles.css']

function copyStatic() {
  mkdirSync(outdir, { recursive: true })
  for (const f of STATIC) cpSync(`src/${f}`, `${outdir}/${f}`)
}

/** esbuild plugin: re-copy static files after every (re)build. */
const copyStaticPlugin = {
  name: 'copy-static',
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length) return
      copyStatic()
      console.log(`[build] ${new Date().toLocaleTimeString()} → ${outdir}/`)
    })
  },
}

rmSync(outdir, { recursive: true, force: true })

const options = {
  entryPoints: { content: 'src/content.ts' },
  outdir,
  bundle: true,
  // Content scripts are classic scripts, not ES modules → IIFE.
  format: 'iife',
  target: 'chrome120',
  sourcemap: watch ? 'inline' : false,
  logLevel: 'warning',
  plugins: [copyStaticPlugin],
}

if (watch) {
  const ctx = await esbuild.context(options)
  await ctx.watch()
  console.log('[build] watching src/ …')
} else {
  await esbuild.build(options)
}
