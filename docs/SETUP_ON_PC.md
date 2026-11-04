# Zero Launcher: steps on Zero's PC (only after Zero says go)

Nothing here changes E:\GameLauncher, any game folder, Tailscale or port 8443.

1. Make E:\ZeroLauncher and copy the code into it (from the project's zero-launcher/app-src).
2. `npm install` in E:\ZeroLauncher (low priority, muted).
3. Make Zero's keys once: `node tools/make-keys.js "%APPDATA%\Zero Launcher"`.
   Back up zero-private.pem (USB stick). Losing it = players can't get new updates until they reinstall.
4. Copy docs\developer.example.json to `%APPDATA%\Zero Launcher\developer.json`, fix paths.
   Read (never change) how E:\GameLauncher starts, and fill website.command/args.
5. Zero makes a PUBLIC GitHub repo `zero-launcher-channel` and a fine-grained token
   (Contents: read/write, only that repo). Token goes ONLY in developer.json on the PC.
6. `npm run dist` makes dist\ZeroLauncherSetup-<version>.exe with Zero's public key inside.
7. Test: open the launcher (Developer), check My games against reality, add Railrove, publish a
   test version as Unreleased, install it on a second Windows user as a player.
8. Turn on "Start with Windows" only when Zero says so.

Known limits (tell Zero):
- Windows shows "Windows protected your PC" for a new unsigned app: More info > Run anyway
  (a code signing certificate removes it but costs money per year).
- Website games load from Zero's PC, so they only work while it is on (same as today).
- Test versions on public GitHub are hidden from normal players, not locked: someone who
  finds the file link could download it.
