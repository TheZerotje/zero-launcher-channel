# Zero Launcher: rules for every AI (and person) working here

Read these first. Never break them.

=====================================================================
1. RULES (never break these)
=====================================================================
WHAT IT IS
- Zero Launcher = one Windows desktop app (Electron + Node) for all of Zero's games, a bit like Steam.
- 3 kinds of people: DEVELOPER (Zero, developer.json present: sees everything + tools), TESTER (an account whose ID
  Zero ticked for some games: gets test versions of ONLY those games), USER (released games only).
- FRIEND HOST: a friend who makes games for Zero. He sends a signed .zlsub file; nothing reaches players until Zero
  presses Approve and then Release.
- Game list ("catalogue") is signed with Zero's Ed25519 key. Players refuse a list with a wrong signature.
  Every download is SHA-256 checked BEFORE it is unpacked. Zip paths with ../ are refused. Keep all of this.
- Release states: unreleased -> testing -> released (+ pulled = "go back"). Updates install by themselves.
- Downloads come from the PUBLIC GitHub repo TheZerotje/zero-launcher-channel, release tag "channel".
- Zero picked the "Version 1" look (left sidebar, dark). Keep it. Do not bring back the Version 2 files.

NEVER
- Never put secrets in the repo: no private keys, no tokens, no passwords. Private keys stay on Zero's PC only.
- Never publish, release, or upload anything to players or to the channel repo. Never press Release in code or tests.
- Never touch Zero's website folder E:\GameLauncher (read only), Tailscale, Funnel, or port 8443.
- Never make the launcher start the website by itself (its start file touches Tailscale/8443). Status only.
- SOUND: never change system volume, mute, or audio device; never play sound in tests. Tests run muted/headless
  (set ZL_MUTE=1; Godot --headless or --audio-driver Dummy; browsers --mute-audio).
- Never close programs you did not start. Never kill processes by PID alone.
- Never remove or weaken a safety check (signature, checksum, zip-slip, Approve, Release confirm, IPC guards).
- Never skip, delete or weaken a test to make things pass.

HOW
- All text in the app: English, very simple short words (Zero and many players have dyslexia). Dutch only as an
  extra language option.
- Players: super super user friendly. One big obvious button per game. No tech words.
- Zero (developer): very developer friendly. Fast, clear, everything in one place.
- Small steps. Every step ends with a test that you RUN. Add tests for new code.
- Keep it simple and stable over fancy. No new big frameworks. No outside scripts or fonts from the internet
  in the app (bundle what you need).
- At the end write docs/MORNING_REPORT.md (see section 4).
