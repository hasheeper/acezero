# AI 重构规划 — 三层架构 + 四档质变

> 目标：将当前 `poker-ai.js` 的硬规则 if-else 决策树，升级为 **效用函数 + 蒙特卡洛胜率 + 行为状态机** 三层架构。
> 使 noob / regular / pro / boss 四档 AI 在 1-3 手对局中产生**可感知的质变差异**。

---

## 一、现状分析

### 当前架构 (`core/poker-ai.js`, 1120 行)

```
PokerAI 类
├── 三维个性: riskAppetite × difficulty × emotion
├── 胜率评估: 查表 (HAND_STRENGTH_MAP) + 听牌加分 + 公共牌修正
├── 决策逻辑: if-else 瀑布 (decideWhenCheckedTo / decideWhenFacingBet)
├── 下注尺度: calculateRaiseAmount (牌力→底池百分比 × betSizeMultiplier)
└── SkillAI: 技能使用决策 (4属性 × 3难度) + 诅咒选目标
```

### 核心问题

| 问题 | 说明 |
|---|---|
| **难度区分靠调参** | noob/regular/pro 是同一套 if-else，只换 noiseRange/threshold，1-3 手内无法感知差异 |
| **胜率评估粗糙** | 查表映射 (Pair=45)，不区分顶对/底对，不看公共牌纹理完整性 |
| **无魔运感知** | AI 不知道自己开了大吉后胜率更高，不会利用魔运优势 |
| **下注尺度泄露统一** | 所有难度的下注大小都和牌力正相关，无法被"读" |
| **无对手建模** | 不追踪对手行为模式、mana 状态 |
| **无状态机** | 情绪是静态 delta，不会因局中事件自动转换 |
| **Boss 无特殊待遇** | 手牌纯随机，无保底机制，无阶段脚本 |

---

## 二、目标架构：三层

```
┌─────────────────────────────────────────────┐
│  第 3 层：行为状态机 (Behavior FSM)          │  ← 驱动权重动态变化
│  状态: 谨慎/狩猎/上头/被逼 + Boss 阶段脚本   │
├─────────────────────────────────────────────┤
│  第 1 层：效用函数 (Utility System)          │  ← 替代 if-else 决策
│  候选动作打分 → Softmax 加权随机选择          │
├─────────────────────────────────────────────┤
│  第 2 层：胜率评估 (Equity Estimator)        │  ← 替代查表
│  noob=查表 / regular+=蒙特卡洛 / pro+=魔运修正│
└─────────────────────────────────────────────┘
```

---

## 三、实施阶段

### Phase 1：蒙特卡洛胜率评估器

**文件**: `core/equity-estimator.js` (新建)

**目标**: 替代 `HAND_STRENGTH_MAP` 查表，提供精确到公共牌纹理的胜率评估。

**核心 API**:
```js
EquityEstimator.estimate(holeCards, boardCards, numOpponents, simCount)
// → { equity: 0.38, confidence: 'high' }

EquityEstimator.estimateWithMagic(holeCards, boardCards, numOpponents, netForcePower)
// → { physicalEquity: 0.38, perceivedEquity: 0.52 }  // pro/boss 专用
```

**实现要点**:
- 200 次随机模拟，随机补完公共牌 + 随机分配对手手牌
- 用 pokersolver (`Hand.solve`) 判定胜负
- 浏览器 JS 中 200 次模拟 <5ms，完全可行
- noob 不调用此函数，继续用查表（模拟"只看自己牌"）
- pro/boss 额外加魔运修正：`perceivedEquity = physicalEquity + netForce × 0.005`

**与现有代码的关系**:
- `calculateRawStrength()` 保留给 noob 使用
- regular+ 的 `rawStrength` 改为调用 `EquityEstimator.estimate()` 返回的 equity × 100
- `SkillAI._getHandStrength()` 同步升级

**预估工作量**: ~150 行新代码

---

### Phase 2：效用函数决策系统

**文件**: `core/poker-ai.js` 重构核心

**目标**: 替代 `decideWhenCheckedTo` / `decideWhenFacingBet` 的 if-else 瀑布。

**核心设计**:

```js
// 候选动作列表
const CANDIDATES = [
  { action: 'fold' },
  { action: 'check' },
  { action: 'call' },
  { action: 'raise', sizing: 'small' },   // 33% pot
  { action: 'raise', sizing: 'medium' },  // 66% pot
  { action: 'raise', sizing: 'large' },   // 100% pot
  { action: 'raise', sizing: 'allin' }
];

// 每个候选动作的效用分
utility = weights.hand    × handScore(equity, action)
        + weights.potOdds × potOddsScore(equity, potOdds, action)
        + weights.position× positionScore(seatPosition, action)
        + weights.opponent× opponentScore(opponentModel, action)
        + weights.magic   × magicScore(manaState, forceBalance, action)
        + weights.aggro   × aggroScore(action)

// Softmax 选择（温度控制理性程度）
selectedAction = softmax(utilities, temperature)
```

**四档权重向量**:

```
             手牌  赔率  位置  对手  魔运  攻击
noob:       [0.70  0.05  0.00  0.00  0.05  0.20]
regular:    [0.40  0.20  0.10  0.00  0.15  0.15]
pro:        [0.20  0.15  0.10  0.15  0.30  0.10]
boss:       [0.15  0.10  0.05  0.10  0.35  0.25]
```

**Softmax 温度**:
- noob: 2.0（接近随机，经常犯蠢）
- regular: 1.0（标准理性）
- pro: 0.5（高度理性）
- boss: 0.3（几乎总选最优）

**六个评分函数**:

| 函数 | 输入 | 逻辑 |
|---|---|---|
| `handScore` | equity, action | fold 时 = 0, call/raise 时 = equity 的函数 |
| `potOddsScore` | equity, potOdds, action | call 时 = equity - potOdds (正=有利), fold 时 = 0 |
| `positionScore` | position, action | 后位 raise 加分, 前位 raise 减分 |
| `opponentScore` | model, action | 对手弱/mana低 → raise 加分 (pro+ 专用) |
| `magicScore` | forces, mana, action | 己方魔运优势 → raise 加分, 劣势 → fold 加分 |
| `aggroScore` | action | raise/allin 固定加分 (体现攻击倾向) |

**与现有代码的关系**:
- `decide()` 入口保留，内部从调用 `makeDecision()` 改为调用 `utilityDecide()`
- `RISK_PROFILES` / `DIFFICULTY_PROFILES` 逐步废弃，被权重向量取代
- `calculateRaiseAmount()` 保留但简化（效用函数已选定 sizing）
- 日志格式升级：输出每个候选动作的效用分 + 最终选择

**预估工作量**: ~300 行重构

---

### Phase 3：下注尺度分档

**文件**: `core/poker-ai.js` 内 `calculateRaiseAmount()` 重构

**目标**: 不同难度的下注尺度模式不同，成为玩家"读 NPC"的线索。

| 难度 | 模式 | 说明 |
|---|---|---|
| **noob** | 二极化 | min-raise 或 all-in，50/50，没有中间值 |
| **regular** | 线性泄露 | 强牌大注弱牌小注 — 高度泄露信息，可被读 |
| **pro** | 固定比例 | 60-75% pot，不管牌力 — 不泄露 |
| **boss** | 反向欺骗 | 20% 概率反向（强牌小注引诱，弱牌大注恐吓） |

**实现**:
```js
// noob: 二极化
if (difficulty === 'noob') {
  return Math.random() < 0.5 ? minRaise : stack;
}
// regular: 牌力正相关（泄露线索）
if (difficulty === 'regular') {
  return pot * (0.3 + equity * 0.7);  // equity 0.3→30%pot, 0.8→86%pot
}
// pro: 固定比例
if (difficulty === 'pro') {
  return pot * (0.6 + Math.random() * 0.15);
}
// boss: 反向欺骗
if (difficulty === 'boss') {
  const invert = Math.random() < 0.2;
  const base = invert ? (1 - equity) : equity;
  return pot * (0.4 + base * 0.6);
}
```

**预估工作量**: ~50 行

---

### Phase 4：行为状态机

**文件**: `core/poker-ai.js` 内新增 `BehaviorFSM` 类

**目标**: 情绪不再是静态 delta，而是由局中事件自动驱动的状态转移。

**四个状态**:

```
CAUTIOUS（谨慎）  ←→  HUNTING（狩猎）
     ↓                    ↓
CORNERED（被逼）  ←→  TILTED（上头）
```

**状态转移触发器**:

| 事件 | 转移 | 持续 |
|---|---|---|
| 赢大锅 (pot > 10×BB) | → HUNTING | 直到下次输 |
| 被 Bad Beat (翻前领先但输) | → TILTED | noob: 5手, regular: 3手, pro: 1手 |
| 筹码 < 30% 起始值 | → CORNERED | 直到筹码恢复 |
| 连续弃牌 3 手 | CAUTIOUS → HUNTING | 1手 |
| 赢回筹码 > 50% | CORNERED → CAUTIOUS | — |

**状态对效用权重的修正**:

| 状态 | 攻击权重 delta | 温度 delta | 特殊 |
|---|---|---|---|
| CAUTIOUS | 0 | 0 | 基准 |
| HUNTING | +0.15 | -0.1 | 更激进更理性 |
| TILTED | +0.35 | +0.8 | 疯狂但混乱 |
| CORNERED | +0.25 | +0.3 | 孤注一掷 |

**不同难度的状态机差异**:
- noob: 只有 2 态 (CAUTIOUS / TILTED)，上头持续 5 手
- regular: 4 态，上头持续 3 手
- pro: 4 态，上头仅 1 手（心理素质强）
- boss: 不用通用状态机，用阶段脚本（见 Phase 6）

**与现有代码的关系**:
- 替代当前 `EMOTION_PROFILES` 的静态 delta 系统
- `setEmotion()` 改为 `fsm.transition(event)`
- 状态机输出的权重修正叠加到效用函数的权重向量上
- `texas-holdem.js` 在 `determineWinner` / `endHandEarly` 后调用 `player.ai.fsm.onEvent()`

**预估工作量**: ~200 行

---

### Phase 5：Boss 手牌保底

**文件**: `texas-holdem.js` 的 `dealHoleCards()` + `core/poker-ai.js` 的 `evaluatePreflopStrength()`

**目标**: Boss 级 NPC 的起手牌有强度下限，解决"1-3 手靠运气"的核心问题。

**机制**:
```
发手牌时:
  普通 NPC → 正常随机 (deck.deal())
  pro NPC  → 随机发牌，preflopStrength < 30 则重发（最多 3 次）
  boss NPC → 随机发牌，preflopStrength < 45 则重发（最多 5 次）
  boss 狂暴 → preflopStrength < 60（几乎总是强牌）
```

**实现要点**:
- `dealHoleCards()` 中检测玩家的 `personality.difficulty`
- 重发逻辑：把不合格的牌放回牌堆，重新洗牌区域，再抽
- 或更简单：预抽 N 组手牌，选 preflopStrength 最高的
- 保底阈值可通过 `game-config.json` 的 NPC 配置覆盖

**game-config 扩展**:
```json
{
  "personality": {
    "riskAppetite": "aggressive",
    "difficulty": "boss",
    "holeCardFloor": 45
  }
}
```

**预估工作量**: ~60 行

---

### Phase 6：Boss 阶段脚本

**文件**: `core/poker-ai.js` 内新增 `BossScript` 系统

**目标**: Boss 不用通用状态机，而是按筹码阶段执行预设脚本。

**三阶段模型**:

| 阶段 | 触发 | 行为 |
|---|---|---|
| **从容** | 筹码 > 70% | 像 pro 一样精准，偶尔施压 |
| **认真** | 筹码 30-70% | 加大魔运投入，攻击权重 +0.15 |
| **狂暴** | 筹码 < 30% | 高频 T1/T2 技能，温度降到 0.1，手牌保底提升到 60 |

**弱点系统**:
```json
{
  "personality": {
    "difficulty": "boss",
    "weakness": {
      "trigger": "psyche_counter",
      "effect": "tilt",
      "duration": 2,
      "description": "被灵视反制后陷入动摇"
    }
  }
}
```

- 弱点触发后，Boss 进入 2 手的 TILTED 状态
- 温度暴涨到 2.0，魔运权重暴跌
- 玩家发现并利用弱点 = 击败 Boss 的关键

**与 SkillAI 的联动**:
- Boss 狂暴阶段：`shouldUseSkill` 概率全面提升
- Boss 认真阶段：mana 管理更精细，优先高阶技能
- Boss 弱点触发：2 手内技能使用混乱（模拟 tilt）

**预估工作量**: ~150 行

---

### Phase 7：对手建模 (pro/boss 专用)

**文件**: `core/poker-ai.js` 内新增 `OpponentModel` 类

**目标**: pro/boss 级 AI 能追踪对手行为模式，做出针对性调整。

**追踪数据**:
```js
{
  vpip: 0.65,        // 入池率 (Voluntarily Put $ In Pot)
  pfr: 0.30,         // 翻前加注率
  aggFreq: 0.45,     // 攻击频率
  foldToBet: 0.40,   // 面对下注的弃牌率
  manaPercent: 0.35,  // 当前 mana 百分比
  lastAction: 'raise', // 上一个动作
  handsPlayed: 5      // 已打手数
}
```

**对 opponentScore 的影响**:
- 对手 `foldToBet` 高 → raise 效用加分（容易被吓跑）
- 对手 `manaPercent` 低 → raise 效用加分（没魔运反制）
- 对手 `aggFreq` 高 → call 效用加分（让他自己犯错）

**注意**: 1-3 手对局中数据极少，所以对手建模的权重本身就不高 (pro: 0.15, boss: 0.10)。这是故意的——它更多是一个"感觉 AI 在观察你"的叙事工具，而非真正的数据驱动决策。

**预估工作量**: ~100 行

---

## 四、文件变更总览

| 文件 | 变更类型 | Phase | 说明 |
|---|---|---|---|
| `core/equity-estimator.js` | **新建** | 1 | 蒙特卡洛胜率评估器 |
| `core/poker-ai.js` | **重构** | 2,3,4,6,7 | 效用函数 + 状态机 + Boss 脚本 + 对手建模 |
| `texas-holdem.js` | **修改** | 4,5 | dealHoleCards 保底 + 状态机事件触发 |
| `texas-holdem.html` | **修改** | 1 | 加载 equity-estimator.js |
| `game-config.json` | **扩展** | 5,6 | holeCardFloor + weakness 字段 |
| `ST/acezero-tavern-plugin.js` | **修改** | 5,6 | NPC 组装支持 boss 难度 + 手牌保底 + 弱点 |

### HTML 加载顺序更新

```
deck.js → pokersolver.js → equity-estimator.js [NEW]
→ poker-ai.js → game-logger.js → skill-system.js
→ attribute-system.js → switch-system.js → combat-formula.js
→ survival-economy.js → monte-of-zero.js → skill-ui.js
→ texas-holdem.js
```

---

## 五、实施优先级

```
Phase 1 (蒙特卡洛)  ████████░░  优先级: 高   — 基础设施，后续都依赖精确胜率
Phase 2 (效用函数)   ██████████  优先级: 最高 — 核心重构，四档质变的基础
Phase 3 (下注尺度)   ████░░░░░░  优先级: 中   — 小改动大效果，可与 Phase 2 同步
Phase 5 (手牌保底)   ██████░░░░  优先级: 高   — Boss 压迫感的关键来源
Phase 4 (状态机)     ██████░░░░  优先级: 中   — 丰富体验但非必须
Phase 6 (Boss 脚本)  ████░░░░░░  优先级: 中低 — 依赖 Phase 4
Phase 7 (对手建模)   ███░░░░░░░  优先级: 低   — 1-3 手内效果有限，叙事价值 > 实际价值
```

**推荐实施顺序**: 1 → 2+3 → 5 → 4 → 6 → 7

---

## 六、四档质变验证标准

每个 Phase 完成后，用以下场景验证：

### noob 验证
- [ ] 公共牌 A K J，手持 QQ，noob 仍然大注/全押（不看公共牌）
- [ ] 下注尺度只有 min-raise 和 all-in 两种
- [ ] 偶尔弃掉好牌（AKs 弃了）
- [ ] 有技能就用，preflop 浪费大吉

### regular 验证
- [ ] 不犯 noob 的结构性错误
- [ ] 下注大小和牌力明显正相关（可被读）
- [ ] 底池大时用技能，底池小时省 mana
- [ ] 不会读对手行为

### pro 验证
- [ ] 下注尺度固定 60-75% pot，不泄露信息
- [ ] 开了大吉后更敢下注（魔运感知胜率）
- [ ] 对手 mana 低时更积极施压
- [ ] 偶尔慢打强牌（设陷阱）
- [ ] mana 跨手规划（第 1 手省着用）

### boss 验证
- [ ] 起手牌永远中等以上（不会拿到 72o）
- [ ] 筹码不同阶段行为明显不同
- [ ] 被特定技能反制后进入动摇状态
- [ ] 20% 概率反向下注（强牌小注，弱牌大注）

---

## 七、兼容性保障

1. **渐进式重构**: 每个 Phase 独立可用，不需要全部完成才能运行
2. **回退机制**: 效用函数系统保留 `decide()` 入口签名不变，`texas-holdem.js` 无需改动调用方式
3. **SkillAI 不变**: Phase 2 只重构德扑决策部分，`SkillAI` 的技能决策逻辑保持独立
4. **ST 插件兼容**: `game-config.json` 新字段都是可选的，旧配置照常工作
5. **日志升级**: 效用函数的日志比 if-else 更丰富（每个候选动作的分数），便于调试

---

## 八、风险与注意事项

| 风险 | 缓解 |
|---|---|
| 蒙特卡洛性能 | 200 次模拟 <5ms，但多人桌 4 个 AI 同时算 = 20ms，仍可接受 |
| 效用函数调参 | 权重向量需要大量测试，建议先用极端值验证方向正确 |
| Boss 手牌保底被感知为"作弊" | 这是设计意图，但需要在叙事上合理化（"Boss 的魔运让他总能摸到好牌"） |
| 状态机过于复杂 | 先实现 2 态 (CAUTIOUS/TILTED)，验证后再扩展到 4 态 |
| 对手建模数据不足 | 权重本身就低 (0.10-0.15)，数据不足时自动退化为无建模 |
