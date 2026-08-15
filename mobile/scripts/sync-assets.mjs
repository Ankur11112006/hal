// Copy the shared content JSON and the trained model into the app bundle.
// content/ at the repo root is canonical: the backend reads it directly and
// the app gets a copy here, because Metro will not resolve outside its root.
// Runs from npm prestart / preandroid, so an edit to the copy is never the
// version that ships.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not url.pathname: the repo path contains a space, and the raw
// pathname keeps it percent-encoded.
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const dst = path.resolve(here, '..', 'assets');

fs.mkdirSync(dst, { recursive: true });

let copied = 0;
for (const f of fs.readdirSync(path.join(root, 'content'))) {
  if (f.endsWith('.json')) {
    fs.copyFileSync(path.join(root, 'content', f), path.join(dst, f));
    copied++;
  }
}

const artifacts = path.join(root, 'artifacts');
const wanted = ['crop_model.tflite', 'labels.json', 'metrics.json'];
const missing = [];
for (const f of wanted) {
  const src = path.join(artifacts, f);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(dst, f));
    copied++;
  } else {
    missing.push(f);
  }
}

console.log(`sync-assets: ${copied} files -> assets/`);
if (missing.length) {
  // Not fatal. The blueprint's own risk register says ship a stub classifier
  // so all three tier screens stay rehearsable while the model is training.
  console.log(`sync-assets: model not built yet (${missing.join(', ')}). ` +
    `App will fall back to the stub classifier.`);
}
