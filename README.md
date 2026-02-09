# AceZero

ST iframe-injected games. Current game: Texas Hold'em.

## Structure
- `texasholdem/` — game assets
- `texasholdem/STver.html` — iframe wrapper for ST injection
- `texasholdem/texas-holdem/` — main game (HTML/CSS/JS, data-loader)
- `参考/` — reference materials (not required for runtime)

## Run locally
Open `texasholdem/texas-holdem/texas-holdem.html` in a browser, or serve the `texasholdem/` folder via static hosting.

## Injection flow (ST)
1. ST injects JSON into `STver.html` (`<script type="application/json">$1</script>`)
2. Wrapper routes by `gameId` → loads game iframe
3. PostMessage delivers JSON to game → `data-loader.js` consumes → `texas-holdem.js` uses config

## Notes
- Default config: `texasholdem/texas-holdem/game-config.json` (has `gameId: "texas-holdem"`)
- External JSON can override config via postMessage
