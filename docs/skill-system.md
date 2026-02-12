# 零之王牌 — 技能系统 v4

## 核心概念：引擎如何选牌

这不是一个随机扑克游戏。**Monte of Zero 引擎**在每次发牌时：

1. **枚举所有可能的牌**（牌堆中每张牌 = 一个「平行宇宙」）
2. **为每个宇宙打分**（命运分 = 所有「力」的加权叠加）
3. **选择命运分最高的牌**发出

技能的本质 = 向引擎注入「力」（Force），改变打分公式，从而改变哪张牌被选中。

---

## Fortune（天命力）如何工作

当你使用「大吉」（power=30）时：

```
对牌堆中每张候选牌 X：
  模拟 X 发出后的牌局 → 计算你的胜率 winRate (0~1)
  fortune 贡献 = power × winRate = 30 × winRate
  
  如果 X 让你胜率 80%：贡献 = 30 × 0.8 = 24
  如果 X 让你胜率 20%：贡献 = 30 × 0.2 = 6
```

**结果：引擎倾向于选择让你胜率高的牌。** power 越大，这个倾向越强。

## Curse（诅咒力）如何工作

当敌人使用「大凶」（power=30, target=你）时：

```
对牌堆中每张候选牌 X：
  模拟 X 发出后的牌局 → 计算你的败率 loseRate = 1 - winRate
  curse 贡献 = power × loseRate = 30 × loseRate
  
  如果 X 让你胜率 80%（败率 20%）：贡献 = 30 × 0.2 = 6
  如果 X 让你胜率 20%（败率 80%）：贡献 = 30 × 0.8 = 24
```

**结果：引擎倾向于选择让你输的牌。** 和 fortune 完全相反。

## Fortune + Curse 同时存在

```
你使用大吉 (fortune power=30)
敌人使用大凶 (curse power=30, target=你)

候选牌 X（你胜率 70%）：
  fortune 贡献 = 30 × 0.7 = 21  （想选这张）
  curse 贡献   = 30 × 0.3 = 9   （也想选这张，因为你输的概率低 → curse 贡献低）
  
候选牌 Y（你胜率 30%）：
  fortune 贡献 = 30 × 0.3 = 9   （不想选）
  curse 贡献   = 30 × 0.7 = 21  （想选这张，因为你输的概率高）

牌 X 总分 = 21 + 9 = 30
牌 Y 总分 = 9 + 21 = 30  ← 打平！
```

**当 fortune 和 curse 力量相等且目标相同时，互相抵消 → 回归随机。**
但如果你的 fortune power > 敌人的 curse power，你就占优。

---

## 四属性

| 属性 | 英文 | 定位 |
|------|------|------|
| **天命** | Moirai | 顺流·强运 — 让自己拿好牌 |
| **狂厄** | Chaos | 乱流·凶 — 让敌人拿烂牌 |
| **灵视** | Psyche | 观察·逆转 — 情报 + 拦截 Chaos |
| **虚无** | Void | 消除·减伤 — 削弱/清除所有魔法 |

### 克制环

```
Psyche (灵视) > Chaos (狂厄) > Moirai (天命) > Psyche (灵视)
Void 不参与克制，纯消除
```

**T1 对决：** 克制方获得 **1.5x** 力量加成。

**克制机制：**

| 克制关系 | 机制 | 效果 |
|----------|------|------|
| **Psyche > Chaos** | 解析混沌 | Psyche 技能拦截并转化敌方 Curse（澄澈=消除，折射=50%转化，真理=100%转化） |
| **Chaos > Moirai** | 凶克吉 | curse 对抗 fortune 时获得 **+10%** 力量加成 |
| **Moirai > Psyche** | 反制空放 | 敌方无 Chaos 时反制效果空放，但信息效果（胜率/透视）仍触发 |

---

## 全部 12 技能

### 天命 (Moirai) — 强运系

| 技能 | 阶级 | Mana | CD | Power | 效果 |
|------|------|------|----|-------|------|
| **小吉** `minor_wish` | T3 | 10 | 0 | 15 | 轻微偏斜：引擎稍微倾向对你有利的牌 |
| **大吉** `grand_wish` | T2 | 20 | 0 | 30 | 强运：引擎明显倾向对你有利的牌 |
| **天命** `divine_order` | T1 | 40 | 3 | 50 | 绝对既定：最强幸运力 + 压制同属性 T2/T3 |

### 狂厄 (Chaos) — 凶系

**单体指向**: Curse 针对一个目标生效。目标选择由 `PokerAI.SkillAI.pickCurseTarget` 决定，按 difficulty 分层：

| Difficulty | 策略 | 逻辑 |
|-----------|------|------|
| noob | **Nemesis** (死磕) | 锁定主角(id=0)，主角弃牌才随机选 |
| regular | **Pot Commitment** (沉没成本) | 诅咒投入底池最多的对手（不会弃牌，收益最大） |
| pro | **Threat Assessment** (威胁评估) | 综合下注量×0.7 + 筹码量×0.3 评估威胁度 |

架构：`skill-system.js` 通过 `curseTargetFn` 回调委托给 `poker-ai.js`，零耦合。

引擎根据 `force.targetId` 计算目标的败率来打分。

| 技能 | 阶级 | Mana | CD | Power | 效果 |
|------|------|------|----|-------|------|
| **小凶** `hex` | T3 | 10 | 0 | 15 | 概率污蚀：引擎稍微倾向让目标拿烂牌（对抗幸运时+10%克制加成） |
| **大凶** `havoc` | T2 | 20 | 0 | 30 | 恶意筛除：引擎明显倾向让目标拿烂牌（对抗幸运时+10%克制加成） |
| **灾变** `catastrophe` | T1 | 40 | 3 | 50 | 痛苦锁死：最强凶 + 压制同属性 T2/T3 |

### 灵视 (Psyche) — 裁定者 The Arbiter

每个技能都有**双重效果**：信息效果（必须发挥）+ 拦截效果（仅对抗 Chaos 时发挥）。

| 技能 | 阶级 | Mana | CD | 信息效果 | 拦截效果 |
|------|------|------|----|-------------|--------------|
| **澄澈** `clarity` | T3 | 10 | 0 | 显示牌堆胜率 (PokerSolver 计算) | 消除敌方 T3/T2 Curse。T1 豁免。 |
| **折射** `refraction` | T2 | 25 | 0 | 透视目标手牌 (需选目标) | 消除敌方 T3/T2 Curse + **50%** 转化为己方 Fortune。T1 豁免。 |
| **真理** `axiom` | T1 | 50 | 3 | 显示牌堆胜率 + 对手手牌信息 | 湮灭所有敌方 Curse（含 T1）+ **100%** 转化为己方 Fortune。 |

#### 澄澈（T3）— 低成本解控

```
敌人使用小凶 (curse power=15)
你使用澄澈 (clarity, 10 Mana)

引擎处理：
  1. 扫描敌方 Curse → 小凶 (T3, power=15)
  2. T3 ≤ T2 → 可拦截
  3. 小凶 effectivePower → 0
  4. 转化率 0% → 无额外收益
  结果：小凶被完全消除，但你也不获得任何加成
```

#### 折射（T2）— 透视 + 反制

```
敌人使用大凶 (curse power=30)
你使用折射 (refraction, 25 Mana) → 选择目标

信息效果 (必定): 透视目标手牌

反制效果:
  1. 扫描敌方 Curse → 大凶 (T2, power=30)
  2. T2 ≤ T2 → 可拦截
  3. 大凶 effectivePower → 0
  4. 转化：30 × 50% = 15 Fortune
  结果：敌凶失效 + 你获得 15 Fortune + 看到了敌人的牌！

但如果敌人用的是灾变 (T1, power=50)：
  T1 > T2 → T1 豁免，反制部分无效
  结果：灾变完全生效，但你仍然看到了敌人的牌
```

#### 真理（T1）— 绝对反杀

```
敌人使用灾变 (curse T1, power=50) + 大凶 (curse T2, power=30)
你使用真理 (axiom/reversal, 50 Mana)

引擎处理：
  1. 扫描所有敌方 Curse（含 T1）
  2. 灾变 effectivePower → 0，转化 50 × 100% = 50 Fortune
  3. 大凶 effectivePower → 0，转化 30 × 100% = 30 Fortune
  结果：敌人全部凶归零 + 你获得 80 点 Fortune！
```

**Moirai > Psyche 克制：**
- 敌方没有 Chaos 时，反制效果空放（无 Curse 可拦截）
- 但信息效果仍然触发（胜率/透视），不是完全浪费
- 这体现了“既定的命运无法被干涉，但可以被观测”的设计

### 虚无 (Void) — 消除系

| 技能 | 阶级 | Mana | CD | Power | 效果 |
|------|------|------|----|-------|------|
| **屏蔽** `static_field` | T3 | 0 | 0 | 8 | 被动：所有被动 fortune/curse 力量 -30% |
| **绝缘** `insulation` | T2 | 0 | 0 | 15 | 被动：敌方 Moirai/Chaos 效果对己方减半 |
| **现实** `reality` | T1 | 50 | 5 | 0 | 核弹：清除所有非 Void 效果，回归纯随机 |

---

## 属性克制详解

### Chaos > Moirai：凶克吉

curse 在对抗 fortune 时获得 **+10%** effectivePower 加成。

```
你开大吉 (fortune P30)
BOSS 开大凶 (curse P30)

引擎处理：
  1. 拔河对抗：30 vs 30
  2. Chaos > Moirai 克制：大凶 +10% → effectivePower = 33
  3. 结果：BOSS 的凶略占优势（不再是完全抵消）
```

### Psyche > Chaos：解析混沌

Psyche 技能主动拦截敌方 Curse，三阶效果递进：

```
BOSS 开大凶 (curse T2, P30) + 小凶 (curse T3, P15)
你开折射 (refraction T2, 25 Mana)

信息效果: 透视 BOSS 手牌

反制效果:
  1. 扫描敌方 Curse: 大凶(T2) + 小凶(T3)
  2. 折射可拦截 T3/T2 → 两者都被拦截
  3. 大凶: P30 → 0, 转化 30×50% = 15 Fortune
  4. 小凶: P15 → 0, 转化 15×50% = 7.5 Fortune
  结果: 敌方凶全灭 + 你获得 22.5 Fortune + 看到了敌人的牌
```

### Moirai > Psyche：反制空放

敌方只用天命不用 Chaos 时，Psyche 的反制部分无法生效，但信息效果仍然触发：

```
BOSS 开大吉 (fortune P30)、不用任何 Chaos 技能
你开折射 (refraction, 25 Mana) → 选择 BOSS

信息效果: 透视 BOSS 手牌 (仍然触发!)

反制效果:
  1. 扫描敌方 Curse → 无
  2. 折射捕捉不到任何负面能量
  结果: 反制空放，但你看到了敌人的牌，不是完全浪费
```

### 虚无 (Void) — 消除系

| 技能 | 阶级 | Mana | CD | Power | 效果 |
|------|------|------|----|-------|------|
| **屏蔽** `static_field` | T3 | 0 | 0 | 8 | 被动：所有被动 fortune/curse 力量 -30% |
| **绝缘** `insulation` | T2 | 0 | 0 | 15 | 被动：敌方 Moirai/Chaos 效果对己方减半 |
| **现实** `reality` | T1 | 50 | 5 | 0 | 核弹：清除所有非 Void 效果，回归纯随机 |

---

## 力量对抗处理流程

引擎在每次发牌前，按以下顺序处理所有力：

```
1. [属性加成]   CombatFormula.enhanceForces()
   → 根据角色属性值增强力量 (1 + attr/100)
   → 应用克制倍率 (1.5x / 0.75x)

2. [阶级压制]   _applyTierSuppression()
   → T1 vs T1 碰撞（power 对决，克制方 1.5x）
   → 存活 T1 执行 suppressTiers / suppressAttr / suppressAll

3. [绝缘减半]   _applyInsulation()
   → void_shield 持有者：敌方 Moirai/Chaos 效果 ×0.5

4. [同类对抗]   _resolveTypeOpposition()
   → 同类型 fortune vs fortune / curse vs curse 互相抵消

5. [主动压被动] 主动技能额外削弱敌方被动技能
   → tier 差越大，压制越强

6. [屏蔽削弱]   null_field 削弱所有被动力量 30%

7. [Psyche裁定]  _applyPsycheArbiter()
   → clarity: 消除敌方 T3/T2 Curse (0% 转化) + 显示牌堆胜率
   → refraction: 消除敌方 T3/T2 Curse (50% 转化为 Fortune) + 透视目标手牌
   → reversal: 湮灭所有敌方 Curse 含 T1 (100% 转化) + 显示牌堆胜率 + 对手手牌信息
   → 无敌方 Curse 时空放 (Moirai > Psyche 克制)

8. [Void 减伤]  CombatFormula.applyVoidReduction()
   → Kazu 前台时，敌方所有效果 ÷ voidDivisor
```

---

## 调试模式

开启调试模式后，引擎会记录每次发牌的完整时间线，包括所有力量对抗的具体数值。

### 开启方式

在浏览器控制台输入：

```javascript
// 开启调试模式
window.MonteOfZero && (window.skillUI.moz.debugMode = true);

// 关闭调试模式
window.skillUI.moz.debugMode = false;
```

### 调试时间线结构

每次发牌后，时间线保存在 `moz.lastSelectionMeta.debugTimeline`：

```javascript
// 查看最近一次发牌的时间线
console.table(window.skillUI.moz.lastSelectionMeta.debugTimeline);
```

### 时间线事件

| 事件 | 说明 | 数据 |
|------|------|------|
| `ROUND_START` | 发牌开始 | phase, deckRemaining, inputForces |
| `OPPOSITION_START` | 力量对抗开始 | 所有力的 owner/type/attr/tier/power |
| `TIER_SUPPRESSION` | 阶级压制发生 | 被压制的力 + 压制者 |
| `PSYCHE_CONVERT` | Psyche 拦截+转化 | 被拦截的 Curse + 转化后的 Fortune |
| `PSYCHE_NULLIFY` | Psyche 纯净化 | 被消除的 Curse（无转化） |
| `PSYCHE_WHIFF` | Psyche 空放 | 无敌方 Curse，技能浪费 |
| `OPPOSITION_RESULT` | 对抗结束 | 所有力的最终 effectivePower |
| `UNIVERSES` | 平行宇宙生成 | 候选牌数量 |
| `CARD_SELECTED` | 选牌完成 | 选中的牌 + 命运分 + top3/bottom3 |

### 调试输出示例

```
ROUND_START     phase=flop, deck=42, forces=[
                  {RINO, fortune, moirai, T2, power=30, active}
                  {BOSS, curse, chaos, T2, power=30, active}
                ]

OPPOSITION_START  2 forces entering opposition

OPPOSITION_RESULT [
  {RINO, fortune, power=30 → effectivePower=30}
  {BOSS, curse,   power=30 → effectivePower=30}
]

UNIVERSES       42 candidates

CARD_SELECTED   card=Jh, destinyScore=12.5, style=+3
                top3: [Jh=12.5, Ts=11.2, 9h=10.8]
                bottom3: [2c=-5.1, 3d=-4.8, 4s=-3.2]
```

### 带逆转的调试示例

```
ROUND_START     forces=[
                  {RINO, reversal, psyche, T1, power=50, active}
                  {BOSS, curse, chaos, T1, power=50, active}
                ]

TIER_SUPPRESSION  axiom(T1) suppressAttr=chaos → catastrophe SUPPRESSED

PSYCHE_CONVERT    arbiterType=reversal
                  intercepted: {BOSS, curse, T1, power=50}
                  converted:   {RINO, fortune, power=50}  (ratio=1.0)

OPPOSITION_RESULT [
  {BOSS, curse,   power=50 → effectivePower=0, suppressed by axiom}
  {RINO, fortune, power=50 → effectivePower=50, converted from curse}
]
```

---

## 阶级压制系统

| 规则 | 触发条件 | 效果 |
|------|----------|------|
| **suppressTiers** | 天命/灾变 T1 存活 | 无效化同属性 T2+T3 |
| **suppressAttr** | 真理 T1 存活 | 无效化所有 Chaos 属性技能 |
| **suppressAll** | 现实 T1 存活 | 无效化所有非 Void 技能 |
| **T1 vs T1** | 不同阵营 T1 碰撞 | power 对决（克制方 1.5x），败者被压制 |

---

## Mana 系统

| 角色等级 | 最大 Mana | 回复/轮 |
|----------|-----------|---------|
| 0 | 0 | 0 |
| 1 | 40 | 3 |
| 2 | 60 | 4 |
| 3 | 80 | 4 |
| 4 | 90 | 5 |
| 5 | 100 | 5 |

角色等级 = max(vanguard.level, rearguard.level)

---

## 属性面板与技能习得

```
属性值 ≥ 20 → 可学 T3
属性值 ≥ 40 → 可学 T2
属性值 ≥ 60 → 可学 T1
```

技能槽位 = 属性总和 ÷ 40（向下取整，最少 1，最多 4）

---

## game-config.json 配置

### 角色接口

```json
{
  "vanguard": { "name": "角色名", "level": 3, "trait": "特质key" },
  "rearguard": { "name": "角色名", "level": 5, "trait": "特质key" },
  "attrs": { "moirai": 80, "chaos": 20, "psyche": 50, "void": 100 },
  "skills": ["grand_wish", "refraction", "insulation", "reality"],
  "ai": "balanced"
}
```

- **skills** — 技能 key 数组，没有等级，只有有/无
- **attrs** — 属性面板，决定技能门槛和战斗属性加成
- **vanguard.level / rearguard.level** — 角色等级，仅用于 Mana 池计算
- 普通 NPC 可以省略 rearguard、attrs、skills

---

## 测试配置示例

### 示例 1：标准对局

```json
{
  "blinds": [10, 20],
  "chips": 1000,
  "hero": {
    "vanguard": { "name": "KAZU", "level": 3, "trait": "blank_body" },
    "rearguard": { "name": "RINO", "level": 5, "trait": "fate_weaver" },
    "attrs": { "moirai": 80, "chaos": 20, "psyche": 50, "void": 100 },
    "skills": ["grand_wish", "axiom", "refraction", "reality"]
  },
  "seats": {
    "BTN": { "vanguard": { "name": "路人A", "level": 0 }, "ai": "balanced" },
    "SB": { "vanguard": { "name": "路人B", "level": 0 }, "ai": "rock" },
    "BB": {
      "vanguard": { "name": "GAMMA", "level": 3 },
      "attrs": { "moirai": 40, "chaos": 30, "psyche": 25, "void": 0 },
      "skills": ["minor_wish", "hex"],
      "ai": "aggressive"
    }
  }
}
```

### 示例 2：真理反杀（Psyche 裁定者 vs Chaos 全开）

```json
{
  "blinds": [50, 100],
  "chips": 5000,
  "hero": {
    "vanguard": { "name": "KAZU", "level": 5 },
    "rearguard": { "name": "RINO", "level": 5 },
    "attrs": { "moirai": 40, "chaos": 10, "psyche": 70, "void": 30 },
    "skills": ["axiom", "refraction", "clarity", "grand_wish"]
  },
  "seats": {
    "BB": {
      "vanguard": { "name": "BOSS", "level": 5 },
      "attrs": { "moirai": 10, "chaos": 80, "psyche": 10, "void": 30 },
      "skills": ["catastrophe", "havoc", "hex", "static_field"],
      "ai": "aggressive"
    }
  }
}
```

**对局分析：**
- BOSS 全 Chaos 配置：灾变(50) + 大凶(30) + 小凶(15) = 总 curse 95
- 主角使用「真理」→ 拦截所有 Chaos 力（含 T1）
  - 灾变 50 × 100% = 50 fortune
  - 大凶 30 × 100% = 30 fortune
  - 小凶 15 × 100% = 15 fortune
  - **总转化 = 95 fortune！** 比直接用天命(50)强得多
- 主角再叠加「大吉」(30) → 总 fortune = 125
- BOSS 的凶全部反弹，自己反而被命运抛弃

**但如果 BOSS 只开 Fortune（不用 Chaos）：**
- 真理空放，浪费 50 Mana，BOSS 的 Fortune 完全生效

### 示例 3：天命 vs 灾变（T1 正面碰撞）

```json
{
  "blinds": [50, 100],
  "chips": 5000,
  "hero": {
    "vanguard": { "name": "KAZU", "level": 5 },
    "rearguard": { "name": "RINO", "level": 5 },
    "attrs": { "moirai": 80, "chaos": 10, "psyche": 30, "void": 60 },
    "skills": ["divine_order", "minor_wish", "clarity", "reality"]
  },
  "seats": {
    "BB": {
      "vanguard": { "name": "BOSS", "level": 5 },
      "attrs": { "moirai": 10, "chaos": 80, "psyche": 10, "void": 30 },
      "skills": ["catastrophe", "havoc", "hex", "static_field"],
      "ai": "aggressive"
    }
  }
}
```

**对局分析：**
- 天命(Moirai T1, power=50) vs 灾变(Chaos T1, power=50)
- Chaos 克制 Moirai → 灾变 50 × 1.5 = 75 vs 天命 50
- 天命被压制，灾变以 (75-50)/75 ≈ 33% 残余力量存活
- 后手选择：用「现实」(Void T1) 清场回归随机

### 示例 4：纯路人局

```json
{
  "blinds": [5, 10],
  "chips": 500,
  "hero": {
    "vanguard": { "name": "RINO", "level": 1 },
    "attrs": { "moirai": 20, "chaos": 0, "psyche": 0, "void": 0 },
    "skills": ["minor_wish"]
  },
  "seats": {
    "BTN": { "vanguard": { "name": "NPC_A", "level": 0 }, "ai": "balanced" },
    "SB": { "vanguard": { "name": "NPC_B", "level": 0 }, "ai": "passive" },
    "BB": { "vanguard": { "name": "NPC_C", "level": 0 }, "ai": "rock" }
  }
}
```

---

## UI 行为分类

| 行为 | 技能 | UI 表现 |
|------|------|----------|
| **FORCE** | 小吉、大吉、天命、小凶、大凶、灾变、现实 | 点击按钮 → 注入力 |
| **PSYCHE** | 澄澈、折射、真理 | 点击 → 信息效果(胜率/透视) + 注入反制力 |
| **PASSIVE** | 屏蔽、绝缘 | 无按钮，自动生效 |

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `core/skill-system.js` | 技能注册、Mana、激活、NPC AI、力量收集 |
| `core/monte-of-zero.js` | 引擎：力量对抗、阶级压制、选牌、调试时间线 |
| `ui/skill-ui.js` | UI 按钮、激活路由、Psyche透视/胜率、力量对抗展示 |
| `rpg/attribute-system.js` | 四属性、克制环、属性加成 |
| `rpg/combat-formula.js` | 属性增强、Void 减伤 |
| `ST/acezero-tavern-plugin.js` | 酒馆中间件：ERA → 技能推导 |
