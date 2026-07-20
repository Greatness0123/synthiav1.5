import fs from 'fs';
import path from 'path';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(__dirname, '..');

const frontendTypesDir = path.join(root, 'src/types');
const coordinatorTypesDir = path.join(root, 'coordinator/src/types');

const frontendProgramsDir = path.join(root, 'src/world/programs');
const coordinatorProgramsDir = path.join(root, 'coordinator/programs/primitives');

function syncDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.warn(`Source directory ${src} does not exist. Skipping.`);
    return;
  }
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const files = fs.readdirSync(src);
  for (const file of files) {
    const srcFile = path.join(src, file);
    const destFile = path.join(dest, file);

    if (fs.statSync(srcFile).isDirectory()) {
      syncDir(srcFile, destFile);
    } else {
      console.log(`Syncing ${file}...`);
      fs.copyFileSync(srcFile, destFile);
    }
  }
}

console.log('Syncing types...');
syncDir(frontendTypesDir, coordinatorTypesDir);

console.log('Syncing motor programs...');
syncDir(frontendProgramsDir, coordinatorProgramsDir);

console.log('Sync complete!');
