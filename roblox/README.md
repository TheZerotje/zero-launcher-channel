# Zero Realms — Roblox Simulator

An original collect, upgrade, pet and rebirth simulator, built to be fun and to earn Robux.

## What's in the game

| Feature | Details |
|---|---|
| 5 worlds | Starter Meadow → Crystal Caves → Lava Peaks → Sky Citadel → Zero Void. Each is behind a gate you buy with Coins. |
| Orbs | Walk near glowing orbs to collect Coins. Big orbs (8% chance) are worth 10x. |
| Upgrades | Speed, Magnet (collect range), Orb Value |
| Pets | 6 eggs and 23 pets in 5 rarities. Equipped pets multiply your Coins and follow you around. |
| Rebirth | Resets your Coins and upgrades. Gives +50% Coins forever, plus Gems. |
| Gems | Earned from rebirths, daily rewards and codes. Spent on the Mythic Egg. |
| Daily reward | Every 20 hours |
| Codes | `ZERO`, `LAUNCH`, `REALMS` (edit these in `Config.luau`) |
| Global leaderboard | Shows the top rebirths on a board at spawn |
| Saving | Uses DataStore, with autosave and save on shutdown |
| Rare hatch alerts | The whole server sees it when someone hatches a Legendary or Mythic pet |

## What you can sell (Robux)

| Item | Type | Suggested price |
|---|---|---|
| 2x Coins | Game Pass | 199 R$ |
| VIP (+25% coins, +4 speed, 2x daily gems) | Game Pass | 249 R$ |
| +2 Pet Slots | Game Pass | 149 R$ |
| Lucky Eggs (2x rare chance) | Game Pass | 299 R$ |
| Coin Pouch / Coin Vault | Developer Product (can be bought again) | 25 / 199 R$ |
| Gem Pile / Gem Chest | Developer Product | 99 / 499 R$ |

Game Passes are bought once. Developer Products can be bought again and again, and that is where
most simulator income comes from.

---

## Step 1 — Get the game into Roblox Studio

1. Install **Roblox Studio** (https://create.roblox.com).
2. Install **Rojo**: https://rojo.space/docs. Add the Rojo plugin in Studio, and get the Rojo CLI
   (download it from the Rojo releases page or run `aftman add rojo-rbx/rojo`).
3. In this `roblox/` folder run:
   ```
   rojo serve
   ```
4. In Studio, create a new **Baseplate** place, open the Rojo plugin and click **Connect**.
5. Press **Play**. The whole map builds itself.

You can also build a place file directly: `rojo build -o ZeroRealms.rbxl`, then open it in Studio.

## Step 2 — Publish it

1. In Studio, choose **File → Publish to Roblox**, then name it and add a description.
2. Go to **Home → Game Settings → Security** and turn on **Enable Studio Access to API Services**.
   Saving and the leaderboard need this.
3. On https://create.roblox.com, open your experience and:
   - Complete the **Maturity & Compliance questionnaire**. This game has no violence or mature
     content, so it should get a low maturity label. That lets the most players see it.
   - Set it to **Public**.
   - Upload an eye-catching **icon** (512×512) and **thumbnails** (1920×1080). Show pets and
     glowing orbs, because thumbnails decide clicks.

## Step 3 — Turn on the money

1. On create.roblox.com, open your experience → **Monetization → Passes**, and create the 4 passes
   (name, image, price).
2. Open **Monetization → Developer Products** and create the 4 products.
3. Copy each **ID** into `src/shared/Config.luau`:
   ```lua
   DoubleCoins = { Id = 123456789, ... },
   ...
   { Key = "CoinPouch", Id = 987654321, ... },
   ```
4. Publish again. The in-game Shop button now shows the real prices and opens the purchase prompt.

Test purchases in Studio are free and don't charge you.

## Step 4 — Get players

- **Ads**: Use create.roblox.com → **Ads Manager** to run sponsored ads. Start small, around
  500–1000 Robux, then check which thumbnail gets the most clicks.
- **Codes**: Post new codes on social media (TikTok, YouTube Shorts, Discord). Players love free
  codes.
- **Updates**: Add a new world and egg every 1–2 weeks. Change one zone and one egg in
  `Config.luau` and the map builds it automatically. Put "UPDATE" in the title.
- **Group**: Create a Roblox group for the game and a Discord server for the community.
- **Analytics**: Check **Analytics → Retention** and **Monetization** to see where players quit.

## Step 5 — Cash out (DevEx)

Roblox keeps a share of each sale (about 30% for passes and products), and you keep the rest as
Robux. To turn Robux into real money, use **Developer Exchange (DevEx)**:
https://create.roblox.com/docs/production/earning-on-roblox/developer-exchange

DevEx has its own requirements: a minimum age, a minimum amount of earned Robux, a verified
account and a good-standing record. Check that page for the current rules. If you're under 18,
ask a parent or guardian to help with the payout and tax forms.

## Tuning the game

Everything is in `src/shared/Config.luau`: zone costs, orb values, egg prices, pet odds,
upgrade costs, rebirth cost, daily rewards and codes. To make the game faster or slower, change
`OrbValue` and the `Cost` numbers.

## Project layout

```
src/shared/Config.luau      all game data and monetization IDs
src/shared/Formulas.luau    economy math (shared by server and client)
src/shared/Format.luau      number formatting (1.5K, 2.3M, ...)
src/server/Main.server.luau game logic, orbs, pets, purchases, leaderboard
src/server/DataService.luau saving and loading
src/server/WorldBuilder.luau builds the map
src/client/UI.client.luau   HUD, menus, shop, popups
src/client/Pets.client.luau pets following players
```
