/**
 * Copies vendor assets from node_modules to public/leaflet/ and public/vendor/
 * so they are served as static assets by both Express (local) and
 * Cloudflare Pages (production) without relying on a CDN.
 *
 * Run automatically via the "prepare" npm hook (after npm install).
 */

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

function copyDir(src, dest) {
  if (!fs.existsSync(src)) { console.error(`ERROR: ${src} not found. Run npm install first.`); process.exit(1); }
  fs.mkdirSync(dest, { recursive: true });
  for (const item of fs.readdirSync(src)) {
    const s = path.join(src, item), d = path.join(dest, item);
    fs.statSync(s).isDirectory() ? fs.cpSync(s, d, { recursive: true }) : fs.copyFileSync(s, d);
  }
}

function copyFile(src, dest) {
  if (!fs.existsSync(src)) { console.error(`ERROR: ${src} not found. Run npm install first.`); process.exit(1); }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

// Leaflet
copyDir(
  path.join(root, 'node_modules', 'leaflet', 'dist'),
  path.join(root, 'public', 'leaflet')
);
console.log('Leaflet files copied to public/leaflet/');

// Chart.js UMD build
copyFile(
  path.join(root, 'node_modules', 'chart.js', 'dist', 'chart.umd.js'),
  path.join(root, 'public', 'vendor', 'chart.umd.js')
);
console.log('Chart.js copied to public/vendor/chart.umd.js');

