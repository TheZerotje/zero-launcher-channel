# Zero Launcher

One desktop app (Windows) for all of Zero's games, a bit like Steam.

- **User**: Store, Library, Zero's Arcade (website games inside), Settings. PC games install, check (SHA-256), update by themselves.
- **Tester**: same app. Makes an account in Settings (ID like `SAM-4F2A-9C1B`), Zero ticks which games he may test. Gets test versions of only those games.
- **Developer** (Zero's PC, `developer.json` in the app data folder): My games (accurate status of every game, where it is), This week (goals + to-dos, new plan every Friday 12:00), Publish (Unreleased -> Testers -> Everyone -> Upload, Go back), Testers, Friend games (Approve), AI helper (`claude, ...` / `codex, ...` / `chatgpt, ...` on Zero's PC), Website & host (start website, start with Windows).
- **Friend host** (`friend.json`): makes a signed `.zlsub` game file to send to Zero.

Safety: the game list is signed with Zero's key (players refuse a changed list), every download is SHA-256 checked before it is unpacked, unsafe zip paths are refused, friends' files need Zero's Approve, nothing is released without Zero pressing Release.

## Run
    npm install
    npm test          # core tests
    npm start         # the app

Demo profiles: `node tools/make-demo.js <folder>` then `ZL_USER_DATA=<folder>/dev npm start`.

See docs/SETUP_ON_PC.md for the steps on Zero's PC.

## Rules

The website, port 8443, and existing games stay untouched. Nothing goes public without Zero's yes.
