# How to send a game to Zero (friend host)

You make games for Zero. This is how you send one. It is safe: nothing reaches players until Zero
checks it, presses **Approve**, and later presses **Release**.

## Once: set up

1. Install Zero Launcher.
2. Zero gives you a small file called `friend.json`. Put it in the Zero Launcher data folder:
   `%APPDATA%\Zero Launcher\friend.json`. It looks like this:

       { "friendId": "sam", "name": "Sam" }

3. Start Zero Launcher. In the menu you now see **Send my game**.
4. Press **Copy my public key**. Send the copied text to Zero (for example on Discord).
   - This is your *public* key. It is safe to share.
   - Your *private* key stays on your PC (`friend-private.pem`). Never send it to anyone.
5. Zero adds you as a friend and picks which game ids you may send.

## Every new version

1. Export your game for Windows into one folder (with the `.exe` in it).
2. Open **Send my game**. Fill in:
   - **Game id**: short, small letters and `-`, for example `sams-game` (Zero tells you which one).
   - **Game name**: the name players see.
   - **Version**: for example `0.2.0`. Use a higher number each time.
   - **What's new**: one short line.
3. Press **Pick build folder & make file** and pick the folder from step 1.
4. The launcher makes a `.zlsub` file in the `to-send` folder. Send that file to Zero.

## What Zero does

1. Zero opens your `.zlsub` file on **Friend games**. The launcher checks your signature.
   A file that was changed, or signed with another key, or for a game you may not send, is refused.
2. Zero presses **Approve**. Your version is now *unreleased*: only Zero sees it.
3. Zero tests it, maybe sends it to testers, and then presses **Release** (with a confirm box).
   Only then do players get it.

## Problems

- "Not a friend host": `friend.json` is missing or in the wrong folder.
- Zero says "refused": check the game id is the one Zero gave you, and that you sent Zero your newest public key.
- Lost your PC? Make new keys on the new PC and send Zero the new public key. Zero adds you again with the new key (same friend id).
