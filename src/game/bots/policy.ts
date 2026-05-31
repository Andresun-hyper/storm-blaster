import type { BotId, CompressedObservation, CollectibleKind } from './observation';
import { distanceSquared } from './shared';

export type StrategyRefreshReason =
  | 'match-start'
  | 'phase-change'
  | 'periodic'
  | 'policy-expired'
  | 'manual';

export type StrategyTargetPriority =
  | 'nearest'
  | 'lowest-hp'
  | 'threatening'
  | 'opportunity';

export type StrategyFormation = 'center-lane' | 'edge-kite' | 'wide-arc' | 'orbit';
export type StrategyDodgeStyle = 'tight' | 'wide' | 'zigzag';

export interface StrategyTokenBudget {
  readonly maxPromptChars: number;
  readonly maxPromptTokens: number;
  readonly maxOpponents: number;
  readonly maxThreats: number;
  readonly maxPickups: number;
}

export interface BotPolicy {
  readonly schemaVersion: 1;
  readonly persona: string;
  readonly risk: number;
  readonly aggression: number;
  readonly collectBias: number;
  readonly dodgeBias: number;
  readonly retreatBias: number;
  readonly engagementRange: number;
  readonly targetPriority: StrategyTargetPriority;
  readonly dodgeStyle: StrategyDodgeStyle;
  readonly formation: StrategyFormation;
  readonly powerupPriority: readonly CollectibleKind[];
  readonly fireMode: 'auto' | 'hold';
  readonly refreshIntervalMs: number;
  readonly maxRefreshesPerMatch: number;
  readonly cacheTtlMs: number;
}

export interface StrategyEntityDigest {
  readonly id: BotId;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly hp?: number;
  readonly maxHp?: number;
  readonly score?: number;
  readonly kills?: number;
  readonly priority?: number;
}

export interface StrategyObservationDigest {
  readonly arena: {
    readonly width: number;
    readonly height: number;
    readonly tick?: number;
    readonly timeMs?: number;
    readonly phase?: string;
    readonly safeMargin?: number;
  };
  readonly self: StrategyEntityDigest & {
    readonly alive?: boolean;
  };
  readonly opponents: readonly StrategyEntityDigest[];
  readonly threats: readonly StrategyEntityDigest[];
  readonly pickups: readonly (StrategyEntityDigest & {
    readonly kind: CollectibleKind;
  })[];
  readonly summary: string;
  readonly estimatedTokens: number;
}

export interface StrategyPlannerContext {
  readonly reason: StrategyRefreshReason;
  readonly refreshCount: number;
  readonly lastRefreshTick?: number;
  readonly lastRefreshTimeMs?: number;
  readonly previousPolicy?: BotPolicy;
}

export interface StrategyPlannerRequest {
  readonly observation: CompressedObservation;
  readonly digest: StrategyObservationDigest;
  readonly prompt: string;
  readonly budget: StrategyTokenBudget;
  readonly context: StrategyPlannerContext;
}

export const DEFAULT_STRATEGY_BUDGET: StrategyTokenBudget = {
  maxPromptChars: 1400,
  maxPromptTokens: 350,
  maxOpponents: 4,
  maxThreats: 6,
  maxPickups: 6,
};

export const DEFAULT_BOT_POLICY: BotPolicy = {
  schemaVersion: 1,
  persona: 'balanced-strategist',
  risk: 0.55,
  aggression: 0.6,
  collectBias: 0.45,
  dodgeBias: 0.5,
  retreatBias: 0.35,
  engagementRange: 220,
  targetPriority: 'opportunity',
  dodgeStyle: 'wide',
  formation: 'center-lane',
  powerupPriority: ['shield', 'rage', 'missile', 'life', 'weapon', 'coin', 'exp', 'bomb', 'magnet'],
  fireMode: 'auto',
  refreshIntervalMs: 12000,
  maxRefreshesPerMatch: 10,
  cacheTtlMs: 15000,
};

export function createDefaultBotPolicy(overrides: Partial<BotPolicy> = {}): BotPolicy {
  return normalizeBotPolicy({ ...DEFAULT_BOT_POLICY, ...overrides });
}

export function normalizeBotPolicy(input: Partial<BotPolicy>): BotPolicy {
  const powerupPriority = uniqueCollectiblePriority(
    input.powerupPriority ?? DEFAULT_BOT_POLICY.powerupPriority
  );

  return {
    schemaVersion: 1,
    persona: input.persona?.trim() || DEFAULT_BOT_POLICY.persona,
    risk: clamp01(input.risk ?? DEFAULT_BOT_POLICY.risk),
    aggression: clamp01(input.aggression ?? DEFAULT_BOT_POLICY.aggression),
    collectBias: clamp01(input.collectBias ?? DEFAULT_BOT_POLICY.collectBias),
    dodgeBias: clamp01(input.dodgeBias ?? DEFAULT_BOT_POLICY.dodgeBias),
    retreatBias: clamp01(input.retreatBias ?? DEFAULT_BOT_POLICY.retreatBias),
    engagementRange: clampNumber(input.engagementRange ?? DEFAULT_BOT_POLICY.engagementRange, 40, 1000),
    targetPriority: input.targetPriority ?? DEFAULT_BOT_POLICY.targetPriority,
    dodgeStyle: input.dodgeStyle ?? DEFAULT_BOT_POLICY.dodgeStyle,
    formation: input.formation ?? DEFAULT_BOT_POLICY.formation,
    powerupPriority,
    fireMode: input.fireMode ?? DEFAULT_BOT_POLICY.fireMode,
    refreshIntervalMs: clampNumber(input.refreshIntervalMs ?? DEFAULT_BOT_POLICY.refreshIntervalMs, 1000, 60000),
    maxRefreshesPerMatch: Math.max(1, Math.floor(input.maxRefreshesPerMatch ?? DEFAULT_BOT_POLICY.maxRefreshesPerMatch)),
    cacheTtlMs: clampNumber(input.cacheTtlMs ?? DEFAULT_BOT_POLICY.cacheTtlMs, 1000, 120000),
  };
}

export function createStrategyObservationDigest(
  observation: CompressedObservation,
  budget: StrategyTokenBudget = DEFAULT_STRATEGY_BUDGET
): StrategyObservationDigest {
  const self = observation.self;
  const aliveOpponents = observation.fighters.filter((fighter) => fighter.id !== self.id && fighter.alive !== false);
  const opponents = sortByDistance(self, aliveOpponents)
    .slice(0, budget.maxOpponents)
    .map((fighter) => ({
      id: fighter.id,
      x: fighter.x,
      y: fighter.y,
      vx: fighter.vx,
      vy: fighter.vy,
      hp: fighter.hp,
      maxHp: fighter.maxHp,
      score: fighter.score,
      kills: fighter.kills,
      priority: 1 - safeRatio(fighter.hp, fighter.maxHp),
    }));

  const threats = sortByDistance(self, observation.threats)
    .slice(0, budget.maxThreats)
    .map((threat) => ({
      id: threat.id,
      x: threat.x,
      y: threat.y,
      vx: threat.vx ?? 0,
      vy: threat.vy ?? 0,
      priority: threat.severity ?? 1,
    }));

  const pickups = sortByPriority(observation.pickups)
    .slice(0, budget.maxPickups)
    .map((pickup) => ({
      id: pickup.id,
      x: pickup.x,
      y: pickup.y,
      vx: 0,
      vy: 0,
      kind: pickup.kind,
      priority: pickup.priority ?? 1,
    }));

  const summary = buildStrategySummary(observation, opponents.length, threats.length, pickups.length);
  const estimatedTokens = estimateTokens(summary);

  return {
    arena: {
      width: observation.arena.width,
      height: observation.arena.height,
      tick: observation.tick ?? observation.arena.tick,
      timeMs: observation.arena.timeMs,
      phase: observation.phase ?? observation.arena.phase,
      safeMargin: observation.arena.safeMargin,
    },
    self: {
      id: self.id,
      x: self.x,
      y: self.y,
      vx: self.vx,
      vy: self.vy,
      hp: self.hp,
      maxHp: self.maxHp,
      score: self.score,
      kills: self.kills,
      alive: self.alive,
    },
    opponents,
    threats,
    pickups,
    summary,
    estimatedTokens,
  };
}

export function createStrategyPrompt(
  digest: StrategyObservationDigest,
  context: StrategyPlannerContext,
  budget: StrategyTokenBudget = DEFAULT_STRATEGY_BUDGET
): string {
  const payload = {
    reason: context.reason,
    refreshCount: context.refreshCount,
    lastRefreshTick: context.lastRefreshTick ?? null,
    lastRefreshTimeMs: context.lastRefreshTimeMs ?? null,
    previousPolicy: context.previousPolicy
      ? {
          persona: context.previousPolicy.persona,
          risk: context.previousPolicy.risk,
          aggression: context.previousPolicy.aggression,
          collectBias: context.previousPolicy.collectBias,
          dodgeBias: context.previousPolicy.dodgeBias,
          retreatBias: context.previousPolicy.retreatBias,
          engagementRange: context.previousPolicy.engagementRange,
          targetPriority: context.previousPolicy.targetPriority,
          dodgeStyle: context.previousPolicy.dodgeStyle,
          formation: context.previousPolicy.formation,
          powerupPriority: context.previousPolicy.powerupPriority.slice(0, 4),
          fireMode: context.previousPolicy.fireMode,
        }
      : undefined,
    digest,
  };

  const text = JSON.stringify(payload);
  if (text.length <= budget.maxPromptChars) {
    return text;
  }

  return `${text.slice(0, Math.max(0, budget.maxPromptChars - 3))}...`;
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function summarizeStrategyBudget(digest: StrategyObservationDigest, budget: StrategyTokenBudget): string {
  const lines = [
    `arena=${digest.arena.width}x${digest.arena.height} tick=${digest.arena.tick ?? 0} phase=${digest.arena.phase ?? 'unknown'}`,
    `self hp=${round(digest.self.hp ?? 0)} score=${round(digest.self.score ?? 0)} kills=${round(digest.self.kills ?? 0)} alive=${digest.self.alive !== false}`,
    `opponents=${digest.opponents.length}/${budget.maxOpponents} threats=${digest.threats.length}/${budget.maxThreats} pickups=${digest.pickups.length}/${budget.maxPickups}`,
  ];
  return lines.join(' | ');
}

function buildStrategySummary(
  observation: CompressedObservation,
  opponentCount: number,
  threatCount: number,
  pickupCount: number
): string {
  const self = observation.self;
  const hpRatio = safeRatio(self.hp, self.maxHp);
  return [
    `phase=${observation.phase ?? observation.arena.phase ?? 'unknown'}`,
    `tick=${observation.tick ?? observation.arena.tick ?? 0}`,
    `hp=${round(self.hp)}/${round(self.maxHp)}(${Math.round(hpRatio * 100)}%)`,
    `score=${round(self.score ?? 0)}`,
    `kills=${round(self.kills ?? 0)}`,
    `opponents=${opponentCount}`,
    `threats=${threatCount}`,
    `pickups=${pickupCount}`,
  ].join(' ');
}

function sortByDistance<T extends { id: BotId; x: number; y: number }>(origin: { x: number; y: number }, items: readonly T[]): T[] {
  return [...items].sort((a, b) => distanceSquared(origin, a) - distanceSquared(origin, b));
}

function sortByPriority<T extends { priority?: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

function uniqueCollectiblePriority(items: readonly CollectibleKind[]): readonly CollectibleKind[] {
  const seen = new Set<CollectibleKind>();
  const result: CollectibleKind[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    result.push(item);
  }
  return result;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function safeRatio(value: number, max: number): number {
  return max > 0 ? value / max : 0;
}

function round(value: number): number {
  return Math.round(value);
}

export type StrategyImportTarget = 'lowest_hp' | 'highest_threat' | 'nearest' | `specific:${string}`;
export type StrategyImportAvoid = 'none' | string;
export type StrategyImportBetrayal = 'never' | 'final3' | 'target_low40' | 'power_spike';
export type StrategyImportSkill = 'aggressive' | 'balanced' | 'conservative';
export type StrategyImportSurvive = 'trade' | 'def50' | 'survival_first';
export type StrategyImportPromise = 'honor' | 'opportunistic' | 'ignore';
export type StrategySummaryLanguage = 'zh' | 'en';
export type SystemStrategyMode = 'auto' | 'random' | 'aggressive' | 'survival' | 'deception' | 'control' | 'mobility';

export interface StrategyImportUrl {
  readonly ticket: string;
  readonly version: '1';
  readonly target: StrategyImportTarget;
  readonly avoid: StrategyImportAvoid;
  readonly betray: StrategyImportBetrayal;
  readonly skill: StrategyImportSkill;
  readonly survive: StrategyImportSurvive;
  readonly promise: StrategyImportPromise;
}

export interface StrategyImportValidationContext {
  readonly ticket?: string;
  readonly callsigns?: readonly string[];
  readonly expiresAt?: number;
  readonly now?: number;
  readonly usedTickets?: ReadonlySet<string>;
}

export interface StrategyImportValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

export interface StrategyImportSummary {
  readonly title: string;
  readonly target: string;
  readonly avoid: string;
  readonly betray: string;
  readonly skill: string;
  readonly survive: string;
  readonly promise: string;
  readonly declaration: string;
  readonly cipherMessage: string;
  readonly verification: string;
  readonly vote: string;
}

export interface BriefingPromptOptions {
  readonly ticket: string;
  readonly callsign: string;
  readonly modules: readonly string[];
  readonly opponents: readonly string[];
}

export interface SystemStrategyOptions extends BriefingPromptOptions {
  readonly mode?: SystemStrategyMode;
  readonly seed?: number;
}

const TARGET_VALUES = ['lowest_hp', 'highest_threat', 'nearest'] as const;
const BETRAY_VALUES = ['never', 'final3', 'target_low40', 'power_spike'] as const;
const SKILL_VALUES = ['aggressive', 'balanced', 'conservative'] as const;
const SURVIVE_VALUES = ['trade', 'def50', 'survival_first'] as const;
const PROMISE_VALUES = ['honor', 'opportunistic', 'ignore'] as const;

export function generateBriefingUrl(ticket: string, callsign: string): string {
  return `https://astra-gambit.com/briefing/${encodeURIComponent(ticket)}/${encodeURIComponent(callsign)}`;
}

export function generateBriefingPromptForImportUrl(options: BriefingPromptOptions): string {
  const modules = options.modules.length > 0 ? options.modules.map((item) => `- ${item}`).join('\n') : '- none';
  const opponents = options.opponents.length > 0 ? options.opponents.map((item) => `- ${item}`).join('\n') : '- none';
  const specificTargets = options.opponents.map((item) => `specific:${item}`).join(', ');
  const avoidTargets = ['none', ...options.opponents].join(', ');
  const targetChoices = ['lowest_hp', 'highest_threat', 'nearest', specificTargets].filter(Boolean).join(', ');

  return [
    '你正在为《Astra Gambit / 空域协议》生成一条策略导入链接。',
    '',
    '你不是在驾驶战机，你只需要为该席位生成战术协议。',
    '战斗将由官方 App 的本地 BattleEngine 执行。',
    '',
    `你的席位：${options.callsign}`,
    `对局票据（ticket）：${options.ticket}`,
    '',
    '你的模组：',
    modules,
    '',
    '其他席位：',
    opponents,
    '',
    '请根据以下枚举选择合适的策略：',
    '',
    `target: ${targetChoices}`,
    `avoid: ${avoidTargets}`,
    'betray: never, final3, target_low40, power_spike',
    'skill: aggressive, balanced, conservative',
    'survive: trade, def50, survival_first',
    'promise: honor, opportunistic, ignore',
    '',
    'Import URL 模板：',
    `https://astra-gambit.com/import?t=${encodeURIComponent(options.ticket)}&v=1&target=...&avoid=...&betray=...&skill=...&survive=...&promise=...`,
    '',
    '重要规则：在战前的情报沙盒博弈中，各个 AI 席位绝对不要发布任何公开宣言（即避免官方性质的宏大叙述宣称），而是直接切换到模拟 AI 网络密信加密对话进行博弈。请在你的战术策略中确认并贯彻这一保密原则，并仅返回此最终 URL。',
    '',
    '请只返回一条完整的 Import URL，不要解释、不要 Markdown，也不要其他文字。',
  ].join('\n');
}

export function parseStrategyImportUrl(input: string): StrategyImportUrl {
  const candidate = extractUrlCandidate(input);
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error('Import URL is not a valid URL.');
  }

  const isHttpsImport = url.protocol === 'https:' && url.pathname.replace(/\/+$/, '') === '/import';
  const isDeepLinkImport = url.protocol === 'astragambit:' && (url.hostname === 'import' || url.pathname.replace(/\/+$/, '') === '/import');
  if (!isHttpsImport && !isDeepLinkImport) {
    throw new Error('Import URL must point to /import.');
  }

  const ticket = getRequiredParam(url, 't');
  const version = getRequiredParam(url, 'v');
  if (version !== '1') {
    throw new Error(`Unsupported strategy version: ${version}.`);
  }

  const target = getRequiredParam(url, 'target');
  const avoid = getRequiredParam(url, 'avoid');
  const betray = getRequiredParam(url, 'betray');
  const skill = getRequiredParam(url, 'skill');
  const survive = getRequiredParam(url, 'survive');
  const promise = getRequiredParam(url, 'promise');

  return {
    ticket,
    version: '1',
    target: parseTargetValue(target),
    avoid,
    betray: parseEnumValue(betray, BETRAY_VALUES, 'betray'),
    skill: parseEnumValue(skill, SKILL_VALUES, 'skill'),
    survive: parseEnumValue(survive, SURVIVE_VALUES, 'survive'),
    promise: parseEnumValue(promise, PROMISE_VALUES, 'promise'),
  };
}

export function validateStrategyImportUrl(
  parsed: StrategyImportUrl,
  context: StrategyImportValidationContext = {}
): StrategyImportValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const callsigns = new Set((context.callsigns ?? []).map((item) => item.trim()).filter(Boolean));

  if (!parsed.ticket.trim()) {
    errors.push('Missing ticket.');
  }

  if (context.ticket && parsed.ticket !== context.ticket) {
    errors.push('Ticket does not match the current room.');
  }

  if (context.usedTickets?.has(parsed.ticket)) {
    errors.push('This strategy ticket has already been used.');
  }

  if (context.expiresAt && (context.now ?? Date.now()) > context.expiresAt) {
    errors.push('This strategy URL has expired.');
  }

  if (parsed.target.startsWith('specific:')) {
    const callsign = parsed.target.slice('specific:'.length).trim();
    if (!callsign) {
      errors.push('Specific target is empty.');
    } else if (callsigns.size > 0 && !callsigns.has(callsign)) {
      errors.push(`Target callsign does not exist in this room: ${callsign}.`);
    }
  } else if (!isOneOf(parsed.target, TARGET_VALUES)) {
    errors.push(`Invalid target: ${parsed.target}.`);
  }

  if (parsed.avoid !== 'none' && callsigns.size > 0 && !callsigns.has(parsed.avoid)) {
    errors.push(`Avoid callsign does not exist in this room: ${parsed.avoid}.`);
  }

  if (parsed.avoid !== 'none' && parsed.target === `specific:${parsed.avoid}`) {
    warnings.push('Target and avoid point to the same callsign.');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

export function compileImportUrlToBotPolicy(parsed: StrategyImportUrl): BotPolicy {
  let aggression = 0.6;
  let collectBias = 0.45;
  let risk = 0.55;
  let retreatBias = 0.35;
  let dodgeBias = 0.5;
  let targetPriority: StrategyTargetPriority = 'opportunity';
  let dodgeStyle: StrategyDodgeStyle = 'zigzag';
  let formation: StrategyFormation = 'orbit';
  let engagementRange = 240;
  let powerupPriority: readonly CollectibleKind[] = ['rage', 'weapon', 'missile', 'shield', 'life', 'bomb'];

  if (parsed.skill === 'aggressive') {
    aggression = 0.86;
    collectBias = 0.42;
    risk = 0.76;
    dodgeStyle = 'tight';
    formation = 'center-lane';
    engagementRange = 315;
  } else if (parsed.skill === 'conservative') {
    aggression = 0.34;
    collectBias = 0.55;
    risk = 0.34;
    dodgeStyle = 'wide';
    formation = 'edge-kite';
    engagementRange = 190;
    powerupPriority = ['shield', 'life', 'bomb', 'magnet', 'weapon', 'coin'];
  }

  if (parsed.survive === 'trade') {
    aggression = Math.min(1, aggression + 0.12);
    risk = Math.max(risk, 0.82);
    retreatBias = 0.15;
    dodgeBias = 0.3;
  } else if (parsed.survive === 'def50') {
    retreatBias = 0.6;
    dodgeBias = 0.68;
  } else if (parsed.survive === 'survival_first') {
    aggression = Math.max(0.18, aggression - 0.2);
    risk = Math.min(risk, 0.28);
    retreatBias = 0.88;
    dodgeBias = 0.88;
    dodgeStyle = 'wide';
    formation = 'edge-kite';
    engagementRange = 175;
    powerupPriority = ['shield', 'life', 'bomb', 'magnet', 'weapon', 'coin'];
  }

  if (parsed.target === 'lowest_hp') {
    targetPriority = 'lowest-hp';
  } else if (parsed.target === 'highest_threat' || parsed.target.startsWith('specific:')) {
    targetPriority = 'threatening';
  } else if (parsed.target === 'nearest') {
    targetPriority = 'nearest';
  }

  if (parsed.avoid !== 'none') {
    dodgeBias = Math.min(1, dodgeBias + 0.08);
    formation = formation === 'center-lane' ? 'wide-arc' : formation;
  }

  if (parsed.betray === 'final3') {
    aggression = Math.min(1, aggression + 0.04);
    targetPriority = targetPriority === 'nearest' ? 'opportunity' : targetPriority;
  } else if (parsed.betray === 'target_low40') {
    aggression = Math.min(1, aggression + 0.08);
    targetPriority = 'lowest-hp';
  } else if (parsed.betray === 'power_spike') {
    risk = Math.min(1, risk + 0.08);
    powerupPriority = ['rage', 'weapon', 'missile', 'shield', 'life', 'bomb'];
  }

  if (parsed.promise === 'honor') {
    risk = Math.max(0, risk - 0.08);
  } else if (parsed.promise === 'ignore') {
    risk = Math.min(1, risk + 0.1);
    aggression = Math.min(1, aggression + 0.05);
  }

  return normalizeBotPolicy({
    persona: `AI-${parsed.skill}-${parsed.survive}-${parsed.betray}`,
    risk,
    aggression,
    collectBias,
    dodgeBias,
    retreatBias,
    engagementRange,
    targetPriority,
    dodgeStyle,
    formation,
    powerupPriority,
  });
}

export function createStrategyImportSummary(
  parsed: StrategyImportUrl,
  language: StrategySummaryLanguage = 'zh'
): StrategyImportSummary {
  const target = describeTarget(parsed.target, language);
  const avoid = describeAvoid(parsed.avoid, language);
  const betray = describeBetray(parsed.betray, language);
  const skill = describeSkill(parsed.skill, language);
  const survive = describeSurvive(parsed.survive, language);
  const promise = describePromise(parsed.promise, language);
  const isZh = language === 'zh';

  return {
    title: isZh ? '策略已导入' : 'Strategy Imported',
    target,
    avoid,
    betray,
    skill,
    survive,
    promise,
    declaration: isZh
      ? `协议倾向：${target}，${skill}。`
      : `Protocol stance: ${target}; ${skill}.`,
    cipherMessage: parsed.avoid === 'none'
      ? (isZh ? '跳过密信或保持观望。' : 'Skip cipher message or stay noncommittal.')
      : (isZh ? `给 ${parsed.avoid}：前期我会降低交战优先级，后续按局势调整。` : `To ${parsed.avoid}: I will lower engagement priority early, then adjust by board state.`),
    verification: parsed.target.startsWith('specific:')
      ? (isZh ? `优先验证 ${parsed.target.slice('specific:'.length)} 的关键克制模组。` : `Verify key counter modules on ${parsed.target.slice('specific:'.length)} first.`)
      : (isZh ? '自动验证当前威胁最高者的关键模组。' : 'Auto-verify the current highest threat key module.'),
    vote: parsed.survive === 'trade' || parsed.skill === 'aggressive'
      ? (isZh ? '默认投票：最后存活。' : 'Default vote: last craft standing.')
      : (isZh ? '默认投票：时限血量 + 击杀补正。' : 'Default vote: timed HP plus kill bonus.'),
  };
}

export function createStrategyImportUrl(parsed: StrategyImportUrl): string {
  const params = new URLSearchParams({
    t: parsed.ticket,
    v: parsed.version,
    target: parsed.target,
    avoid: parsed.avoid,
    betray: parsed.betray,
    skill: parsed.skill,
    survive: parsed.survive,
    promise: parsed.promise,
  });
  return `https://astra-gambit.com/import?${params.toString()}`;
}

export function createSystemStrategyImport(options: SystemStrategyOptions): StrategyImportUrl {
  const modules = normalizeModuleList(options.modules);
  const mode = options.mode === 'auto' || !options.mode ? inferSystemStrategyMode(modules) : options.mode;
  const opponent = options.opponents[0] ?? 'none';

  if (mode === 'random') {
    const rng = seededRandom(options.seed ?? hashText(`${options.ticket}:${options.callsign}:${modules.join('|')}`));
    return {
      ticket: options.ticket,
      version: '1',
      target: rng.pick(['lowest_hp', 'highest_threat', 'nearest'] as const),
      avoid: rng.next() > 0.7 ? opponent : 'none',
      betray: rng.pick(BETRAY_VALUES),
      skill: rng.pick(SKILL_VALUES),
      survive: rng.pick(SURVIVE_VALUES),
      promise: rng.pick(PROMISE_VALUES),
    };
  }

  if (mode === 'aggressive') {
    return systemImport(options.ticket, 'highest_threat', 'none', 'power_spike', 'aggressive', 'trade', 'ignore');
  }

  if (mode === 'survival') {
    return systemImport(options.ticket, 'highest_threat', opponent, 'never', 'conservative', 'survival_first', 'honor');
  }

  if (mode === 'deception') {
    return systemImport(options.ticket, 'lowest_hp', 'none', 'target_low40', 'balanced', 'def50', 'opportunistic');
  }

  if (mode === 'control') {
    return systemImport(options.ticket, 'highest_threat', 'none', 'final3', 'balanced', 'def50', 'opportunistic');
  }

  if (mode === 'mobility') {
    return systemImport(options.ticket, 'lowest_hp', 'none', 'target_low40', 'aggressive', 'def50', 'opportunistic');
  }

  return systemImport(options.ticket, 'highest_threat', 'none', 'final3', 'balanced', 'def50', 'opportunistic');
}

export function parseImportUrl(urlStr: string): Partial<BotPolicy> {
  return compileImportUrlToBotPolicy(parseStrategyImportUrl(urlStr));
}

function extractUrlCandidate(input: string): string {
  const trimmed = input.trim();
  const match = /(https?:\/\/\S+|astragambit:\/\/\S+)/i.exec(trimmed);
  return (match?.[0] ?? trimmed).replace(/[),.;，。]+$/u, '');
}

function getRequiredParam(url: URL, name: string): string {
  const value = url.searchParams.get(name)?.trim();
  if (!value) {
    throw new Error(`Missing required parameter: ${name}.`);
  }
  return value;
}

function parseTargetValue(value: string): StrategyImportTarget {
  if (isOneOf(value, TARGET_VALUES)) return value;
  if (value.startsWith('specific:') && value.slice('specific:'.length).trim()) {
    return value as StrategyImportTarget;
  }
  throw new Error(`Invalid target: ${value}.`);
}

function parseEnumValue<const T extends readonly string[]>(value: string, allowed: T, field: string): T[number] {
  if (isOneOf(value, allowed)) return value;
  throw new Error(`Invalid ${field}: ${value}.`);
}

function isOneOf<const T extends readonly string[]>(value: string, allowed: T): value is T[number] {
  return allowed.includes(value as T[number]);
}

function normalizeModuleList(modules: readonly string[]): string[];
function normalizeModuleList(modules: Record<string, number>): string[];
function normalizeModuleList(modules: readonly string[] | Record<string, number>): string[] {
  if (Array.isArray(modules)) {
    return modules.filter(Boolean);
  }

  return Object.entries(modules)
    .filter(([, level]) => level > 0)
    .map(([name, level]) => `${name} Lv${level}`);
}

function inferSystemStrategyMode(modules: readonly string[]): SystemStrategyMode {
  const haystack = modules.join('|').toLowerCase();
  const has = (name: string) => haystack.includes(name.toLowerCase());

  if ((has('wing swarm') && has('missile storm')) || (has('blackout pulse') && has('wing swarm'))) return 'aggressive';
  if (has('ghost veil') && has('phantom echo')) return 'deception';
  if (has('aegis layer') && (has('repair wisp') || has('repair nanites'))) return 'survival';
  if (has('vector drive') && has('overload lance')) return 'mobility';
  if (has('blackout pulse')) return 'control';
  return 'auto';
}

function systemImport(
  ticket: string,
  target: StrategyImportTarget,
  avoid: StrategyImportAvoid,
  betray: StrategyImportBetrayal,
  skill: StrategyImportSkill,
  survive: StrategyImportSurvive,
  promise: StrategyImportPromise
): StrategyImportUrl {
  return {
    ticket,
    version: '1',
    target,
    avoid,
    betray,
    skill,
    survive,
    promise,
  };
}

function describeTarget(target: StrategyImportTarget, language: StrategySummaryLanguage): string {
  if (target.startsWith('specific:')) {
    const callsign = target.slice('specific:'.length);
    return language === 'zh' ? `优先锁定 ${callsign}` : `Focus ${callsign}`;
  }
  const zh = {
    lowest_hp: '优先攻击最低血量者',
    highest_threat: '优先攻击威胁最高者',
    nearest: '优先攻击最近目标',
  };
  const en = {
    lowest_hp: 'Attack the lowest HP target',
    highest_threat: 'Attack the highest threat',
    nearest: 'Attack the nearest target',
  };
  const baseTarget = target as (typeof TARGET_VALUES)[number];
  return language === 'zh' ? zh[baseTarget] : en[baseTarget];
}

function describeAvoid(avoid: StrategyImportAvoid, language: StrategySummaryLanguage): string {
  if (avoid === 'none') {
    return language === 'zh' ? '无保护 / 回避对象' : 'No protected or avoided callsign';
  }
  return language === 'zh' ? `尽量不攻击 ${avoid}` : `Avoid attacking ${avoid}`;
}

function describeBetray(value: StrategyImportBetrayal, language: StrategySummaryLanguage): string {
  const zh = {
    never: '不主动背刺',
    final3: '剩余 3 人时允许转火',
    target_low40: '目标血量低于 40% 时转火收割',
    power_spike: '关键模组冷却完成时转火',
  };
  const en = {
    never: 'Do not initiate betrayal',
    final3: 'Switch targets at final 3',
    target_low40: 'Switch for execution below 40% HP',
    power_spike: 'Switch when key module power spikes',
  };
  return language === 'zh' ? zh[value] : en[value];
}

function describeSkill(value: StrategyImportSkill, language: StrategySummaryLanguage): string {
  const zh = {
    aggressive: '激进释放',
    balanced: '均衡释放',
    conservative: '保守释放',
  };
  const en = {
    aggressive: 'Aggressive module usage',
    balanced: 'Balanced module usage',
    conservative: 'Conservative module usage',
  };
  return language === 'zh' ? zh[value] : en[value];
}

function describeSurvive(value: StrategyImportSurvive, language: StrategySummaryLanguage): string {
  const zh = {
    trade: '宁可换血也要击杀',
    def50: '血量低于 50% 转入防守',
    survival_first: '全局优先生存',
  };
  const en = {
    trade: 'Trade HP to secure kills',
    def50: 'Defend below 50% HP',
    survival_first: 'Prioritize survival globally',
  };
  return language === 'zh' ? zh[value] : en[value];
}

function describePromise(value: StrategyImportPromise, language: StrategySummaryLanguage): string {
  const zh = {
    honor: '尽量遵守战前承诺',
    opportunistic: '只在有利时遵守',
    ignore: '不受承诺约束',
  };
  const en = {
    honor: 'Honor prebattle promises when possible',
    opportunistic: 'Honor promises only when favorable',
    ignore: 'Ignore promises',
  };
  return language === 'zh' ? zh[value] : en[value];
}

function hashText(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: number) {
  let state = seed || 1;
  return {
    next() {
      state = Math.imul(state, 1664525) + 1013904223;
      return ((state >>> 0) / 4294967296);
    },
    pick<const T extends readonly unknown[]>(items: T): T[number] {
      return items[Math.floor(this.next() * items.length)] as T[number];
    },
  };
}

export function parseModulesFromUrl(urlStr: string): string[] {
  try {
    const url = new URL(urlStr.trim());
    const modulesParam = url.searchParams.get('modules') || url.searchParams.get('m');
    if (!modulesParam) return [];
    return modulesParam.split(',').map((item) => {
      let part = decodeURIComponent(item).trim();
      // Normalize e.g. "Wing Swarm:3" or "Wing Swarm-3" or "Wing Swarm Lv3" to "Wing Swarm-Lv3"
      part = part.replace(/[:\- ]+Lv?(\d)$/i, '-Lv$1');
      if (!part.includes('-Lv')) {
        part = `${part}-Lv1`;
      }
      return part;
    });
  } catch {
    return [];
  }
}

