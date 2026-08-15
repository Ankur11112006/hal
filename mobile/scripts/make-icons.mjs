// Regenerate the app icons from assets/logo.png.
//
//   node scripts/make-icons.mjs
//
// The source logo sits on a green-to-cyan gradient. Android adaptive icons mask
// the foreground to a circle or squircle and crop roughly the outer third, so a
// gradient square dropped in whole would show as a square inside the circle.
// The artwork is therefore lifted off its background by HUE (every part of the
// plough, arc and wheat is warm; the whole background is green), placed in the
// adaptive safe zone, and given the app's own deep green behind it.
//
// The extraction itself lives in scripts/extract-art.py because it needs numpy;
// this file only composes what that produced.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.resolve(here, '..', 'assets');

if (!fs.existsSync(path.join(assets, 'logo.png'))) {
  console.error('assets/logo.png is missing; nothing to build from');
  process.exit(1);
}

execFileSync('python', [path.join(here, 'extract-art.py')], { stdio: 'inherit' });
console.log('icons written to assets/');
