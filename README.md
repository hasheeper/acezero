# AceZero

ST iframe-injected mini-games platform.

Current built-in games:
- Texas Hold'em (`texas-holdem`)
- Blackjack / 21点 (`blackjack` or `21`)

## Structure
```
acezero/                        ← GitPage root
├── index.html                  ← 主加载引擎（路由 + iframe 嵌入游戏）
├── data-loader.js              ← 通用外部数据加载器
├── game-config.json            ← 默认游戏配置（gameMode / gameId 决定加载哪个游戏）
├── STver.html                  ← ST 注入包装器
├── deck-of-cards/              ← 通用卡牌渲染库（root 共享）
├── texasholdem/                ← 德州扑克模块
│   ├── texas-holdem/           ← 游戏本体 (HTML/CSS/JS)
│   └── pokersolver/            ← 牌型判定库
└── 参考/                       ← 参考资料（非运行时依赖）
```

## Run locally
Open `index.html` in a browser (or serve root via static hosting).

## Data flow
```
ST (SillyTavern)
  → STver.html ($1 JSON injection)
    → index.html (main engine, routes by gameId)
      → texasholdem/.../texas-holdem.html 或 blackjack/blackjack.html (iframe)
        ← postMessage (game config)
```

## Adding a new game
1. Create game folder: `mygame/mygame.html`
2. Add route in `index.html` → `GAME_ROUTES`
3. Set `gameMode` (recommended) or `gameId` in `game-config.json` / ST injection JSON
