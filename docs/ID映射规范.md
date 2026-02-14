# 玩家 ID 映射规范

> 本文档说明《零之王牌》中玩家 ID 的分配机制、各子系统如何正确获取 ID，以及常见陷阱。
> 所有新增代码必须遵循本规范，避免 ID 不匹配导致特质/技能/属性错位。

---

## 1. ID 的来源：游戏引擎

玩家 ID 由 `texas-holdem.js` 的 `initializePlayers()` 按**座位顺序**分配：

```
BTN=0, SB=1, BB=2, HJ=3, CO=4, UTG=5
```

Hero 的 ID 取决于 `heroSeat`。例如 `heroSeat: "CO"` → heroId=4。

这些 ID 通过 `playerIdMap` 传递给 RPG 子系统：

```js
playerIdMap = {
  heroId: 4,           // hero 的真实游戏 ID
  seats: {             // 每个座位 → 游戏 ID
    BTN: 0, SB: 1, BB: 2, HJ: 3, CO: 4
  }
}
```

---

## 2. 各子系统的 ID 接收方式

| 系统 | 入口函数 | ID 来源 | 存储位置 |
|------|----------|---------|----------|
| **SkillSystem** | `registerFromConfig(config, playerIdMap)` | `playerIdMap.heroId` / `playerIdMap.seats` | `this._heroId`, 每个 skill 的 `skill.ownerId` |
| **TraitSystem** | `registerFromConfig(config, playerIdMap)` | 同上 | `this.traits` Map (key=ownerId) |
| **AttributeSystem** | `registerFromConfig(players)` | `__rpgBuildAttrPlayers(config, playerIdMap)` 构建 | `this.players` Map (key=id) |
| **SwitchSystem** | `new SwitchSystem({ rinoId })` | `skill-ui.js` 传入 `heroId` | `this.rinoId` |
| **CombatFormula** | `new CombatFormula({ heroId })` | `skill-ui.js` 传入 `heroId` | `this.heroId` |
| **MonteOfZero** | `selectCard(..., { rinoPlayerId })` | `skill-ui.js` 传入 `humanPlayerId` | `this._heroId` |

### 关键调用链（skill-ui.js:registerFromConfig）

```
skill-ui.js
  ├─ skillSystem.registerFromConfig(config, playerIdMap)    // SkillSystem
  ├─ traitSys.registerFromConfig(config, playerIdMap)       // TraitSystem
  ├─ __rpgBuildAttrPlayers(config, playerIdMap) → attrSys   // AttributeSystem
  ├─ new SwitchSystem({ rinoId: heroId })                   // SwitchSystem
  └─ new CombatFormula({ heroId, traitSystem, ... })        // CombatFormula
```

---

## 3. 常见陷阱与规则

### 规则 1：永远不要用 `|| 0` 处理可能为 0 的 ID

```js
// ❌ 错误：heroId=0 时会被当作 falsy
const id = playerIdMap.heroId || 0;

// ✅ 正确：显式 null 检查
const id = playerIdMap.heroId != null ? playerIdMap.heroId : 0;
```

同理适用于 `tier`、`power` 等可能为 0 的数值字段：
```js
// ❌ tier: catalog.tier || 3    → tier=0 变成 tier=3
// ✅ tier: catalog.tier != null ? catalog.tier : 3
```

### 规则 2：永远不要硬编码 hero=0

```js
// ❌ 错误：假设 hero 永远是 ID 0
if (force.ownerId === 0) { /* hero logic */ }

// ✅ 正确：使用存储的 heroId
if (force.ownerId === this.heroId) { /* hero logic */ }
```

### 规则 3：NPC 的 ID 不是顺序递增的

```js
// ❌ 错误：假设 NPC 从 1 开始递增
let npcId = 1;
for (const seat of seatOrder) { ... npcId++; }

// ✅ 正确：从 playerIdMap.seats 读取真实 ID
for (const seat in playerIdMap.seats) {
  const npcId = playerIdMap.seats[seat];
}
```

### 规则 4：特质效果检查必须用 force 的 ownerId

对于**通用特质**（可能出现在 NPC 身上的，如 `binding_protocol`、`death_ledger`）：

```js
// ❌ 错误：只对 hero 生效
if (f.ownerId === this.heroId) {
  const trait = traitSystem.hasEffect(f.ownerId, 'mana_efficiency');
}

// ✅ 正确：对任何拥有该特质的角色生效
const trait = traitSystem.hasEffect(f.ownerId, 'mana_efficiency');
```

对于**hero-only 特质**（如 `crimson_crown`、`obsessive_love`、`null_armor`、`steady_hand`），保留 `this.heroId` 门控是正确的。

### 规则 5：构造函数必须传入 heroId

```js
// ❌ 错误：依赖默认值
new SwitchSystem();                    // rinoId 默认 0
new CombatFormula({});                 // heroId 默认 0

// ✅ 正确：显式传入
new SwitchSystem({ rinoId: heroId });
new CombatFormula({ heroId: heroId });
```

### 规则 6：回退路径必须保留

所有接受 `playerIdMap` 的函数必须有无 `playerIdMap` 时的回退逻辑（顺序分配），因为首次注册可能在 `playerIdMap` 可用之前发生。

```js
if (playerIdMap && playerIdMap.heroId != null) {
  // 使用真实 ID
} else {
  // 回退：hero=0, NPC=1,2,...
}
```

---

## 4. 调试检查清单

当特质/技能/属性行为异常时，按以下顺序排查：

1. **检查日志中的 ID**
   - `[SKILL-SYS] registerFromConfig heroId=? seatIds=?`
   - `[SkillUI] RPG 系统已初始化 — TraitSystem: [...]`（检查 ownerId）
   - `[GAME] 玩家列表: #0 ... #4 ...`（确认座位→ID 映射）

2. **检查 MANA_SPENT 的 ownerId**
   - hero 的 ownerId 应该等于 heroId（不是 0）
   - NPC 的 ownerId 应该等于其座位对应的 ID

3. **检查 MoZ 日志中的 force ownerId**
   - `[MoZ] 生效力量: KAZU fortune P=...` — ownerId 应该是 heroId
   - NPC 的 curse 应该用 NPC 的真实 ID

4. **检查 TraitSystem.getSummary()**
   - 每个角色的 ownerId 应该与游戏 ID 一致
   - 如果 hero 的特质注册在 ID=0 但 heroId=4，说明 playerIdMap 没传

---

## 5. 文件索引

| 文件 | ID 相关逻辑 |
|------|-------------|
| `texas-holdem.js` | 分配座位 ID，构建 `playerIdMap`，传入 `aiTurn` context |
| `skill-ui.js` | 桥接层：将 `playerIdMap` 传给所有 RPG 子系统 |
| `skill-system.js` | `_heroId` 存储，技能注册用 `seatIds`，mana 池按 ownerId |
| `trait-system.js` | `traits` Map 按 ownerId 存储，`hasEffect(ownerId, ...)` 查询 |
| `rpg-init.js` | `__rpgBuildAttrPlayers` 构建属性面板，按 `playerIdMap` 分配 ID |
| `attribute-system.js` | `players` Map 按 id 存储，`getAttributes(ownerId)` 查询 |
| `switch-system.js` | `rinoId` 必须从外部传入 |
| `combat-formula.js` | `heroId` 用于区分 hero-only 特质 vs 通用特质 |
| `monte-of-zero.js` | `rinoPlayerId` 从 `selectCard` options 传入 |
| `poker-ai.js` | `context.heroId` 用于对手建模 |
