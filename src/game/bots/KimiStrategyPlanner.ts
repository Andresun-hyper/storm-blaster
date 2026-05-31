import type { BotPolicy, StrategyPlannerRequest } from './policy';
import { DEFAULT_STRATEGY_BUDGET, createDefaultBotPolicy } from './policy';
import type { StrategyPlanner } from './StrategyPlanner';

export interface KimiStrategyPlannerOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly basePolicy?: Partial<BotPolicy>;
}

export class KimiStrategyPlanner implements StrategyPlanner {
  readonly kind = 'kimi-strategy-planner';
  readonly name = 'KimiStrategyPlanner';
  readonly tokenBudget = DEFAULT_STRATEGY_BUDGET;

  private apiKey: string;
  private model: string;
  private currentPolicy: BotPolicy;
  private isPlanning = false;
  private lastPlannedTick = -9999;

  constructor(options: KimiStrategyPlannerOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? 'moonshot-v1-8k';
    this.currentPolicy = createDefaultBotPolicy(options.basePolicy);
  }

  planStrategy(request: StrategyPlannerRequest): BotPolicy {
    if (!this.apiKey) {
      return this.currentPolicy;
    }

    const tick = request.observation.tick ?? request.observation.arena.tick ?? 0;
    
    // Non-blocking revalidation at low frequency (min 10 seconds / 600 ticks between updates)
    if (!this.isPlanning && (this.lastPlannedTick === -9999 || tick - this.lastPlannedTick > 600)) {
      this.isPlanning = true;
      this.lastPlannedTick = tick;
      
      this.planStrategyAsync(request.prompt)
        .then((newPolicy) => {
          if (newPolicy) {
            this.currentPolicy = newPolicy;
            console.log(`[KimiStrategyPlanner] Strategy successfully updated via Kimi:`, this.currentPolicy);
          }
        })
        .catch((err) => {
          console.error('[KimiStrategyPlanner] Dynamic strategy revalidation failed:', err);
        })
        .finally(() => {
          this.isPlanning = false;
        });
    }

    return this.currentPolicy;
  }

  private async planStrategyAsync(prompt: string): Promise<BotPolicy | null> {
    try {
      const response = await fetch('https://api.moonshot.cn/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: 'system',
              content: 'You are an advanced AI combat strategist for Astra Gambit. Your job is to output a tactical import URL based on the state. Analyze the state and choose the best strategy. Keep your response extremely brief, outputting ONLY the final Import URL, for example: https://astra-gambit.com/import?t=R7K2Q9&v=1&target=lowest_hp&avoid=none&betray=target_low40&skill=balanced&survive=def50&promise=opportunistic',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0,
        }),
      });

      if (!response.ok) {
        console.error('[KimiStrategyPlanner] Kimi API response error:', response.status, response.statusText);
        return null;
      }

      const data = await response.json();
      const content = (data.choices?.[0]?.message?.content ?? '').trim();
      
      // Extract import URL
      const match = /(https?:\/\/\S+)/i.exec(content);
      if (match && match[0]) {
        const url = match[0].trim().replace(/[),.;，。]+$/u, '');
        const { parseStrategyImportUrl, compileImportUrlToBotPolicy } = await import('./policy');
        const parsed = parseStrategyImportUrl(url);
        return compileImportUrlToBotPolicy(parsed);
      }
    } catch (e) {
      console.error('[KimiStrategyPlanner] Fetch or parsing failed:', e);
    }
    return null;
  }
}

export function createKimiStrategyPlanner(options: KimiStrategyPlannerOptions): KimiStrategyPlanner {
  return new KimiStrategyPlanner(options);
}
