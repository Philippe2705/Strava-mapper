/**
 * Copies Leaflet dist files from node_modules to public/leaflet/
 * so they are served as static assets by both Express (local) and
 * Cloudflare Pages (production) without relying on a CDN.
 *
 * Run automatically via the "prepare" npm hook (after npm install).
 */

const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'node_modules', 'leaflet', 'dist');
const dest = path.join(__dirname, '..', 'public', 'leaflet');

if (!fs.existsSync(src)) {
  console.error('ERROR: leaflet not found in node_modules. Run npm install first.');
  process.exit(1);
}

fs.mkdirSync(dest, { recursive: true });

for (const item of fs.readdirSync(src)) {
  const srcPath = path.join(src, item);
  const destPath = path.join(dest, item);
  if (fs.statSync(srcPath).isDirectory()) {
    fs.cpSync(srcPath, destPath, { recursive: true });
  } else {
    fs.copyFileSync(srcPath, destPath);
  }
}

console.log('Leaflet files copied to public/leaflet/');
