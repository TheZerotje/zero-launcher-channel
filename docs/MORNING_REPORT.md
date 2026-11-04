# Morning report (night of 3 to 4 November 2026)

## What you can try first
1. Download the Windows installer from the pull request (Checks > CI > Artifacts > ZeroLauncherSetup).
2. Open the Store: search a game, open a game page, try Settings > Text size "Bigger" and "Easy-to-read letters".
3. As developer: Publish > "Export from Godot" for Railrove (set `godotPath` in developer.json first).

## Part 1: what works now
- **Code is in GitHub.** I copied it from E:\ZeroLauncher (no secrets, no Version 2 files). Rules are in AGENTS.md and CLAUDE.md.
- **CI on GitHub**: Ubuntu runs all tests + the real app tests. Windows runs the tests and builds the installer
  (kept as a build artifact, never published).
- **App tests** (real app, muted): install, play, update, uninstall, tester sees only his test versions,
  developer add > testers > release > go back, friend approve, changed game list refused, player cannot use developer
  actions, bad input refused, web game windows locked. Screenshots: docs/screens/.
- **Players**: search + filters (PC games / Play instantly / Installed) - `player-store-search.png`;
  Library search + sort by last played; download line (one at a time, Waiting, Pause, Resume, Cancel) -
  `player-download-line.png`; free disk space check; Windows messages for finished updates and new test versions
  (can be turned off); Help page with 8 questions - `player-help.png`; text size and easy font -
  `player-settings-big-easy.png`; Dutch - `player-store-dutch.png`; game page with what's new, Repair,
  Report a problem - `player-game-page.png`.
- **You (developer)**: Export from Godot (from a temp copy, your folder is never changed) - `dev-publish-godot.png`;
  git commits + "changes not committed" + last build size + Copy path in My games - `dev-my-games-git.png`;
  Friday 12:00 message; AI helper past jobs (show log, open log file, run again) - `dev-ai-history.png`;
  "Upload needed" badge + upload progress; Ctrl+1..9 pages, Ctrl+F search.
- **Safety**: all JSON files are written safely (temp file, then rename); every IPC call checks its input;
  AI helper can't run extra commands from typed text on Windows; web games can't use camera/mic/location.

## Part 1: what is NOT done or not tested
- Not tested on a real Windows PC with real Godot, Claude or Codex (only on CI with fake tools).
- The code on your PC was version 0.1.0 (not 0.2.0). The game page and "Logs & reports" page did not exist.
  I made a new game page. There is still no "Logs & reports" page.

## Decisions I made alone
See [DECISIONS.md](DECISIONS.md).

## Tests
See the end of this file (updated at the end of the night).
