import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read gateway key from agent-gateway.json
const gatewayPath = path.join(__dirname, '../agent-gateway.json');
if (!fs.existsSync(gatewayPath)) {
  console.error("Error: agent-gateway.json not found. Please ensure the game client is running and loaded in your browser!");
  process.exit(1);
}

let gatewayData;
try {
  gatewayData = JSON.parse(fs.readFileSync(gatewayPath, 'utf8'));
} catch (err) {
  console.error("Error: Failed to parse agent-gateway.json:", err);
  process.exit(1);
}

const { gatewayKey, roomCode, endpoint } = gatewayData;
console.log(`Found active Gateway Key: ${gatewayKey} (Room: ${roomCode})`);

// Parse command line arguments
const args = {};
process.argv.slice(2).forEach(arg => {
  if (arg.startsWith('--')) {
    const parts = arg.slice(2).split('=');
    const key = parts[0];
    const value = parts.slice(1).join('=');
    args[key] = value;
  }
});

// Strategy URL Parameters (Default values)
const target = args.target || 'lowest_hp';
const avoid = args.avoid || 'none';
const betray = args.betray || 'never';
const skill = args.skill || 'balanced';
const survive = args.survive || 'trade';
const promise = args.promise || 'honor';
const modules = args.modules || ''; // e.g. "Wing Swarm-Lv3,Missile Storm-Lv2"

// Construct the Astra Gambit import URL
const queryParams = new URLSearchParams({
  t: roomCode,
  v: '1',
  target,
  avoid,
  betray,
  skill,
  survive,
  promise
});

if (modules) {
  queryParams.set('modules', modules);
}

const strategyUrl = `https://astra-gambit.com/import?${queryParams.toString()}`;

console.log(`Generated Strategy URL: ${strategyUrl}`);
console.log(`Pushing strategy to game client via: ${endpoint}...`);

try {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      key: gatewayKey,
      strategyUrl
    })
  });

  const resData = await response.json();
  if (response.ok && resData.ok) {
    console.log("Success: AI Strategy and Module loadout successfully bound and pushed to Storm Blaster!");
  } else {
    console.error("Error: Server rejected the strategy push:", resData.error || "Unknown error");
    process.exit(1);
  }
} catch (err) {
  console.error("Error: Failed to connect to the game server:", err.message);
  process.exit(1);
}
