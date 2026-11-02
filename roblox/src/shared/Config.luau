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

-- Kind = "Coins" amounts scale with the player's rebirths (Amount * (1 + Rebirths)).
Config.Products = {
	{ Key = "CoinPouch", Id = 0, Name = "Coin Pouch", Kind = "Coins", Amount = 5000 },
	{ Key = "CoinVault", Id = 0, Name = "Coin Vault", Kind = "Coins", Amount = 120000 },
	{ Key = "GemPile", Id = 0, Name = "Gem Pile", Kind = "Gems", Amount = 300 },
	{ Key = "GemChest", Id = 0, Name = "Gem Chest", Kind = "Gems", Amount = 2000 },
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
Config.DailyGems = 25
Config.DailyCoins = 1000 -- scaled by (1 + Rebirths)

Config.Codes = {
	ZERO = { Coins = 500 },
	LAUNCH = { Gems = 50 },
	REALMS = { Coins = 2500, Gems = 25 },
} :: { [string]: { Coins: number?, Gems: number? } }

return Config
