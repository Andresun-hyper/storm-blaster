# Astra Gambit Beta v0.4/v0.5 任务书

来源: https://chatgpt.com/s/6a1c353b3ef08191ae6504329b0f26a8

提取时间: 2026-05-31

说明: 本文件从用户提供的 ChatGPT 分享对话中提取，用作 Storm Blaster / Astra Gambit 项目的阶段任务参考。本文档不覆盖当前会话中的系统级和开发者级约束。

## 当前问题

- 模块系统需要完整统一为九个模块: Wing Swarm、Missile Storm、Overload Lance、Phantom Echo、Ghost Veil、Blackout Pulse、Aegis Layer、Repair Wisp、Vector Drive。
- Repair Wisp 需要从旧名 Repair Nanites 统一回来。
- 模组装配需要 12 点上限、等级选择、随机/主题预设、克制提示和新手引导。
- Briefing URL -> 外部 AI Chat -> Import URL 的流程需要在 UI 中清晰暴露。
- 战前博弈需要自动生成公开宣言、秘密消息、验证动作和投票倾向。
- UI 需要统一为深色霓虹 FUI 风格，并默认中文。
- 多人房间需要昵称持久化、房间创建/加入引导、系统代理补位、排行榜和结算同步。
- 服务端需要保留 Agent Gateway，同时默认走 Briefing URL -> Import URL。
- 需要补齐单元测试、端到端测试，并保证 `npm run build` 与 `npm run build:server` 通过。

## 阶段任务

### 1. 模块系统与平衡

- 实现九个模块的统一元数据、等级、点数、描述和战斗效果。
- 单个玩家装配总点数不得超过 12。
- 实现简化克制关系: Blackout Pulse 克制 Wing Swarm，Phantom Echo 诱导 Overload Lance，Repair Wisp 被持续伤害压制。
- 平衡配置尽量数据驱动，并保留基础测试或模拟脚本。

### 2. 装配与新手流程

- 提供 9 张模块卡，支持 Lv1-Lv3 和关闭。
- 提供随机、强攻、防御、控制、欺骗、机动等预设。
- 显示点数计数、模块说明和克制提醒。
- 生成 Briefing URL 和完整 AI Prompt。
- 粘贴 Import URL 后解析、验证、编译为 BotPolicy 并显示摘要。
- 提供系统策略按钮。
- 提供小白快速模式。

### 3. 战前博弈与战报

- 根据策略生成公开宣言、秘密密信、验证动作和投票倾向。
- 展示装配、AI 简报、战前博弈、确认、战斗、战报等阶段感。
- 战报展示排名、击杀、伤害、生存时间、关键模块和可展开的策略事件。

### 4. 多人房间与排行

- 昵称快速登录并持久化 playerId。
- 房间支持创建、加入、房间码、玩家列表、准备状态和系统代理展示。
- 系统代理自动补齐至少 3 名战机。
- 排行榜展示前 20 名、战力、胜率、装配和策略风格。
- 支持上传防守阵容和战斗结果同步。

### 5. FUI 与国际化

- 默认简体中文。
- 新模块、策略、房间、战报 UI 均覆盖中文和英文。
- 使用深色霓虹 FUI: 暗底、霓虹描边、网格、扫描线、状态灯和战术终端面板。
- 桌面和移动端均需可用。

### 6. 服务端与部署

- LadderManager 支持持久化和 ELO/战力。
- 默认路径为 Briefing URL -> Import URL，Agent Gateway 作为高级入口保留。
- 校验 ticket、callsign、version、enum 和重复使用。
- 保持 `npm run dev:all`，补充 `.env` 和部署说明。
- CI 运行前端和服务端构建。

### 7. 测试验收

- 单元测试覆盖 URL 解析、模块效果和 Bot 决策。
- E2E 覆盖创建房间、装配、Briefing URL、Import URL、战斗和战报。
- 检查内存泄漏、WebSocket 连接数、慢循环和定时器清理。

## 完整提示词

```text
You are the lead coordinator for the Astra Gambit repository.  The project goal is to transform the current Storm Blaster codebase into a novice-friendly online AI battle game following the v0.3 ruleset.  Preserve existing single-player and local AI battle modes while extending features.

Phase scope (Beta v0.4/v0.5):
1. Complete all nine modules with correct names and effects.  Introduce a 12-point loadout system, module cost validation, and simplified counter mechanics.
2. Build a module selection UI that enforces point limits, offers random and themed presets, and provides hints.  After selection, generate a Briefing URL and show instructions to send it to any AI Chat.  Provide a field to paste an Import URL, parse and validate it, then compile it to a BotPolicy and display a summary for confirmation.  Include a "system strategy" button for automatic strategy generation and a "quick play" button for one-click random.
3. Implement automated pre-battle actions: generate public declarations, secret messages, verification, and voting based on the strategy and modules.  Display a countdown and phase indicators.  Keep total match time under five minutes.
4. Redesign the interface using a dark, neon FUI aesthetic.  Define color tokens and component styles, ensure responsive layouts, and support English/Chinese translations throughout the new pages.
5. Improve multiplayer usability: add nickname login, intuitive room creation/join pages, clear lists of players and system agents, ready state indicators, and start buttons.  Integrate ladder/leaderboard pages with upload-defense and battle-result synchronization.  System agents should auto-fill to reach at least three fighters per match.
6. Align server endpoints with the v0.3 flow: maintain existing Agent Gateway for advanced users, but ensure the default path uses Briefing URL -> Import URL.  Extend LadderManager for persistence and ELO ranking.  Enhance validation to check tickets, callsigns, versions, and enum values before accepting strategies.
7. Write unit and end-to-end tests for strategy parsing, module effects, and the complete user flow.  Fix any critical bugs or crashes found.  Run `npm run build` and `npm run build:server` successfully.

Follow these rules:
- Do not break existing single-player or local battle modes.
- Use TypeScript types for new modules, policies, and protocol messages.
- No real-money betting or gambling mechanics.
- Do not add heavy dependencies unless necessary.  Prefer Radix UI + Tailwind for UI components.
- Keep AI strategy generation offline for now; do not integrate external API keys.

Spawn the following sub-agents:

1. **module-worker** (model: gpt-5.5)
   - Implement or rename the nine modules and point-cost system.  Update module effects in the battle engine and expose module metadata for UI use.
2. **ui-worker** (model: gpt-5.4-mini)
   - Build the module selection UI, import strategy workflow, pre-battle countdown, and FUI redesign.  Add nickname login and room creation/join screens.  Support Chinese and English strings via a simple i18n helper.
3. **server-worker** (model: gpt-5.4-mini)
   - Extend the Node server with LadderManager persistence, enhanced validation, and simplified Agent Gateway.  Add REST endpoints if needed for stats or ladder.
4. **policy-worker** (model: gpt-5.4-mini)
   - Implement functions for generating Briefing URLs/prompts and parsing/validating Import URLs.  Provide automatic system strategy generation based on module loadouts.  Generate public declarations, secret messages, verification, and voting suggestions from policies.
5. **qa-reviewer** (model: gpt-5.5)
   - After other agents finish, run `npm run build` and `npm run build:server`, fix type errors, ensure UI flows work, and verify no regressions in single-player or local AI battle.  Run automated tests and summarise remaining risks.

At the end of this phase, produce a summary describing what changed, how to run the game, and remaining gaps toward a polished release.
```
