# Notes and assumptions

Current state: **M0** (COFM calculator) plus **M0.5 – tactical decision game** (TDG). There is no map yet.

- `npm install`, then `npm run dev` to play.
- `npm test` runs the unit and balance tests.
- `npm run build` type-checks and bundles.

## Code layout

- **`src/core/`** holds the game logic, all without DOM code and tested in Node:
  - `data.ts`: data types and validation for equipment, era files and scenarios.
  - `cofm.ts`: unit and sector potential, NATO estimates (low/mid/high), ratios per category, and comparison with the norms.
  - `fog.ts`: recon and contact (the estimate is replaced by the truth sector by sector), and readiness from planning time left.
  - `adjudicate.ts`: sector score, outcome, losses and one phase of fighting. M3's simulation will replace it behind the same `resolvePhase` interface.
  - `rng.ts`: the seeded random generator, with an independent stream per (seed, phase, sector).
- **`src/planning/`**, also DOM-free:
  - `plan.ts`: the plan (formation to sector, role per sector) and `evaluatePlan`, which takes the NATO units explicitly so the same code rates the estimate and the truth.
  - `tdg.ts`: the game as a pure reducer, running briefing → planning → decision → debrief, plus `simulate` for the school solution and the balance tests.
- **`src/ui/`**: screens (`views.ts`), the controller (`app.ts`), and the countdown (`timer.ts`, the only real-time code).
- **`src/content.ts`**: loads the data files. Both the app and the tests use it.

## Data files

- **`data/equipment.json`**: coefficients, each marked `"basis": "source"` or `"game-tuned"`.
- **`data/eras/1970s.json`**: the norms, the Soviet order of battle, and the tunable numbers for prep time, recon and adjudication.
- **`data/scenarios/*.json`**: briefing, sectors, the NATO **estimate** and **truth**, the NATO reaction rule, time limits and the school solution.

## How a TDG plays

1. **Briefing.** The situation, the known enemy positions and the planning-hour budget.
2. **Planning.**
   - **Recon:** costs 2 h per sector and replaces the estimate there with the truth.
     - Dummies vanish and hidden units appear.
     - A unit that is really elsewhere becomes "location unknown"; recon does not reveal where it went.
   - **Readiness:** hours left at H-hour set a readiness multiplier for the whole regiment, from 100% with 4+ h left down to 85% with none. Recon therefore costs battle-procedure time.
   - **Commit:** "Commit plan", or the timer running out, locks the plan.
3. **Phase 1.** Every sector with Soviet forces is adjudicated against the *true* NATO deployment.
   - Contact reveals the enemy in the attacked sectors.
   - NATO's reserve moves toward the **main effort**: the attacked sector with the most Soviet combat potential. This is the Active Defense rule from DESIGN.md: shift the reserve toward the identified main effort.
4. **Decision.** The player may commit uncommitted formations and re-assign artillery. Battalions in contact can't move, and roles are fixed.
   - A sector broken through in phase 1 is now judged against **exploitation** norms. That role is game-applied and the player can't select it.
5. **Phase 2** settles it.
   - **Mission accomplished:** an attack or breakthrough sector succeeds in phase 2, holding at least 30% of the regiment's starting potential (enough to go on to the objective), with regiment losses below 35%.
   - **Partial success:** a sector is won, but too few forces got through or the losses are too high.
   - **Failure:** no sector is won.
6. **Debrief.**
   - The planned ratio against the actual one per sector, the outcomes and losses per phase, and every NATO unit as reported against what it actually was.
   - The school solution, played with the same seed.
   - "Replay (same seed)" keeps the luck fixed, so only your choices change the result.

## Adjudication model (all game-tuned, all in the era file)

- **Sector score.** A weighted geometric mean over the categories of `ratio / norm`, each clamped to [0.2, 2.5].
  - 1.0 means exactly at the norms.
  - Weights: tanks 0.3, overall 0.35, artillery 0.15, antitank 0.1, infantry 0.1.
  - A geometric mean punishes a weak category more than an arithmetic one would, so massed artillery can't make up for too few tanks.
  - A category with nothing on either side is left out.
- **Chance.** The score is multiplied by ε, drawn uniformly from 0.8–1.2.
- **Outcome.** At least 1.0 is success, at least 0.75 is stalled, anything lower is repulsed.
- **Losses** for the sector's units:
  - Soviet: `0.15 × intensity ÷ effective score`
  - NATO: `0.25 × intensity × effective score`
  - Both are capped at 60%.
  - Intensity is 1.0 for breakthrough and attack, 0.8 for exploitation, and 0.5 for a holding attack.
  - Artillery placed "spread" takes no losses.
  - Losses lower `strength`, which lowers potential. This is the Soviet idea of coefficients that include losses suffered.
- **Not modelled yet:** terrain, fortification, suppression, morale, frontage and tubes per km. The norms already include the defender's advantage, as DESIGN.md says. M2 and M3 bring the rest.

## Balance

`tests/balance.test.ts` plays every scenario over seeds 1–50 and checks:

- the school solution wins at least 70% of runs (currently 90–100%);
- a broad-front attack with no second echelon wins at most 30% (currently 0%);
- committing the second echelon raises the win rate (roughly 70% without it, 90–100% with it);
- in scenario 2, the plan the estimate suggests (mass on A) wins at most 30% (currently 24%).

Re-run these after changing any number in `data/`.

## Scenarios (fictional units, game-tuned)

1. **First echelon.** Mostly an accurate estimate. Team C has an unreported tank platoon. The lesson: mass, then keep a second echelon for the counterattack.
2. **The suspected reserve.** Team Tank is really behind sector A, not B. The tanks reported in C are a dummy. On paper A is weakest, so recon pays off.
3. **Late H-hour.** Only 2 planning hours and tight time limits. The village in B is strong and C is a thin screen. The DS artillery is a full battalion, not the two batteries reported.

## Earlier assumptions (M0), still valid

- **Coefficients.** Only T-55/T-62 (1.0), T-54A (0.9), BMP-1 (0.8) and M1 (2.5) come from the 1977 CIA table quoted in DESIGN.md. Everything else, including M60A1 = 1.10, is game-tuned.
- **Categories.** Each equipment type belongs to exactly one category.
  - Infantry is the IFV or APC *with its squad*.
  - "Other" (recon vehicles, air defence) counts toward overall only.
- **Ratios are like-for-like**, Soviet tanks against NATO tanks and so on. Soviet forces against nothing reads ∞. Nothing on either side reads "—".
- **Colours.** Green means the ratio meets the norm; amber means at least 75% of it.
- **Norms.**
  - From DESIGN.md: overall 3:1, and 5:1 in tanks and artillery on the breakthrough sector.
  - Game-tuned: the antitank norm (1:1), the infantry norms, holding attack and exploitation.
- **Orders of battle** are approximate, from general knowledge of FM 100-2-3-style tables, and should be checked.
  - 2 MRB's 5th company is at 70% strength.
  - 3 MRB is at readiness 0.9.

## Known limitations

- **Timer:** switching it off and on during a phase restarts the countdown, so it is honour-system.
- **Saved state:** only the timer preference and each scenario's best result are kept (in localStorage). A game in progress is lost on reload.
- **NATO reaction:** only one reaction rule exists (reserve to the main effort). The AirLand Battle profile and deep fires belong to M4 and M7.
