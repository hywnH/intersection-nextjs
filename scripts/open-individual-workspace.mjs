#!/usr/bin/env node
/**
 * Open NoiseCraft Individual Audio Workspace
 * 
 * Opens the individual audio mapping workspace with:
 * - Individual audio map (indiv_audio_map.ncft)
 * - Per-user sequencer patterns
 * - Individual particle audio modulation
 */

import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync } from "fs";
import http from "http";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_DIR = join(__dirname, "..");
const NOISECRAFT_DIR = join(PROJECT_DIR, "noisecraft");

const NOISECRAFT_PORT = process.env.NOISECRAFT_PORT || process.env.HTTP_PORT_NO || 7773;
const NOISECRAFT_URL = `http://localhost:${NOISECRAFT_PORT}`;
const RT_ENV = process.env.NEXT_PUBLIC_WS_URL || 
  (process.env.NODE_ENV === "development" ? "http://localhost:3001/socket" : "/socket");
const RT_URL = RT_ENV.startsWith("/") ? `${new URL(NOISECRAFT_URL).origin}${RT_ENV}` : RT_ENV;

// Individual audio workspace URL (with full workspace UI)
const INDIVIDUAL_URL = `${NOISECRAFT_URL}/public/individual-workspace.html`;

async function checkServer(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      resolve(res.statusCode === 200);
      res.on("data", () => {});
      res.on("end", () => {});
    });
    req.on("error", () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(url, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    if (await checkServer(url)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
    process.stdout.write(".");
  }
  return false;
}

function openBrowser(url) {
  const platform = process.platform;
  let command;
  let args;

  if (platform === "darwin") {
    command = "open";
    args = ["-a", "Google Chrome", url];
  } else if (platform === "win32") {
    command = "cmd";
    args = ["/c", `start chrome "${url}"`];
  } else {
    command = "google-chrome";
    args = [url];
    try {
      spawn(command, args, {
        stdio: "ignore",
        detached: true,
      });
      return;
    } catch (e) {
      command = "xdg-open";
      args = [url];
    }
  }

  spawn(command, args, {
    stdio: "ignore",
    detached: true,
  });
}

async function startServer() {
  if (!existsSync(join(NOISECRAFT_DIR, "package.json"))) {
    console.error("❌ Error: NoiseCraft directory not found");
    process.exit(1);
  }

  const nodeModulesPath = join(NOISECRAFT_DIR, "node_modules");
  if (!existsSync(nodeModulesPath)) {
    console.log("📦 Installing dependencies...");
    const npmInstall = spawn("npm", ["install"], {
      cwd: NOISECRAFT_DIR,
      stdio: "inherit",
    });
    
    await new Promise((resolve, reject) => {
      npmInstall.on("close", (code) => {
        if (code === 0) {
          console.log("✅ Dependencies installed");
          resolve();
        } else {
          console.error("❌ Failed to install dependencies");
          reject(new Error(`npm install exited with code ${code}`));
        }
      });
    });
  }

  console.log("📝 Starting NoiseCraft server...");

  const npm = spawn("npm", ["start"], {
    cwd: NOISECRAFT_DIR,
    stdio: "ignore",
    detached: true,
    env: {
      ...process.env,
      HTTP_PORT_NO: String(NOISECRAFT_PORT),
    },
  });

  npm.unref();
  return npm.pid;
}

async function main() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🎵 NoiseCraft Individual Audio Workspace");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const serverRunning = await checkServer(NOISECRAFT_URL);
  
  if (!serverRunning) {
    console.log("⚠️  NoiseCraft server not running");
    const pid = await startServer();
    console.log(`✅ Started server (PID: ${pid})`);
    console.log("⏳ Waiting for server to start");
    process.stdout.write("   ");
    
    if (!(await waitForServer(NOISECRAFT_URL))) {
      console.log("\n❌ Server failed to start");
      process.exit(1);
    }
    console.log("\n✅ Server is ready!");
    await new Promise((resolve) => setTimeout(resolve, 500));
    console.log("");
  } else {
    console.log("✅ NoiseCraft server is already running\n");
  }

  console.log(`🚀 Opening Individual Audio workspace in Chrome:`);
  console.log(`   ${INDIVIDUAL_URL}\n`);
  openBrowser(INDIVIDUAL_URL);

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Individual Audio Features:");
  console.log("  • Individual audio map (indiv_audio_map.ncft)");
  console.log("  • Per-user sequencer patterns (bass/baritone/tenor)");
  console.log("  • Individual particle audio modulation");
  console.log("  • Approach-based parameter mapping");
  console.log("");
  console.log("This workspace is for editing individual audio mappings.");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});

