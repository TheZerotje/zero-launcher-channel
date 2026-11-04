# Zero Launcher

One desktop app (Windows) for all of Zero's games, a bit like Steam.

- **Player**: Store (search, filters, New / Recently updated / Coming soon), News, Library, Zero's Arcade
  (website games inside), Settings, Help. PC games install, are checked (SHA-256) and update by themselves.
  Works offline with the games from last time. Desktop shortcuts, launch options, move a game to another disk,
  download speed limit, start with Windows (in the tray), text size, easy font, Dutch.
- **Tester**: same app. Makes an account in Settings (ID like `SAM-4F2A-9C1B`), Zero ticks which games they may
  test. Gets test versions of only those games, with a "What to test" note, quick 👍/👎 feedback and a crash
  report that is shown before it is saved.
- **Developer** (Zero's PC, `developer.json` in the app data folder): My projects (every project with exact status, git,
  last build, Don't forget, scrap + Scrapped page, quick review, status report), This week (goals + to-dos, new plan every Friday 12:00), Publish (Unreleased -> Testers ->
  Everyone -> Upload, Go back, Export from Godot, release checklist, news, game page info, download numbers,
  Discord preview), Testers, Friend games (Approve), AI helper (`claude, ...` / `codex, ...` / `chatgpt, ...`),
  Website & host (website status only, key backup). Ctrl+K finds any game or page.
- **Friend host** (`friend.json`): makes a signed `.zlsub` game file to send to Zero. See docs/HOW_TO_FRIEND.md.

Safety: the game list is signed with Zero's key (players refuse a changed list), every download is SHA-256
checked before it is unpacked, unsafe zip paths are refused, every app action checks its input, friends' files
need Zero's Approve, nothing is released without Zero pressing Release (and a confirm box).

## Run
    npm install
    npm test            # core tests
    npm run test:e2e    # tests of the real app (muted; on Linux use xvfb-run)
    npm start           # the app

Demo profiles: `node tools/make-demo.js <folder>` then `ZL_USER_DATA=<folder>/dev npm start`.

CI (GitHub Actions) runs all tests and builds the Windows installer as a download on the Actions page.
It never publishes anything.

See docs/SETUP_ON_PC.md for the steps on Zero's PC, docs/DECISIONS.md for choices made, and
docs/MORNING_REPORT.md for the latest work.

## Rules

Read AGENTS.md / CLAUDE.md first. The website, Tailscale, port 8443 and existing games stay untouched. The
launcher only shows the website status; it never starts it. Nothing goes public without Zero's yes.
