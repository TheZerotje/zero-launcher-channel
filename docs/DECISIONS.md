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
