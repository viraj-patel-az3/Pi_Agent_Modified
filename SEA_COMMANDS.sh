#!/usr/bin/env bash
set -euo pipefail

# Check Node version (>= 25.5.0 required, >= 26.3.0 recommended)
NODE_VERSION=$(node -v | cut -d 'v' -f 2)
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d '.' -f 1)
NODE_MINOR=$(echo "$NODE_VERSION" | cut -d '.' -f 2)

if [ "$NODE_MAJOR" -lt 25 ] || ([ "$NODE_MAJOR" -eq 25 ] && [ "$NODE_MINOR" -lt 5 ]); then
    echo "Error: Node.js version >= 25.5.0 is required. Current version: $NODE_VERSION"
    exit 1
fi

if [ "$NODE_MAJOR" -lt 26 ] || ([ "$NODE_MAJOR" -eq 26 ] && [ "$NODE_MINOR" -lt 3 ]); then
    echo "Warning: Node.js version 26.3.0 or higher is recommended for the best SEA support. Current version: $NODE_VERSION"
fi

mkdir -p scripts

if [ ! -f scripts/build-sea.mjs ]; then
  cat > scripts/build-sea.mjs <<'MJS'
import { build } from 'esbuild';
import { copyFile, mkdir, writeFile, chmod, cp, unlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const seaDir = path.resolve(rootDir, 'dist/sea');
const nodeExe = process.execPath;
const nodeVersion = process.version;

const v = nodeVersion.replace(/^v/, '').split('.').map(Number);
const isBuildSeaAvailable = (v[0] > 25) || (v[0] === 25 && v[1] >= 5);

async function main() {
  await mkdir(seaDir, { recursive: true });

  console.log('==> Diagnostics:');
  console.log(`    Node Executable: ${nodeExe}`);
  console.log(`    Node Version:    ${nodeVersion}`);
  
  const grepFuse = spawnSync('grep', ['-a', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', nodeExe]);
  const hasFuse = grepFuse.status === 0;
  console.log(`    Contains FUSE:   ${hasFuse ? 'Yes' : 'No'}`);

  console.log('==> Bundling CLI...');
  await build({
    entryPoints: [path.join(rootDir, 'packages/coding-agent/src/cli.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: path.join(seaDir, 'pi.js'),
    external: [
      '@mariozechner/clipboard',
      '@silvia-odwyer/photon-node',
      'fsevents'
    ],
    define: {
      'process.env.PI_CODING_AGENT': '"true"',
      'import.meta.url': '__importMetaUrl'
    },
    banner: {
      js: 'const __importMetaUrl = require("url").pathToFileURL(__filename).href;'
    }
  });

  const platform = process.platform;
  const targetPath = path.join(seaDir, platform === 'win32' ? 'pi.exe' : 'pi');
  
  try { await unlink(targetPath); } catch {}

  if (isBuildSeaAvailable) {
    console.log('==> Creating SEA config for built-in flow...');
    const config = {
      main: path.join(seaDir, 'pi.js'),
      output: targetPath,
      disableSentinel: true
    };
    await writeFile(path.join(seaDir, 'sea-config.json'), JSON.stringify(config, null, 2));

    console.log(`==> Building executable using ${nodeExe} --build-sea...`);
    const buildSeaResult = spawnSync(nodeExe, ['--build-sea', path.join(seaDir, 'sea-config.json')], { stdio: 'inherit', cwd: seaDir });
    if (buildSeaResult.status !== 0) {
      console.error('==> Error: node --build-sea failed');
      process.exit(buildSeaResult.status || 1);
    }
  } else {
    console.log('==> Creating SEA config for postject flow...');
    const config = {
      main: path.join(seaDir, 'pi.js'),
      output: path.join(seaDir, 'pi.blob'),
      disableSentinel: true
    };
    await writeFile(path.join(seaDir, 'sea-config.json'), JSON.stringify(config, null, 2));

    console.log(`==> Building SEA blob using ${nodeExe} --experimental-sea-config...`);
    const buildSeaResult = spawnSync(nodeExe, ['--experimental-sea-config', path.join(seaDir, 'sea-config.json')], { stdio: 'inherit', cwd: seaDir });
    if (buildSeaResult.status !== 0) {
      console.error('==> Error: node --experimental-sea-config failed');
      process.exit(buildSeaResult.status || 1);
    }

    console.log('==> Preparing executable...');
    await copyFile(nodeExe, targetPath);
    await chmod(targetPath, 0o755);

    if (platform === 'darwin') {
      console.log('==> Removing signature (macOS)...');
      spawnSync('codesign', ['--remove-signature', targetPath], { stdio: 'inherit' });
    }

    const grepCopiedFuse = spawnSync('grep', ['-a', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', targetPath]);
    if (grepCopiedFuse.status !== 0) {
      console.error(`==> Error: Sentinel NODE_SEA_FUSE not found in the copied binary ${targetPath}. Cannot inject.`);
      process.exit(1);
    }

    console.log('==> Injecting blob...');
    const postjectPath = path.join(rootDir, 'node_modules/.bin/postject');
    const postjectCmd = `"${postjectPath}" "${targetPath}" NODE_SEA_BLOB "${path.join(seaDir, 'pi.blob')}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 ${platform === 'darwin' ? '--macho-segment-name NODE_SEA' : ''}`;
    
    let postjectResult = spawnSync(postjectCmd, { stdio: 'inherit', shell: true });

    if (postjectResult.status !== 0) {
      console.log('==> Postject failed (potentially multiple sentinels), trying perl hack...');
      const perlCmd = `perl -pe 's/NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2/NODE_SEA_FUSE_Xce680ab2cc467b6e072b8b5df1996b2/g' "${path.join(seaDir, 'pi.blob')}" > "${path.join(seaDir, 'pi.blob.hacked')}" && mv "${path.join(seaDir, 'pi.blob.hacked')}" "${path.join(seaDir, 'pi.blob')}"`;
      spawnSync(perlCmd, { shell: true });
      postjectResult = spawnSync(postjectCmd, { stdio: 'inherit', shell: true });
    }

    if (postjectResult.status !== 0) {
      console.error('==> Error: Postject failed completely.');
      process.exit(postjectResult.status || 1);
    }
  }

  console.log('==> Checking for dynamic libnode dependency...');
  let needsLibnode = false;
  let libnodeName = '';
  if (platform === 'darwin') {
    const otool = spawnSync('otool', ['-L', nodeExe], { encoding: 'utf8' });
    if (otool.stdout && otool.stdout.includes('libnode')) {
      needsLibnode = true;
      const match = otool.stdout.match(/libnode[\w\.-]*\.dylib/);
      if (match) libnodeName = match[0];
    }
  } else if (platform === 'linux') {
    const ldd = spawnSync('ldd', [nodeExe], { encoding: 'utf8' });
    if (ldd.stdout && ldd.stdout.includes('libnode')) {
      needsLibnode = true;
      const match = ldd.stdout.match(/libnode[\w\.-]*\.so/);
      if (match) libnodeName = match[0];
    }
  }
  
  if (needsLibnode && libnodeName) {
    const possiblePaths = [
      path.join(path.dirname(nodeExe), libnodeName),
      path.join(path.dirname(nodeExe), '..', 'lib', libnodeName)
    ];
    let found = false;
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        console.log(`==> Copying required ${libnodeName} from ${p}...`);
        await copyFile(p, path.join(seaDir, libnodeName));
        found = true;
        break;
      }
    }
    if (!found) {
      console.warn(`==> Warning: Node binary depends on ${libnodeName} but it could not be found to copy.`);
    }
  }

  if (platform === 'darwin') {
    console.log('==> Resigning executable (macOS)...');
    spawnSync('codesign', ['--sign', '-', targetPath], { stdio: 'inherit' });
  }

  console.log('==> Copying assets and native modules...');
  const codingAgentDir = path.join(rootDir, 'packages/coding-agent');
  
  await copyFile(path.join(codingAgentDir, 'package.json'), path.join(seaDir, 'package.json'));
  await copyFile(path.join(codingAgentDir, 'README.md'), path.join(seaDir, 'README.md'));
  await copyFile(path.join(codingAgentDir, 'CHANGELOG.md'), path.join(seaDir, 'CHANGELOG.md'));
  
  await mkdir(path.join(seaDir, 'theme'), { recursive: true });
  const themeFiles = ['dark.json', 'light.json', 'theme-schema.json'];
  for (const f of themeFiles) {
    await copyFile(path.join(codingAgentDir, 'src/modes/interactive/theme', f), path.join(seaDir, 'theme', f));
  }
  
  await mkdir(path.join(seaDir, 'assets'), { recursive: true });
  await copyFile(path.join(codingAgentDir, 'src/modes/interactive/assets/clankolas.png'), path.join(seaDir, 'assets/clankolas.png'));
  
  await mkdir(path.join(seaDir, 'export-html/vendor'), { recursive: true });
  await copyFile(path.join(codingAgentDir, 'src/core/export-html/template.html'), path.join(seaDir, 'export-html/template.html'));
  await copyFile(path.join(codingAgentDir, 'src/core/export-html/vendor/highlight.min.js'), path.join(seaDir, 'export-html/vendor/highlight.min.js'));
  await copyFile(path.join(codingAgentDir, 'src/core/export-html/vendor/marked.min.js'), path.join(seaDir, 'export-html/vendor/marked.min.js'));
  
  await cp(path.join(codingAgentDir, 'docs'), path.join(seaDir, 'docs'), { recursive: true });
  await cp(path.join(codingAgentDir, 'examples'), path.join(seaDir, 'examples'), { recursive: true });

  await mkdir(path.join(seaDir, 'agent-data'), { recursive: true });

  await copyFile(path.join(rootDir, 'node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm'), path.join(seaDir, 'photon_rs_bg.wasm'));

  const clipboardDir = path.join(seaDir, 'node_modules/@mariozechner');
  await mkdir(clipboardDir, { recursive: true });
  await cp(path.join(rootDir, 'node_modules/@mariozechner/clipboard'), path.join(clipboardDir, 'clipboard'), { recursive: true });

  let clipboardNative = '';
  if (platform === 'darwin') {
    clipboardNative = process.arch === 'arm64' ? 'clipboard-darwin-arm64' : 'clipboard-darwin-x64';
  } else if (platform === 'linux') {
    clipboardNative = process.arch === 'arm64' ? 'clipboard-linux-arm64-gnu' : 'clipboard-linux-x64-gnu';
  } else if (platform === 'win32') {
    clipboardNative = process.arch === 'arm64' ? 'clipboard-win32-arm64-msvc' : 'clipboard-win32-x64-msvc';
  }

  if (clipboardNative) {
    await cp(path.join(rootDir, 'node_modules/@mariozechner', clipboardNative), path.join(clipboardDir, clipboardNative), { recursive: true });
  }

  if (platform === 'darwin') {
    const archDir = process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
    const nativeDir = path.join(seaDir, 'native/darwin/prebuilds', archDir);
    await mkdir(nativeDir, { recursive: true });
    await copyFile(path.join(rootDir, 'packages/tui/native/darwin/prebuilds', archDir, 'darwin-modifiers.node'), path.join(nativeDir, 'darwin-modifiers.node'));
  }
  if (platform === 'win32') {
    const archDir = process.arch === 'arm64' ? 'win32-arm64' : 'win32-x64';
    const nativeDir = path.join(seaDir, 'native/win32/prebuilds', archDir);
    await mkdir(nativeDir, { recursive: true });
    await copyFile(path.join(rootDir, 'packages/tui/native/win32/prebuilds', archDir, 'win32-console-mode.node'), path.join(nativeDir, 'win32-console-mode.node'));
  }

  console.log('==> Verifying final executable...');
  const testRun = spawnSync(targetPath, ['--help'], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  const output = testRun.stdout || testRun.stderr || '';

  if (output.includes('Usage: node [options]')) {
    console.error('==> Error: Executable verification failed. The generated binary acts like plain Node.js.');
    process.exit(1);
  } else {
    console.log('\n==> SEA build complete: ' + targetPath);
  }
  }

  main().catch(err => {
  console.error(err);
  process.exit(1);
  });
MJS
  fi

  rm -rf dist/sea
  node scripts/build-sea.mjs

  ./dist/sea/pi --version
  HELP_OUTPUT=$(./dist/sea/pi --help)

  if echo "$HELP_OUTPUT" | grep -q "Usage: node \[options\]"; then
    echo "Error: Output contains Node help instead of Pi help!"
    exit 1
  fi

  rm -rf /tmp/pi-sea-test
  mkdir -p /tmp/pi-sea-test
  cp -R dist/sea /tmp/pi-sea-test/

  cd /tmp/pi-sea-test

  echo "==> Verifying SEA independence..."
  # Test that it runs without PI_CODING_AGENT_DIR set and defaults to local agent-data
  # We mock HOME to ensure it's not using ~/.pi/agent
  MOCK_HOME=$(mktemp -d)
  export HOME="$MOCK_HOME"

  ./sea/pi --version
  ./sea/pi --help

  # Verify that agent-data exists in the sea folder
  if [ ! -d sea/agent-data ]; then
    echo "Error: sea/agent-data directory missing!"
    exit 1
  fi

  # Verify it doesn't create ~/.pi in the mock home
  if [ -d "$MOCK_HOME/.pi" ]; then
    echo "Error: SEA executable created ~/.pi in mock home instead of using local agent-data!"
    exit 1
  fi

  echo "==> SEA independence verified: using local agent-data/"

  # Verify theme assets are found (interactive mode check)
  ./sea/pi --help | grep -q "interactive" || echo "Warning: interactive mode not found in help"

  # Clean up mock home
  rm -rf "$MOCK_HOME"

  # Interactive and API key tests (Manual)
  # OPENAI_API_KEY="$OPENAI_API_KEY" ./sea/pi --no-extensions --provider openai --model gpt-4o-mini -p "Say hello from SEA"
  # GEMINI_API_KEY="$GEMINI_API_KEY" ./sea/pi --no-extensions --provider google -p "Say hello from SEA"
  # ./sea/pi --no-extensions
