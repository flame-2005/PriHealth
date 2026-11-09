/**
 * Privacy gate: fails if the release manifest (source or merged) declares INTERNET.
 * Run after a release build for the merged check: `npm run build:android:release && npm run check:manifest`.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'android', 'app');
const candidates = [
  path.join(root, 'src', 'main', 'AndroidManifest.xml'),
  path.join(root, 'build', 'intermediates', 'merged_manifests', 'release', 'processReleaseManifest', 'AndroidManifest.xml'),
  path.join(root, 'build', 'intermediates', 'merged_manifests', 'release', 'AndroidManifest.xml'),
];

/** True when a <uses-permission> element (not a comment) declares INTERNET. */
function declaresInternet(xml) {
  const withoutComments = xml.replace(/<!--[\s\S]*?-->/g, '');
  return /<uses-permission[^>]*android:name\s*=\s*"android\.permission\.INTERNET"/.test(withoutComments);
}

let checked = 0;
let failed = false;
for (const file of candidates) {
  if (!fs.existsSync(file)) continue;
  checked++;
  const bad = declaresInternet(fs.readFileSync(file, 'utf8'));
  console.log(`${bad ? 'FAIL' : 'ok  '} ${path.relative(process.cwd(), file)}`);
  if (bad) failed = true;
}
if (!checked) {
  console.error('No manifest found to check.');
  process.exit(2);
}
process.exit(failed ? 1 : 0);
