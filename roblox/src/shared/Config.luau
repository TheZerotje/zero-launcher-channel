--!strict
-- Zero Realms: all tunable game data lives here.
-- To monetize: create Game Passes / Developer Products on create.roblox.com
-- and paste their IDs below (0 = disabled).

local Config = {}

Config.GameName = "Zero Realms"
Config.DataStoreName = "ZeroRealms_v1"
Config.LeaderboardStoreName = "ZeroRealms_Rebirths_v1"

---------------------------------------------------------------------------
-- MONETIZATION
---------------------------------------------------------------------------
Config.GamePasses = {
	DoubleCoins = { Id = 0, Name = "2x Coins", Description = "Earn double coins forever." },
	VIP = { Id = 0, Name = "VIP", Description = "+25% coins, +4 speed, VIP tag, daily gems x2." },
	ExtraPetSlots = { Id = 0, Name = "+2 Pet Slots", Description = "Equip 2 more pets at once." },
	LuckyHatch = { Id = 0, Name = "Lucky Eggs", Description = "Rare pets are 2x more likely." },
}

-- Kind = "Coins" amounts scale with the player's progress (see Formulas.ScaledCoins).
Config.Products = {
	{ Key = "StarterPack", Id = 0, Name = "STARTER PACK", Kind = "Starter", Description = "1000 Gems + Galaxy Trail + 1h 2x Coins + 3 Spins. One time only!" },
	{ Key = "CoinPouch", Id = 0, Name = "Coin Pouch", Kind = "Coins", Amount = 5000 },
	{ Key = "CoinVault", Id = 0, Name = "Coin Vault", Kind = "Coins", Amount = 120000 },
	{ Key = "GemPile", Id = 0, Name = "Gem Pile", Kind = "Gems", Amount = 300 },
	{ Key = "GemChest", Id = 0, Name = "Gem Chest", Kind = "Gems", Amount = 2000 },
	{ Key = "Boost2x", Id = 0, Name = "2x Coins Boost", Kind = "Boost", Boost = "Coins", Amount = 30 * 60, Description = "30 minutes of double coins" },
	{ Key = "BoostLuck", Id = 0, Name = "Lucky Boost", Kind = "Boost", Boost = "Luck", Amount = 30 * 60, Description = "30 minutes of 2x rare pet chance" },
	{ Key = "Spins5", Id = 0, Name = "5 Wheel Spins", Kind = "Spins", Amount = 5, Description = "5 extra Lucky Wheel spins" },
	{ Key = "RainbowTrail", Id = 0, Name = "Rainbow Trail", Kind = "Trail", Trail = "Rainbow", Description = "Exclusive trail, +15% coins" },
}

---------------------------------------------------------------------------
-- ZONES (placed left -> right, each behind a purchasable gate)
---------------------------------------------------------------------------
export type Zone = {
	Name: string,
	Cost: number,
	OrbValue: number,
	Ground: Color3,
	Orb: Color3,
	Egg: string,
}

Config.ZoneSize = 220
Config.ZoneSpacing = 280
Config.OrbsPerZone = 45

Config.Zones = {
	{ Name = "Starter Meadow", Cost = 0, OrbValue = 1, Ground = Color3.fromRGB(96, 178, 84), Orb = Color3.fromRGB(255, 220, 70), Egg = "Meadow" },
	{ Name = "Crystal Caves", Cost = 5000, OrbValue = 8, Ground = Color3.fromRGB(70, 90, 140), Orb = Color3.fromRGB(120, 230, 255), Egg = "Crystal" },
	{ Name = "Lava Peaks", Cost = 90000, OrbValue = 60, Ground = Color3.fromRGB(70, 40, 35), Orb = Color3.fromRGB(255, 110, 40), Egg = "Lava" },
	{ Name = "Sky Citadel", Cost = 1.5e6, OrbValue = 500, Ground = Color3.fromRGB(230, 235, 245), Orb = Color3.fromRGB(255, 255, 255), Egg = "Sky" },
	{ Name = "Zero Void", Cost = 4e7, OrbValue = 5000, Ground = Color3.fromRGB(25, 15, 40), Orb = Color3.fromRGB(190, 80, 255), Egg = "Void" },
} :: { Zone }

---------------------------------------------------------------------------
-- UPGRADES (cost = Base * Growth ^ level)
---------------------------------------------------------------------------
Config.Upgrades = {
	Speed = { Name = "Speed", Base = 50, Growth = 1.65, Max = 20, Per = 2, Description = "+2 walk speed" },
	Magnet = { Name = "Magnet", Base = 75, Growth = 1.7, Max = 25, Per = 1.5, Description = "+1.5 collect range" },
	Value = { Name = "Orb Value", Base = 100, Growth = 1.8, Max = 40, Per = 0.25, Description = "+25% orb value" },
}
Config.BaseWalkSpeed = 16
Config.BaseMagnet = 7

---------------------------------------------------------------------------
-- REBIRTH
---------------------------------------------------------------------------
Config.RebirthBaseCost = 25000
Config.RebirthGrowth = 4
Config.RebirthBonus = 0.5 -- +50% coins per rebirth
Config.RebirthGems = 15 -- gems = RebirthGems * new rebirth count

---------------------------------------------------------------------------
-- PETS & EGGS
---------------------------------------------------------------------------
export type PetDef = { Name: string, Mult: number, Weight: number, Rarity: string }
export type Egg = { Name: string, Currency: string, Cost: number, Zone: number, Pets: { PetDef } }

Config.MaxPets = 60
Config.BaseEquipSlots = 3

Config.RarityColors = {
	Common = Color3.fromRGB(200, 200, 200),
	Rare = Color3.fromRGB(80, 160, 255),
	Epic = Color3.fromRGB(180, 90, 255),
	Legendary = Color3.fromRGB(255, 190, 40),
	Mythic = Color3.fromRGB(255, 70, 120),
}

Config.Eggs = {
	Meadow = { Name = "Meadow Egg", Currency = "Coins", Cost = 250, Zone = 1, Pets = {
		{ Name = "Puppy", Mult = 1.1, Weight = 50, Rarity = "Common" },
		{ Name = "Kitty", Mult = 1.25, Weight = 30, Rarity = "Rare" },
		{ Name = "Fox", Mult = 1.5, Weight = 15, Rarity = "Epic" },
		{ Name = "Unicorn", Mult = 2.5, Weight = 5, Rarity = "Legendary" },
	} },
	Crystal = { Name = "Crystal Egg", Currency = "Coins", Cost = 6000, Zone = 2, Pets = {
		{ Name = "Cave Bat", Mult = 2, Weight = 50, Rarity = "Common" },
		{ Name = "Rock Golem", Mult = 3, Weight = 30, Rarity = "Rare" },
		{ Name = "Crystal Wolf", Mult = 4.5, Weight = 15, Rarity = "Epic" },
		{ Name = "Gem Dragon", Mult = 8, Weight = 5, Rarity = "Legendary" },
	} },
	Lava = { Name = "Lava Egg", Currency = "Coins", Cost = 100000, Zone = 3, Pets = {
		{ Name = "Imp", Mult = 6, Weight = 50, Rarity = "Common" },
		{ Name = "Magma Slime", Mult = 9, Weight = 30, Rarity = "Rare" },
		{ Name = "Phoenix", Mult = 15, Weight = 15, Rarity = "Epic" },
		{ Name = "Inferno Drake", Mult = 30, Weight = 5, Rarity = "Legendary" },
	} },
	Sky = { Name = "Sky Egg", Currency = "Coins", Cost = 1.8e6, Zone = 4, Pets = {
		{ Name = "Cloud Bunny", Mult = 20, Weight = 50, Rarity = "Common" },
		{ Name = "Griffin", Mult = 35, Weight = 30, Rarity = "Rare" },
		{ Name = "Storm Owl", Mult = 60, Weight = 15, Rarity = "Epic" },
		{ Name = "Seraph", Mult = 120, Weight = 5, Rarity = "Legendary" },
	} },
	Void = { Name = "Void Egg", Currency = "Coins", Cost = 5e7, Zone = 5, Pets = {
		{ Name = "Shade", Mult = 80, Weight = 50, Rarity = "Common" },
		{ Name = "Void Cat", Mult = 150, Weight = 30, Rarity = "Rare" },
		{ Name = "Rift Serpent", Mult = 300, Weight = 15, Rarity = "Epic" },
		{ Name = "Zero Titan", Mult = 750, Weight = 5, Rarity = "Legendary" },
	} },
	Mythic = { Name = "Mythic Egg", Currency = "Gems", Cost = 500, Zone = 1, Pets = {
		{ Name = "Rainbow Spirit", Mult = 40, Weight = 60, Rarity = "Epic" },
		{ Name = "Cosmic Whale", Mult = 200, Weight = 30, Rarity = "Legendary" },
		{ Name = "Galaxy Lord", Mult = 1500, Weight = 10, Rarity = "Mythic" },
	} },
} :: { [string]: Egg }

Config.EggOrder = { "Meadow", "Crystal", "Lava", "Sky", "Void", "Mythic" }

-- Name -> PetDef lookup
Config.PetIndex = {} :: { [string]: PetDef }
for _, egg in Config.Eggs do
	for _, pet in egg.Pets do
		Config.PetIndex[pet.Name] = pet
	end
end

---------------------------------------------------------------------------
-- REWARDS
---------------------------------------------------------------------------
Config.DailyCooldown = 20 * 60 * 60

Config.Codes = {
	ZERO = { Coins = 500 },
	LAUNCH = { Gems = 50 },
	REALMS = { Coins = 2500, Gems = 25 },
} :: { [string]: { Coins: number?, Gems: number? } }

---------------------------------------------------------------------------
-- RETENTION & POWER-UPS
---------------------------------------------------------------------------
export type Reward = { Coins: number?, Gems: number?, Spins: number?, Boost: string?, Seconds: number?, Egg: string? }

-- Timed power-ups. Time only ticks down while the player is in the game.
Config.Boosts = {
	Coins = { Name = "2x Coins", Description = "Double all coins", Duration = 15 * 60, GemCost = 75, Color = Color3.fromRGB(255, 196, 60) },
	Luck = { Name = "Lucky", Description = "2x chance for rare pets", Duration = 15 * 60, GemCost = 100, Color = Color3.fromRGB(80, 230, 120) },
	Magnet = { Name = "Super Magnet", Description = "+12 collect range", Duration = 15 * 60, GemCost = 50, Color = Color3.fromRGB(110, 170, 255) },
}
Config.BoostOrder = { "Coins", "Luck", "Magnet" }
Config.MaxBoostTime = 6 * 60 * 60
Config.MagnetBoostRange = 12

-- Trails (skins). Bought with Gems, or with Robux via a Developer Product.
export type TrailDef = { Key: string, Name: string, Color: ColorSequence, Bonus: number, GemCost: number?, ProductKey: string? }
Config.Trails = {
	{ Key = "Sparkle", Name = "Sparkle", Color = ColorSequence.new(Color3.fromRGB(255, 255, 255), Color3.fromRGB(255, 230, 120)), Bonus = 0.03, GemCost = 150 },
	{ Key = "Ocean", Name = "Ocean", Color = ColorSequence.new(Color3.fromRGB(60, 200, 255), Color3.fromRGB(20, 60, 200)), Bonus = 0.05, GemCost = 400 },
	{ Key = "Inferno", Name = "Inferno", Color = ColorSequence.new(Color3.fromRGB(255, 230, 60), Color3.fromRGB(255, 40, 20)), Bonus = 0.08, GemCost = 1000 },
	{ Key = "Toxic", Name = "Toxic", Color = ColorSequence.new(Color3.fromRGB(180, 255, 60), Color3.fromRGB(30, 120, 30)), Bonus = 0.12, GemCost = 2500 },
	{ Key = "Rainbow", Name = "Rainbow", Color = ColorSequence.new({
		ColorSequenceKeypoint.new(0, Color3.fromRGB(255, 60, 60)),
		ColorSequenceKeypoint.new(0.25, Color3.fromRGB(255, 220, 60)),
		ColorSequenceKeypoint.new(0.5, Color3.fromRGB(60, 255, 120)),
		ColorSequenceKeypoint.new(0.75, Color3.fromRGB(60, 140, 255)),
		ColorSequenceKeypoint.new(1, Color3.fromRGB(200, 60, 255)),
	}), Bonus = 0.15, ProductKey = "RainbowTrail" },
	{ Key = "Galaxy", Name = "Galaxy", Color = ColorSequence.new(Color3.fromRGB(255, 120, 230), Color3.fromRGB(40, 0, 120)), Bonus = 0.2, ProductKey = "StarterPack" },
} :: { TrailDef }

-- 7-day login streak. Missing more than StreakGrace resets it to day 1.
Config.StreakGrace = 48 * 60 * 60
Config.StreakRewards = {
	{ Gems = 10, Coins = 300 },
	{ Gems = 15, Coins = 600 },
	{ Gems = 20, Spins = 1 },
	{ Gems = 30, Coins = 1500 },
	{ Gems = 40, Boost = "Magnet", Seconds = 30 * 60 },
	{ Gems = 60, Spins = 2 },
	{ Gems = 150, Boost = "Coins", Seconds = 60 * 60 },
} :: { Reward }

-- Playtime gifts (reset every session). Keeps players in the game longer.
Config.Gifts = {
	{ Minutes = 1, Coins = 200 },
	{ Minutes = 3, Gems = 10 },
	{ Minutes = 6, Coins = 1000 },
	{ Minutes = 10, Boost = "Magnet", Seconds = 10 * 60 },
	{ Minutes = 15, Gems = 25 },
	{ Minutes = 20, Spins = 1 },
	{ Minutes = 30, Coins = 8000 },
	{ Minutes = 45, Boost = "Coins", Seconds = 15 * 60 },
	{ Minutes = 60, Gems = 100 },
} :: { Reward & { Minutes: number } }

-- Daily quests: QuestsPerDay random picks, reset at 00:00 UTC.
Config.QuestsPerDay = 3
Config.QuestTemplates = {
	{ Kind = "Orbs", Text = "Collect %d orbs", Goal = 400, Gems = 25 },
	{ Kind = "BigOrbs", Text = "Collect %d big orbs", Goal = 25, Gems = 25 },
	{ Kind = "Hatch", Text = "Hatch %d eggs", Goal = 10, Gems = 30 },
	{ Kind = "Upgrade", Text = "Buy %d upgrades", Goal = 10, Gems = 20 },
	{ Kind = "Spin", Text = "Spin the Lucky Wheel %d time(s)", Goal = 1, Gems = 15 },
	{ Kind = "Playtime", Text = "Play for %d minutes", Goal = 20, Gems = 30 },
	{ Kind = "Golden", Text = "Make %d golden pet(s)", Goal = 1, Gems = 40 },
}
Config.QuestBonus = { Spins = 1, Gems = 25 } :: Reward -- for finishing all daily quests

-- Lucky Wheel: one free spin every WheelCooldown, extra spins from gifts/streak/Robux.
-- Odds are shown in-game (required by Roblox for paid random items).
Config.WheelCooldown = 4 * 60 * 60
Config.Wheel = {
	{ Name = "Coin Stack", Weight = 35, Coins = 2000 },
	{ Name = "Coin Mountain", Weight = 15, Coins = 10000 },
	{ Name = "25 Gems", Weight = 22, Gems = 25 },
	{ Name = "100 Gems", Weight = 6, Gems = 100 },
	{ Name = "2x Coins 10m", Weight = 10, Boost = "Coins", Seconds = 600 },
	{ Name = "Lucky 10m", Weight = 7, Boost = "Luck", Seconds = 600 },
	{ Name = "Free Mythic Egg", Weight = 5, Egg = "Mythic" },
} :: { Reward & { Name: string, Weight: number } }

-- Long-term goals
Config.GoldenCost = 5 -- combine 5 of the same pet...
Config.GoldenMult = 3 -- ...into a golden one with 3x power
Config.IndexBonus = 0.02 -- +2% coins for every pet species discovered
Config.FriendBonus = 0.1 -- +10% coins per friend in the server
Config.MaxFriendBonus = 4

return Config
