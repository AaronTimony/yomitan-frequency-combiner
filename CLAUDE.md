# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands run from `frontend/`:

```bash
npm run dev        # start dev server
npm run build      # tsc + vite build
npm test           # run tests once
npm run test:watch # run tests in watch mode
```

Run a single test file:
```bash
npx vitest run src/combiner.test.ts
```

## Critical: JS and TS files must stay in sync

Every `src/*.ts` module has a corresponding `src/*.js` file that Vite resolves first (`.js` takes priority over `.ts` in Vite's default extension order). **After editing any `.ts` file, regenerate the JS files:**

```bash
npx tsc
```

Skipping this means your changes are silently ignored at runtime.

## Architecture

The app is a pure frontend (Vite + TypeScript + Tailwind), deployed on Vercel with no backend. All processing happens in-browser.

**Three pages** are defined in `index.html` as `<section id="page-*">` elements and managed by `pages.ts`, which shows/hides them and syncs the URL path (`/create`, `/combiner`, `/recommended`).

**Create page** (`searchPage.ts`) — the main feature. Fetches media decks from the Jiten API, lets users select them, then merges and downloads a combined Yomitan frequency dictionary. The API base URL switches between `https://api.jiten.moe/api` (localhost) and `/api` (production, proxied by Vercel) based on `location.hostname`.

**Combiner page** (`index.html` + `main.ts`) — the original feature. Accepts locally uploaded Yomitan `.zip` files via drag-and-drop and combines them using `averageZips`.

**Core logic** (`combiner.ts`):
- `readFrequencies` — parses one or more Yomitan zip files into a shared `Map<string, FreqEntry>`, keyed by expression+reading+marker. Slots per-dict values into `freqs[]`, filling `null` for dicts that lack an entry.
- `mergeJitenDecks` — sums `freqs[]` across all dicts, sorts descending, assigns rank 1, 2, 3… as the output value. Used by the Create page.
- `averageZips` — averages `freqs[]` across dicts. Used by the Combiner page.
- Entry keys distinguish kanji-rank from kana-rank entries for the same word using a `㋕` suffix (e.g. `春\tはる` vs `春\tはる\t㋕`).

**Jiten API** (`jitenApi.ts`) — thin client for `api.jiten.moe`. Decks don't contain rankings, they contain raw occurrence counts. The merge step is what converts counts → ranks.

