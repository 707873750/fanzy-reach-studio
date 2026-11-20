const fs = require('node:fs');
const path = require('node:path');
const { Arch } = require('builder-util');

module.exports = async context => {
  const arch = Arch[context.arch];
  const platform = context.electronPlatformName;
  const base = path.join(context.packager.projectDir, 'build', 'publisher', `${platform}-${arch}`);
  const binary = path.join(base, 'fanzy-publisher', platform === 'win32' ? 'fanzy-publisher.exe' : 'fanzy-publisher');
  if (process.platform !== platform || process.arch !== arch) {
    throw new Error('Build each installer on its target OS and architecture, including its Python worker.');
  }
  if (!fs.existsSync(binary) || !fs.existsSync(path.join(base, 'build-info.json'))) {
    throw new Error(`Missing bundled publisher for ${platform}-${arch}. Run npm run build:publisher first.`);
  }
  for (const tool of [require('ffmpeg-static'), require('ffprobe-static').path]) {
    if (!tool || !fs.existsSync(tool)) throw new Error('Missing bundled video tools. Reinstall npm dependencies on the target OS and architecture.');
  }
};
