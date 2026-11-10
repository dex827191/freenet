#!/usr/bin/env node
/**
 * Inline CSS + JS + favicon ke dalam satu string HTML.
 * Emit  →  frontend.html.cjs  (module.exports = "<html>")
 *
 * WAJIB dijalankan SETELAH `vite build` + SETELAH obfuscate `dist/assets`.
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const DIST       = path.resolve(__dirname, '..', 'dist');
const indexPath  = path.join(DIST, 'index.html');
const outCjsPath = path.resolve(__dirname, '..', 'frontend.html.cjs');

if (!fs.existsSync(indexPath)) {
  console.error(`❌ index.html tidak ditemukan di ${indexPath}`);
  console.error(`   Jalankan 'npm run build' terlebih dahulu.`);
  process.exit(1);
}

let html = fs.readFileSync(indexPath, 'utf8');
const report = { css: 0, js: 0, favicon: 0, skipped: 0 };

/* ── 1) Inline CSS:  <link rel="stylesheet" href="/assets/x.css"> ── */
html = html.replace(
  /<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi,
  (tag) => {
    const m = tag.match(/href=["']([^"']+)["']/i);
    if (!m) return tag;
    const file = path.join(DIST, m[1].replace(/^\//, ''));
    if (!fs.existsSync(file)) { report.skipped++; return tag; }
    const css = fs.readFileSync(file, 'utf8')
      .replace(/<\/style>/gi, '<\\/style>');
    report.css++;
    return `<style>\n${css}\n</style>`;
  }
);

/* ── 2) Inline JS module:  <script type="module" src="/assets/x.js"> ── */
html = html.replace(
  /<script\b[^>]*type=["']module["'][^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/gi,
  (tag, src) => {
    const file = path.join(DIST, src.replace(/^\//, ''));
    if (!fs.existsSync(file)) { report.skipped++; return tag; }
    const js = fs.readFileSync(file, 'utf8')
      .replace(/<\/script>/gi, '<\\/script>')
      .replace(/<!--/g, '<\\!--');
    report.js++;
    return `<script type="module">\n${js}\n</script>`;
  }
);

/* ── 3) Hapus modulepreload (sudah tidak relevan setelah inline) ── */
html = html.replace(/<link\b[^>]*rel=["']modulepreload["'][^>]*>\s*/gi, '');

/* ── 4) Inline favicon / apple-touch-icon jadi data-URI ── */
html = html.replace(
  /<link\b[^>]*rel=["'](?:icon|shortcut icon|apple-touch-icon)["'][^>]*>/gi,
  (tag) => {
    const m = tag.match(/href=["']([^"']+)["']/i);
    if (!m) return tag;
    const href = m[1];
    if (href.startsWith('data:')) return tag;
    if (!href.startsWith('/')) return '';                  // URL eksternal → drop
    const file = path.join(DIST, href.replace(/^\//, ''));
    if (!fs.existsSync(file)) return '';                   // file hilang → drop
    const ext  = path.extname(file).slice(1).toLowerCase();
    const mime = { svg: 'image/svg+xml', png: 'image/png', ico: 'image/x-icon', jpg: 'image/jpeg', jpeg: 'image/jpeg' }[ext] || 'image/svg+xml';
    const b64  = fs.readFileSync(file).toString('base64');
    report.favicon++;
    return `<link rel="icon" type="${mime}" href="data:${mime};base64,${b64}">`;
  }
);

/* ── 5) Tulis balik ke dist/index.html (untuk debug lokal) ── */
fs.writeFileSync(indexPath, html);

/* ── 6) Emit frontend.html.cjs ── */
const cjs = `'use strict';\nmodule.exports = ${JSON.stringify(html)};\n`;
fs.writeFileSync(outCjsPath, cjs);

const kb = (Buffer.byteLength(cjs, 'utf8') / 1024).toFixed(1);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`✅ frontend.html.cjs generated (${kb} KB)`);
console.log(`   ↳ CSS inlined : ${report.css}`);
console.log(`   ↳ JS  inlined : ${report.js}`);
console.log(`   ↳ Favicon     : ${report.favicon}`);
console.log(`   ↳ Skipped     : ${report.skipped}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
