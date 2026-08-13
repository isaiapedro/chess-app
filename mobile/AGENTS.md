# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

## Game coach knowledge (derived pack only)

- **App never loads PDFs or the masters game database.**
- Offline CLI (`workspace/experiments/chess-coach`) does heavy lifting:
  1. `ingest` PDFs → Chroma
  2. `summarize-knowledge` → teaching summaries + ECO/motif tags
  3. `export-mobile-pack` → frequent SAN lines from masters + write `derivedCoachPack.ts`
- Mobile imports [`derivedCoachPack.ts`](src/engine/gameCoach/derivedCoachPack.ts) and matches themes / ECO / recent moves locally.
- Fallback: static theme cards in `knowledgePack.ts` / `bookArchive.ts`.
- Optional live API retrieve exists for tooling only — Games analysis does **not** call it.
- Coach analysis cache key: `game-coach:v51`.
- **Shared deep-eval vault** with Study/puzzles: `study:game-evals:v2:{username}|{platform}`.
  Games analyze reuses vault `positions[fenKey]` when present; new Stockfish hits write back via `upsertSharedGameEvals`.
  Same `NormalizedGame.id` across buckets — no PDF/DB, just on-device eval share.
```bash
cd workspace/experiments/chess-coach
chess-coach knowledge-pipeline data/books --reset-summaries
# or just refresh the shipped pack:
chess-coach export-mobile-pack
```
