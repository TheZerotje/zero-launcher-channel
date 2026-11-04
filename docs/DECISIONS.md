# Decisions made alone (overnight 2026-11-04)

Zero was asleep. When something was unclear I picked the safest simple option and wrote it here.

1. **Code came from E:\ZeroLauncher.** The GitHub repo only had a README. I copied the code once
   (read only) from E:\ZeroLauncher. Not copied: node_modules, dist, the empty channel/ and friends/
   folders, and the Version 2 files (v2.html, v2.js, v2.css) because the rules say not to bring them back.
   Only one .pem was copied: app/keys/zero-public.pem (the PUBLIC key).
2. **The code on the PC is older than the plan says.** package.json says 0.1.0, not 0.2.0. There are
   11 tests, not 12. There is no docs/HOW_TO_FRIEND.md, no game page (what's new, repair, report a problem)
   and no "Logs & reports" page. I worked from what was really there and wrote the missing parts
   where the plan needs them.
3. **Version 2 switch removed.** main.js could still switch to "v2.html". Those files are gone, so the
   switch would show a blank window. I removed the switch. The app always uses the Version 1 look.
4. **Website: status only.** The old code could start the website (button + "autoStart" on launch).
   The rules say: never start the website by itself, status only. I removed both. The Website page now
   only shows if the website is up.
5. **Tests only "release" inside throwaway demo channels.** The plan asks for an app test of
   "add version -> testers -> release -> go back". The rule says never press Release. I read that rule as
   "never release to real players". So the tests make a fresh demo channel in the temp folder, release there,
   and delete nothing real. No test ever talks to GitHub or the real channel.
6. **Developer now sees pulled ("gone back") versions** in Publish, so Zero can see what was pulled.
   Players and testers still never see or get them.
7. **Branch name.** Zero asked for `overnight-<date>`, so the branch is `overnight-2026-11-04` and PR #1.
   The PR is a draft until the end. It is never merged by me.
8. **Fake game for app tests** is a tiny shell script named Game.exe (the app tests run on Linux in CI).
   Zip files do not keep the "may run" flag, so the test sets it after install. The app code is not changed for this.
9. **Game page rebuilt.** The plan says a game page (what's new, repair, report a problem) exists, but it was not
   in the code. I made it: click a game's picture or name. Uninstall moved from the card to the game page, so
   each card has one big obvious button.
10. **"Report a problem" = a small text file + copy.** There is no server. The launcher saves the report
    (game, version, launcher, account ID, text) in the "reports" folder of the app data, and copies it so the
    player can paste it to Zero (for example on Discord). Nothing is sent over the internet by itself.
11. **Dutch is for the player screens.** All player text is in app/renderer/strings.js (English text = key,
    with its Dutch version). A test fails if a player text has no Dutch version. Developer pages
    (only Zero sees them) stay English, like the rules say ("English, Dutch only as an extra option").
12. **Disk space check** guesses a game needs: the zip + 2.5 x the zip (unpacked) + 50 MB. If there is less free
    space the player sees "Not enough free space. This game needs about X MB. You have Y MB free."
13. **Easy font = Atkinson Hyperlegible** (made for low vision readers, SIL Open Font License). The font files
    and licence are in app/renderer/fonts/. Nothing loads from the internet.
14. **Text size** uses page zoom (Normal 100%, Big 115%, Bigger 130%), so every page grows the same way.
15. **Friend host bug fixed:** the "Send my game" page used a developer-only folder picker, so a friend could not
    pick a folder. It now has its own friend-only picker.
16. **Settings from the screen are checked:** only known settings with known values can be changed
    (autoUpdate, notify, easyFont, textSize, lang). The old "installRoot" and "ui" settings can no longer be set
    from the screen.
17. **Godot export works on a temp COPY of the project.** Real Godot writes cache files (.godot folder) while
    exporting. To keep the rule "never change the game folder", the launcher copies the project to a temp
    folder (without .git and old build folders), exports from the copy, and the .exe goes to another temp folder.
    Slower for big projects, but your folder is never touched. Godot runs with --headless --audio-driver Dummy
    at low priority. If the version box is empty, the version from project.godot is used.
18. **"Upload needed"** = the local game list is different from the one at the last successful upload
    (the launcher remembers a fingerprint of the list in uploaded.json). On a fresh PC it says "Upload needed"
    until the first upload.
19. **Week message**: "Your new week plan is ready" shows once when a new week starts (Friday 12:00).
    The very first time the launcher runs it only remembers the week, so you do not get a message for a week
    that was already going.
20. **Git info is read only**: `git log` and `git --no-optional-locks status` (so git does not even refresh its
    index file).
21. **Two tests are skipped on Windows CI only**: the Godot export tests use a fake Godot that is a shell script.
    They run on the Linux CI. This is not to hide a failure.
22. **Every IPC call has an input check** (app/main.js `CHECKS`, helpers in core/validate.js). A call with no
    check is refused, so a new IPC call can't be added without one. Objects from the screen are copied field by
    field (no extra fields pass through).
23. **AI helper on Windows: typed text is now escaped** (core/proc.js). Before, the task text went through
    cmd.exe without quotes, so `&` or `|` in a task could run another command, and spaces split the text.
    Now every argument is quoted and escaped (cross-spawn rules). A test runs a real .cmd tool on the Windows CI
    with nasty text and checks that nothing runs.
24. **Web game windows** may only use full screen and mouse lock (no camera, microphone, location, notifications).
    They cannot attach webviews. ChatGPT window got the same rules and sends outside links to the normal browser.
25. **Website status check now works with https addresses too** (it only knew http before).
26. **Keyboard for Zero**: Ctrl+1..9 opens the menu pages in this order: the 7 developer pages first
    (My games = Ctrl+1, This week = Ctrl+2, Publish = Ctrl+3 …), then Store, Library. Ctrl+F jumps to the search box
    on any page that has one (players too).

## Part 2
27. **Offline**: the last good game list (and its signature) is kept in the app data "cache" folder. It is only
    saved after it passed the signature check, and it is checked again every time it is read. If the internet
    is down, or the channel sends a list that fails the check, the last good list is used. Players see a small
    note "Offline – showing your games from last time". If there is no list at all, installed games are still
    shown in the Library (the game name is now saved at install) and can be played.
28. **Retry**: after a failed check the launcher tries again by itself after 1 minute, then 5 minutes, then
    every 30 minutes, until it works.
29. **News** lives in the signed game list (`news: [{id, title, text, date, image?}]`), max 50 items.
    Title max 80 letters, text max 600. A picture must be an https address (checked when Zero saves and again when
    players load the list). Zero can also remove news.
30. **Game page info** (screenshots, trailer, coming soon date) is in the signed list. Screenshots: up to 12 https
    addresses. Trailer: only YouTube https addresses, and the launcher opens the address from the signed list (the
    screen can't send its own address). Zero edits this in Publish > "Game page" per game.
31. **Store sections**: "New" = game added in the last 30 days (games get an `addedAt` date when Zero adds them;
    older games have none, so they are not "New"). "Recently updated" = its newest version for you is from the
    last 14 days. "Coming soon" = has a coming soon date and nothing to install yet; it shows a countdown and no
    Install button. Sections only show when you are not searching or filtering.
32. **Desktop shortcut** starts Zero Launcher with `--play=<game>`, so the game still starts the normal safe way
    (only a valid game id is accepted). Windows only; on other systems you get a clear message.
33. **Launch options** are saved per installed game (max 300 letters). They are split into words and given to the
    game directly, without a shell, so they can never run other commands.
34. **Tester feedback and crash reports are saved like "Report a problem"**: a text file in the reports folder,
    copied so the tester can paste it to Zero. Nothing goes over the internet by itself. Feedback only works for a
    TEST version (checked in the main process too).
35. **Crash** = the game closed with an error code (not 0) within 2 minutes, or could not start. The player first
    sees "<game> closed with an error", then can press "Show crash report" to read the exact text, and only then
    "Save and copy report" (or "No thanks"). The Godot log is looked up by the game's name and its .exe name under
    %APPDATA%\Godot\app_userdata\ (names with slashes or ".." are ignored); only the last 200 lines are added.
36. **Download numbers** come from the public GitHub release (no token), are kept for 10 minutes, and keep the old
    numbers if GitHub can't be reached. The repo is `github.repo` from developer.json, else
    TheZerotje/zero-launcher-channel. This only READS from GitHub.
37. **Release checklist**: the 5 ticks are saved per game + version (checklists.json). Missing ticks never block, but
    Zero gets a "Some checks are not ticked. Release anyway?" box. After that the normal "Release to EVERYONE?" box
    still comes. Both must be yes.
38. **Key backup** copies the private key to the folder Zero picks, with the date in the name, never overwrites a
    file, and checks the copy. It refuses the channel folder (that gets uploaded!), the friends folder, the app
    folder and the folder where the key already is. A reminder comes once a month while there is no backup from the
    last 30 days.
39. **Discord**: only with `discordWebhook` in developer.json (it must be a real discord.com webhook address). The
    address never goes to the screen or the repo. Zero sees the message, can change it, and only "Send" posts it.
    Posts never ping @everyone or anyone else.
40. **Ctrl+K** (developer): jump to any page or game. Typing "claude, …" or "codex, …" and Enter opens the AI helper
    and starts it in the first AI folder from developer.json.
