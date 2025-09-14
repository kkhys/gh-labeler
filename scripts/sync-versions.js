/**
 * Version synchronization script
 * Syncs version from package.json to Cargo.toml
 */
const fs = require('fs');
const path = require('path');

try {
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const newVersion = packageJson.version;

  const cargoTomlPath = path.join(process.cwd(), 'Cargo.toml');
  let cargoToml = fs.readFileSync(cargoTomlPath, 'utf8');

  const versionRegex = /version\s*=\s*"[\d.]+"/;
  const newVersionLine = `version = "${newVersion}"`;
  
  if (versionRegex.test(cargoToml)) {
    cargoToml = cargoToml.replace(versionRegex, newVersionLine);
    fs.writeFileSync(cargoTomlPath, cargoToml);
    console.log(`✅ Synced version to ${newVersion}`);
    console.log(`   📦 package.json: ${newVersion}`);
    console.log(`   🦀 Cargo.toml: ${newVersion}`);
  } else {
    console.error('❌ Could not find version field in Cargo.toml');
    process.exit(1);
  }
} catch (error) {
  console.error('❌ Error syncing versions:', error.message);
  process.exit(1);
}
