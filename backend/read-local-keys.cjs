// Local demo only: send existing encrypted desktop credentials to the server over
// a private process IPC channel. Never write plaintext keys to disk or stdout.
const { app, safeStorage } = require('electron');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const userData = path.join(__dirname, '.local', 'electron');
// safeStorage uses Chromium's per-profile encrypted master key on Windows.
// Copy only that encrypted key into the isolated helper profile, not app data.
try {
  fsSync.mkdirSync(userData, { recursive: true });
  const source = JSON.parse(fsSync.readFileSync(path.join(app.getPath('appData'), 'fanzy-reach-studio', 'Local State'), 'utf8'));
  if (source.os_crypt) fsSync.writeFileSync(path.join(userData, 'Local State'), JSON.stringify({ os_crypt: source.os_crypt }));
} catch { /* The helper may still work on platforms without a Local State key. */ }
app.setPath('userData', userData);
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  let keys = null;
  try {
    const file = path.join(app.getPath('appData'), 'fanzy-reach-studio', 'reach-data.json');
    const stored = JSON.parse(await fs.readFile(file, 'utf8')).settings?.volcKeysEncrypted;
    if (stored && safeStorage.isEncryptionAvailable()) keys = JSON.parse(safeStorage.decryptString(Buffer.from(stored, 'base64')));
  } catch { /* Missing/unavailable credentials are reported without secret data. */ }
  if (process.send) process.send(keys, () => app.exit()); else app.exit();
});
