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
