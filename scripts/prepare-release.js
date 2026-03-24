import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import archiver from 'archiver';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, '..');
const releaseDir = path.join(rootDir, 'release');
const mirrorServerDir = path.join(rootDir, 'packages', 'mirror-server');
const extensionDir = path.join(rootDir, 'packages', 'extension');

const version = '2.0.0';

console.log('='.repeat(60));
console.log(`Overleaf CLI Release Preparation v${version}`);
console.log('='.repeat(60));

// Clean and create release directory
console.log('\n[1/6] Cleaning release directory...');
if (fs.existsSync(releaseDir)) {
  fs.rmSync(releaseDir, { recursive: true, force: true });
}
fs.mkdirSync(releaseDir, { recursive: true });
console.log('✓ Release directory cleaned');

// Build all packages
console.log('\n[2/6] Building all packages...');
try {
  execSync('npm run build', { cwd: rootDir, stdio: 'inherit' });
  console.log('✓ All packages built successfully');
} catch (error) {
  console.error('✗ Build failed');
  process.exit(1);
}

// Pack npm package
console.log('\n[3/6] Creating npm tarball...');
const npmTarballName = `overleaf-cli-v${version}.tgz`;
try {
  execSync('npm pack', { cwd: mirrorServerDir });
  const tarballPath = path.join(mirrorServerDir, `overleaf-cli-${version}.tgz`);
  const targetPath = path.join(releaseDir, npmTarballName);
  fs.renameSync(tarballPath, targetPath);
  console.log(`✓ npm tarball created: ${npmTarballName}`);
} catch (error) {
  console.error('✗ Failed to create npm tarball');
  process.exit(1);
}

// Create extension zip
console.log('\n[4/6] Creating extension zip...');
const extensionZipName = `overleaf-extension-v${version}.zip`;
const extensionZipPath = path.join(releaseDir, extensionZipName);

try {
  await createExtensionZip(extensionDir, extensionZipPath);
  console.log(`✓ Extension zip created: ${extensionZipName}`);
} catch (error) {
  console.error('✗ Failed to create extension zip');
  console.error(error);
  process.exit(1);
}

// Generate checksums
console.log('\n[5/6] Generating checksums...');
const checksums = generateChecksums(releaseDir);
const checksumsPath = path.join(releaseDir, 'checksums.txt');
fs.writeFileSync(checksumsPath, checksums);
console.log('✓ Checksums generated');

// Output release notes
console.log('\n[6/6] Release preparation complete!');
console.log('\n' + '='.repeat(60));
console.log('Release Summary');
console.log('='.repeat(60));
console.log(`Version: ${version}`);
console.log(`Release Directory: ${releaseDir}`);
console.log('\nFiles:');
console.log(`  - ${npmTarballName}`);
console.log(`  - ${extensionZipName}`);
console.log(`  - checksums.txt`);
console.log('\nChecksums:');
console.log(checksums);

console.log('\n' + '='.repeat(60));
console.log('Publishing Instructions');
console.log('='.repeat(60));
console.log('\nTo publish to npm:');
console.log(`  cd packages/mirror-server && npm publish`);
console.log('\nTo publish to Chrome Web Store:');
console.log(`  1. Visit https://chrome.google.com/webstore/devconsole`);
console.log(`  2. Upload ${extensionZipName}`);
console.log(`  3. Fill in store information`);
console.log(`  4. Submit for review`);
console.log('');

/**
 * Create extension zip file
 */
async function createExtensionZip(sourceDir, outputPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      console.log(`  Zip size: ${archive.pointer()} bytes`);
      resolve();
    });

    archive.on('error', (err) => {
      reject(err);
    });

    archive.pipe(output);

    // Add files to zip
    archive.file(path.join(sourceDir, 'manifest.json'), { name: 'manifest.json' });

    // Add dist files
    const distDir = path.join(sourceDir, 'dist');
    archive.directory(distDir, 'dist');

    // Add icons
    const iconsDir = path.join(sourceDir, 'icons');
    archive.directory(iconsDir, 'icons');

    // Add public files
    const publicDir = path.join(sourceDir, 'public');
    archive.directory(publicDir, 'public');

    archive.finalize();
  });
}

/**
 * Generate SHA256 checksums for all files in directory
 */
function generateChecksums(directory) {
  const files = fs.readdirSync(directory);
  const ignoreFiles = ['checksums.txt', 'release-notes.txt'];
  let output = '';

  files
    .filter(file => !ignoreFiles.includes(file))
    .forEach(file => {
      const filePath = path.join(directory, file);
      const content = fs.readFileSync(filePath);
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      output += `SHA256(${file})= ${hash}\n`;
    });

  return output;
}
