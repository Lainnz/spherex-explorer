# SPHEREx Xplorer: notes for Claude Code

The spec is **PLAN.md** (Part 2). Build phase by phase (§12), stop after each one, and
wait for the user to say "go". Data facts verified live are in **docs/DATA_NOTES.md**.
Check there before assuming anything about IRSA, and add to it when you learn more.

## The user
- On Windows 11, new to web development. Explain in plain language, define jargon.
- Give exact **PowerShell** commands. The user runs installs, `.venv` changes and
  scripts in their own PowerShell window and pastes the output back.
- Windows **Smart App Control** is on. It can block unsigned Python extension files
  ("An Application Control policy has blocked this file"). If a Python package fails to
  import with that message, report it rather than working around it.

## Layout
- `frontend/`: Vite multi-page site (`index.html` title, `stellar.html` Stellar View),
  vanilla JS, `base: '/spherex-explorer/'`. Shared code in `src/shared/`.
- `backend/`: FastAPI in `app/`. Settings via env vars (`app/settings.py`).
- `config/datasets.json`: single source of truth for releases, HiPS IDs and limits.
  Read by both sides.
- `brand/`: original logos; never edit. `scripts/build_brand.py` makes the web copies.

## Commands (PowerShell)
- Website: `cd frontend; npm run dev` → http://localhost:5173/spherex-explorer/
- Tests: `cd frontend; npm test` · `cd backend; python -m pytest`
- Server: `cd backend; uvicorn app.main:app --reload --port 8000`

## Rules (PLAN.md §15)
- Verify, don't guess: collection/column/flag names, HiPS IDs and Aladin methods come
  from live responses or official docs.
- Work on `feature/title-and-stellar-view`. Commit after each phase. Ask before pushing.
- Short files, comments explaining *why*, JSDoc on public functions.
- Never download full SPHEREx files (about 70 MB). Cutouts only, and each is about 4 MB
  because of the EPSF table.
- IRSA SIA searches currently take 2–3 minutes. Use long timeouts and cache results.
