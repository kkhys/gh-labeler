/**
 * Cross-platform binary copy script
 * Copies the built Rust binary to the bin directory
 */
const fs = require('fs');
const path = require('path');

try {
  // Ensure bin directory exists
  const binDir = path.join(process.cwd(), 'bin');
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
    console.log('✅ Created bin directory');
  }

  // Determine binary name based on platform
  const isWindows = process.platform === 'win32';
  const sourceBinary = path.join('target', 'release', isWindows ? 'gh-labeler.exe' : 'gh-labeler');
  const targetBinary = path.join(binDir, isWindows ? 'gh-labeler.exe' : 'gh-labeler');

  // Check if source exists
  if (!fs.existsSync(sourceBinary)) {
    console.error(`❌ Source binary not found: ${sourceBinary}`);
    process.exit(1);
  }

  // Copy binary
  fs.copyFileSync(sourceBinary, targetBinary);
  
  // Make executable on Unix-like systems
  if (!isWindows) {
    fs.chmodSync(targetBinary, '755');
  }

  console.log(`✅ Copied binary: ${sourceBinary} → ${targetBinary}`);
} catch (error) {
  console.error('❌ Error copying binary:', error.message);
  process.exit(1);
}
