# Instructions for Claude Code

- Read DESIGN.md first; NOTES.md records assumptions made so far.
- Keep `src/core` (and `src/planning`) free of DOM code.
- Write Vitest tests for every core function (`npm test`); keep `npm run build` (type check + bundle) green.
- Every tunable number (coefficients, norms, attrition factors) lives in `data/`, never hard-coded.
  Mark each coefficient `"basis": "source"` or `"game-tuned"`.
- One milestone per session.
