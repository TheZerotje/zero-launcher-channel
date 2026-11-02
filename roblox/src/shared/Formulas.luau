--!strict
-- Pure game-math shared by server (authoritative) and client (display).
local Config = require(script.Parent.Config)

local Formulas = {}

export type PetLike = { N: string, G: boolean? }

function Formulas.UpgradeCost(kind: string, level: number): number
	local u = (Config.Upgrades :: any)[kind]
	return math.floor(u.Base * u.Growth ^ level)
end

function Formulas.RebirthCost(rebirths: number): number
	return math.floor(Config.RebirthBaseCost * Config.RebirthGrowth ^ rebirths)
end

function Formulas.WalkSpeed(level: number, vip: boolean): number
	return Config.BaseWalkSpeed + level * Config.Upgrades.Speed.Per + (if vip then 4 else 0)
end

function Formulas.Magnet(level: number, boosted: boolean): number
	return Config.BaseMagnet + level * Config.Upgrades.Magnet.Per + (if boosted then Config.MagnetBoostRange else 0)
end

function Formulas.EquipSlots(hasExtra: boolean): number
	return Config.BaseEquipSlots + (if hasExtra then 2 else 0)
end

function Formulas.PetMult(pet: PetLike): number
	local def = Config.PetIndex[pet.N]
	if not def then
		return 0
	end
	return def.Mult * (if pet.G then Config.GoldenMult else 1)
end

function Formulas.PetMultiplier(pets: { PetLike }): number
	local total = 0
	for _, pet in pets do
		total += Formulas.PetMult(pet)
	end
	return math.max(1, total)
end

-- Rewards stay meaningful as the player progresses.
function Formulas.ScaledCoins(base: number, rebirths: number, zones: number): number
	local zone = Config.Zones[math.clamp(zones, 1, #Config.Zones)]
	return math.floor(base * (1 + rebirths) * zone.OrbValue)
end

function Formulas.TrailBonus(key: string): number
	for _, t in Config.Trails do
		if t.Key == key then
			return t.Bonus
		end
	end
	return 0
end

export type MultInput = {
	Rebirths: number,
	ValueLevel: number,
	Pets: { PetLike },
	DoubleCoins: boolean,
	VIP: boolean,
	CoinBoost: boolean,
	Trail: string,
	Discovered: number,
	Friends: number,
}

function Formulas.CoinMultiplier(i: MultInput): number
	local m = 1 + i.Rebirths * Config.RebirthBonus
	m *= 1 + i.ValueLevel * Config.Upgrades.Value.Per
	m *= Formulas.PetMultiplier(i.Pets)
	m *= 1 + Formulas.TrailBonus(i.Trail) + i.Discovered * Config.IndexBonus
	m *= 1 + math.min(i.Friends, Config.MaxFriendBonus) * Config.FriendBonus
	if i.DoubleCoins then
		m *= 2
	end
	if i.CoinBoost then
		m *= 2
	end
	if i.VIP then
		m *= 1.25
	end
	return m
end

return Formulas
