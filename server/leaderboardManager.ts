import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeBotPolicy, type BotPolicy } from '../src/game/bots/index.ts';
import type { LadderEntry } from '../src/game/multiplayer/protocol.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');
const FILE_PATH = path.join(DATA_DIR, 'leaderboard.json');

export function calculateCP(score: number, modules: string[]): number {
  let moduleLevelSum = 0;
  for (const mod of modules) {
    const match = /lv\s*([1-3])/i.exec(mod);
    if (match) {
      moduleLevelSum += parseInt(match[1], 10);
    } else if (mod) {
      moduleLevelSum += 1;
    }
  }
  return 2000 + (moduleLevelSum * 750) + (score * 3);
}

const SYSTEM_AI_ROSTER: LadderEntry[] = [
  {
    playerId: 'system-ares-99',
    displayName: 'ARES-99',
    score: 1800,
    modules: ['Wing Swarm-Lv3', 'Missile Storm-Lv3', 'Overload Lance-Lv3'],
    botKind: 'aggressive',
    combatPower: 0, // Computed on init
    isSystem: true,
  },
  {
    playerId: 'system-aegis-max',
    displayName: 'AEGIS-MAX',
    score: 1650,
    modules: ['Aegis Layer-Lv3', 'Repair Nanites-Lv3', 'Vector Drive-Lv3'],
    botKind: 'defensive',
    combatPower: 0,
    isSystem: true,
  },
  {
    playerId: 'system-ghost-x',
    displayName: 'GHOST-X',
    score: 1500,
    modules: ['Ghost Veil-Lv3', 'Phantom Echo-Lv3', 'Vector Drive-Lv3'],
    botKind: 'llm-strategy',
    policy: normalizeBotPolicy({
      targetPriority: 'lowest-hp',
      formation: 'edge-kite',
      dodgeStyle: 'wide',
      aggression: 0.1,
      retreatBias: 0.8,
      dodgeBias: 0.9,
    }),
    combatPower: 0,
    isSystem: true,
  },
  {
    playerId: 'system-lyra-31',
    displayName: 'LYRA-31',
    score: 1350,
    modules: ['Wing Swarm-Lv2', 'Aegis Layer-Lv2', 'Repair Nanites-Lv2'],
    botKind: 'collector',
    combatPower: 0,
    isSystem: true,
  },
  {
    playerId: 'system-nova-13',
    displayName: 'NOVA-13',
    score: 1200,
    modules: ['Missile Storm-Lv2', 'Overload Lance-Lv2', 'Vector Drive-Lv2'],
    botKind: 'aggressive',
    combatPower: 0,
    isSystem: true,
  },
  {
    playerId: 'system-echo-07',
    displayName: 'ECHO-07',
    score: 1100,
    modules: ['Ghost Veil-Lv2', 'Phantom Echo-Lv2', 'Aegis Layer-Lv1'],
    botKind: 'llm-strategy',
    policy: normalizeBotPolicy({
      targetPriority: 'nearest',
      formation: 'center-lane',
      dodgeStyle: 'wide',
      aggression: 0.5,
      retreatBias: 0.5,
      dodgeBias: 0.5,
    }),
    combatPower: 0,
    isSystem: true,
  },
];

export class LeaderboardManager {
  private entries = new Map<string, LadderEntry>();

  constructor() {
    this.ensureDataDirectory();
    this.load();
  }

  private ensureDataDirectory(): void {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  private load(): void {
    try {
      if (fs.existsSync(FILE_PATH)) {
        const content = fs.readFileSync(FILE_PATH, 'utf8');
        const list = JSON.parse(content) as LadderEntry[];
        this.entries.clear();
        for (const item of list) {
          // Recompute CP in case math was adjusted
          item.combatPower = calculateCP(item.score, item.modules);
          this.entries.set(item.playerId, item);
        }
        
        // Ensure standard system AI exist
        this.injectSystemAI();
      } else {
        this.initializeWithSystemAI();
      }
    } catch (error) {
      console.error('Failed to load leaderboard data, resetting to defaults.', error);
      this.initializeWithSystemAI();
    }
  }

  private save(): void {
    try {
      const list = this.getEntries();
      fs.writeFileSync(FILE_PATH, JSON.stringify(list, null, 2), 'utf8');
    } catch (error) {
      console.error('Failed to save leaderboard data.', error);
    }
  }

  private initializeWithSystemAI(): void {
    this.entries.clear();
    this.injectSystemAI();
    this.save();
  }

  private injectSystemAI(): void {
    for (const bot of SYSTEM_AI_ROSTER) {
      if (!this.entries.has(bot.playerId)) {
        const item = { ...bot };
        item.combatPower = calculateCP(item.score, item.modules);
        this.entries.set(item.playerId, item);
      }
    }
  }

  getEntries(): LadderEntry[] {
    return Array.from(this.entries.values()).sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return b.combatPower - a.combatPower;
    });
  }

  getEntry(playerId: string): LadderEntry | undefined {
    return this.entries.get(playerId);
  }

  updatePlayerDefense(
    playerId: string,
    displayName: string,
    modules: string[],
    botKind: string,
    policy?: BotPolicy
  ): LadderEntry {
    const existing = this.entries.get(playerId);
    const score = existing ? existing.score : 1000; // New players start at 1000 score
    
    const entry: LadderEntry = {
      playerId,
      displayName,
      score,
      modules,
      botKind,
      policy,
      combatPower: calculateCP(score, modules),
      isSystem: false,
    };

    this.entries.set(playerId, entry);
    this.save();
    return entry;
  }

  processBattleResult(
    challengerId: string,
    opponentId: string,
    outcome: 'win' | 'lose'
  ): { challengerChange: number; opponentChange: number } {
    const challenger = this.entries.get(challengerId);
    const opponent = this.entries.get(opponentId);

    if (!challenger || !opponent) {
      throw new Error('Challenger or opponent does not exist on leaderboard.');
    }

    let challengerChange = 0;
    let opponentChange = 0;

    if (outcome === 'win') {
      challengerChange = 25;
      opponentChange = -15;
    } else {
      challengerChange = -15;
      opponentChange = 10;
    }

    challenger.score = Math.max(100, challenger.score + challengerChange);
    challenger.combatPower = calculateCP(challenger.score, challenger.modules);

    opponent.score = Math.max(100, opponent.score + opponentChange);
    opponent.combatPower = calculateCP(opponent.score, opponent.modules);

    this.save();

    return {
      challengerChange,
      opponentChange,
    };
  }
}
