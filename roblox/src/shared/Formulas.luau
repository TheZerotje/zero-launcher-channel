--!strict
-- Pure game-math shared by server (authoritative) and client (display).
local Config = require(script.Parent.Config)

local Formulas = {}

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

function Formulas.Magnet(level: number): number
	return Config.BaseMagnet + level * Config.Upgrades.Magnet.Per
end

function Formulas.EquipSlots(hasExtra: boolean): number
	return Config.BaseEquipSlots + (if hasExtra then 2 else 0)
end

-- pets: array of pet names currently equipped
function Formulas.PetMultiplier(petNames: { string }): number
	local total = 0
	for _, name in petNames do
		local def = Config.PetIndex[name]
		if def then
			total += def.Mult
		end
	end
	return math.max(1, total)
end

export type MultInput = {
	Rebirths: number,
	ValueLevel: number,
	PetNames: { string },
	DoubleCoins: boolean,
	VIP: boolean,
}

function Formulas.CoinMultiplier(i: MultInput): number
	local m = 1 + i.Rebirths * Config.RebirthBonus
	m *= 1 + i.ValueLevel * Config.Upgrades.Value.Per
	m *= Formulas.PetMultiplier(i.PetNames)
	if i.DoubleCoins then
		m *= 2
	end
	if i.VIP then
		m *= 1.25
	end
	return m
end

return Formulas
