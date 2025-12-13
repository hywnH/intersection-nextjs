#!/usr/bin/env node
/**
 * Open NoiseCraft Global Audio Workspace
 * Opens the global workspace for testing harmonic progression algorithms
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_DIR = join(__dirname, '..');
const NOISECRAFT_DIR = join(PROJECT_DIR, 'noisecraft');

// Determine port (default 7773, or use environment variable)
const PORT = process.env.HTTP_PORT_NO || process.env.NOISECRAFT_PORT || 7773;
const BASE_URL = `http://localhost:${PORT}`;
const WORKSPACE_URL = `${BASE_URL}/public/global-workspace.html`;

/**
 * Check if server is responding
 */
async function checkServer(url) {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    return response.ok;
  } catch (e) {
    return false;
  }
}

/**
 * Wait for server to be ready
 */
async function waitForServer(url, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    if (await checkServer(url)) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
    process.stdout.write('.');
  }
  return false;
}

/**
 * Start NoiseCraft server
 */
async function startServer() {
  console.log(`📦 Starting NoiseCraft server on port ${PORT}...`);
  
  const serverProcess = spawn('node', ['server.js'], {
    cwd: NOISECRAFT_DIR,
    env: { ...process.env, HTTP_PORT_NO: String(PORT) },
    stdio: 'inherit',
    detached: false
  });

  // Handle server process
  serverProcess.on('error', (err) => {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  });

  // Wait for server to be ready
  console.log('⏳ Waiting for server to start');
  const ready = await waitForServer(BASE_URL);
  
  if (!ready) {
    console.error('\n❌ Server failed to start within timeout');
    serverProcess.kill();
    process.exit(1);
  }
  
  console.log('\n✅ Server is ready!');
  return serverProcess;
}

/**
 * Open workspace in browser
 */
function openWorkspace() {
  const platform = process.platform;
  let command;
  
  if (platform === 'darwin') {
    command = 'open';
  } else if (platform === 'win32') {
    command = 'start';
  } else {
    command = 'xdg-open';
  }
  
  console.log(`🌐 Opening ${WORKSPACE_URL} in browser...`);
  spawn(command, [WORKSPACE_URL], { detached: true });
}

/**
 * Main function
 */
async function main() {
  console.log('🎵 NoiseCraft Global Audio Workspace');
  console.log(`📍 Target URL: ${WORKSPACE_URL}\n`);
  
  // Check if server is already running
  if (await checkServer(BASE_URL)) {
    console.log('✅ Server is already running');
    openWorkspace();
    return;
  }
  
  // Check if NoiseCraft directory exists
  if (!existsSync(NOISECRAFT_DIR)) {
    console.error(`❌ Error: NoiseCraft directory not found at ${NOISECRAFT_DIR}`);
    process.exit(1);
  }
  
  // Start server
  await startServer();
  
  // Open workspace
  openWorkspace();
  
  console.log('\n💡 Keep this terminal open to keep the server running');
  console.log('   Press Ctrl+C to stop the server\n');
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
