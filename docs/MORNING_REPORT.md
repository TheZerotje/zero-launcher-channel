# Morning report (night of 3 to 4 November 2026)

## What you can try first
1. Get the installer: PR #1 > Checks > CI > Artifacts > **ZeroLauncherSetup**. Install it on your PC.
2. Open **My projects** (first page for you). Press **Start review** and go through the cards.
3. Open the Store as a player and press Install, then Play.

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
  git commits + "changes not committed" + last build size + Copy path in My projects - `dev-my-projects-git.png`;
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

## Part 2: what is new
- **Works offline**: the last good game list is kept; installed games still play; a calm "Offline" note; it tries
  again by itself (1 min, 5 min, 30 min). `player-offline.png`
- **News** on the Store, written by you on Publish, signed with the game list. `player-store-news.png`, `dev-publish-news.png`
- **Better game pages**: screenshots with a big view and arrows, trailer button, "New", "Recently updated" and
  "Coming soon" (with countdown) on the Store, launch options, desktop shortcut. `player-game-gallery.png`,
  `player-store-sections.png`, `player-game-page-extras.png`
- **Tester helpers**: purple "What to test" box, quick 👍/👎 feedback, crash report with the last Godot log lines,
  shown before anything is saved. `tester-game-page.png`, `tester-crash-report.png`
- **Developer power**: download numbers per version, release checklist before Release, Discord message preview +
  Send (only after you press it), secret key backup with a monthly reminder, Ctrl+K finds anything.
  `dev-release-checklist.png`, `dev-discord-preview.png`, `dev-settings-key-backup.png`, `dev-command-box.png`
- **Player settings**: start with Windows (small, in the tray), download speed limit, move a game to another disk
  (copied and checked first), the uninstaller asks "Also remove installed games?" (No by default).
  `player-settings-start-speed.png`, `player-game-moved.png`
- **Final pass**: security check of the new code (move game only removes a real game folder), Help answers for
  the new things, README updated, new **docs/HOW_TO_FRIEND.md** for your friend host.

## Part 2: what is NOT done
- Discord posting and the start-with-Windows switch only work on your PC (CI can't test real Discord or Windows login).
- Trailers open in your normal browser (not inside the launcher), on purpose: safer.

## Part 3: My projects (new)
- **One list of everything**: games + Roblox + D&D tools + AI + website + launcher + other. Filters (type, stage,
  waiting on, priority), search. Released and scrapped are hidden unless you ask. `dev-my-projects.png`
- **Exact status, with where it comes from**: last changed file, newest build, version (Godot / Unity / Unreal /
  package.json / Roblox file date), git last 5 commits + "changes not committed" (read only), website state from
  releases.json (read only), launcher versions per state. Red **"Folder not found"** when a folder is missing.
  `dev-my-projects-git.png`
- **Boxes at the top**: Don't forget (7 / 14 / 30 days for priority 1 / 2 / 3), Waiting on you, New folder found
  (top folders of E:\ and F:\ only, with Add as project / Ignore forever). Daily Windows message (off switch in Settings).
- **Scrap cleanly**: one-line reason, then "Are you sure? It will be hidden everywhere." Hidden from lists,
  Don't forget, This week and your Store; marked on Publish. The website is never changed (you get a reminder).
  **Scrapped** page with reason, Bring back (only you, with a yes box) and "Pack folder into an archive zip"
  (default E:\Archive, the original is never deleted). `dev-graveyard.png`
- **Quick review** (Friday): one big card at a time, Keep going / Pause / Scrap / Skip, most forgotten first,
  max 10. Each choice is saved in the history. The week plan then uses only "Keep going". `dev-quick-review.png`
- **Status report**: one page, Copy as Markdown, Save as HTML or Markdown. `dev-status-report.png`
- Seed list from your message is in app/data/projects-seed.json. Please correct it in the app (Edit on each row).
  Already scrapped: Cryptogram, Mall-ien Empire, Glowcube Gardens, Junkyard Jingles, Lantern Road.

## Part 3: what is NOT done
- Folder paths in the seed list are guesses from your notes (E:\..., F:\...). Missing ones show red. Fix them with Edit.
- "Waiting on" for games is a guess: games that wait for your playtest or OK say "You".

## Extra (you asked for this during the night)
- **Hack test**: I tried to break in myself (test/e2e/hack.test.js): HTML in a game name, moving the main
  window, opening file:// windows, sneaky inputs, a fake friend file from "__proto__", a "folder" that is really
  an .exe, Bring back / Scrap without your yes. I found and fixed **2 holes** (DECISIONS.md 56-57).
- **Shorter code** where it stays clear: shared scrap box, one "no extra input" check, one unused call removed.
- **More tests**: user tests that act like a person (test/e2e/journey.test.js): a new player's first day in
  English and in Dutch with big text, keyboard only, and your morning routine. They also check that players never
  see tech words, every button has words, and no page is too wide.
- **Look**: every game without a picture gets its own calm colour; My projects boxes and rows tidied.

## Tests and CI
- Core tests: **34 pass, 0 fail** (`npm test`).
- App tests (real app, muted, virtual screen): **37 pass, 0 fail** (`npm run test:e2e`).
- CI on GitHub: green (Ubuntu: all tests; Windows: tests + installer). CI was red for a while after Part 2.3
  (an old test got confused because new games show twice in the Store). Fixed; CI now runs once per push.
- PR: https://github.com/TheZerotje/zero-launcher-channel/pull/1 (draft, not merged).
- Installer: PR #1 > Checks > CI (newest run) > Artifacts > **ZeroLauncherSetup**.

## Your next step
Install the launcher from the CI artifact on your PC, open **My projects**, and fix the folder paths that show red.
