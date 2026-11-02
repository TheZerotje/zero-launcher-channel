--!strict
-- Zero Realms server entry point: world, orbs, economy, pets, retention, monetization.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local MarketplaceService = game:GetService("MarketplaceService")
local DataStoreService = game:GetService("DataStoreService")
local PolicyService = game:GetService("PolicyService")
local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared.Config)
local Formulas = require(Shared.Formulas)
local Format = require(Shared.Format)

local DataService = require(script.Parent.DataService)
local WorldBuilder = require(script.Parent.WorldBuilder)

type Profile = DataService.Profile
type Pet = DataService.Pet

---------------------------------------------------------------------------
-- Remotes
---------------------------------------------------------------------------
local remotes = Instance.new("Folder")
remotes.Name = "Remotes"
local function remote(className: string, name: string): any
	local r = Instance.new(className)
	r.Name = name
	r.Parent = remotes
	return r
end
local Request = remote("RemoteFunction", "Request") :: RemoteFunction
local Sync = remote("RemoteEvent", "Sync") :: RemoteEvent
local Notify = remote("RemoteEvent", "Notify") :: RemoteEvent
local Collected = remote("RemoteEvent", "Collected") :: RemoteEvent
local Hatched = remote("RemoteEvent", "Hatched") :: RemoteEvent
local WheelResult = remote("RemoteEvent", "WheelResult") :: RemoteEvent
remotes.Parent = ReplicatedStorage

WorldBuilder.Build()

---------------------------------------------------------------------------
-- Per-player runtime state
---------------------------------------------------------------------------
type Passes = { DoubleCoins: boolean, VIP: boolean, ExtraPetSlots: boolean, LuckyHatch: boolean }
local passes: { [Player]: Passes } = {}
local dirty: { [Player]: boolean } = {}
local lastRequest: { [Player]: number } = {}
local sessionStart: { [Player]: number } = {}
local secondsPlayed: { [Player]: number } = {}
local giftsClaimed: { [Player]: { [number]: boolean } } = {}
local friendPairs: { [Player]: { [Player]: boolean } } = {}
local friendCount: { [Player]: number } = {}
local restricted: { [Player]: boolean } = {}

local function notify(player: Player, text: string, kind: string?)
	Notify:FireClient(player, text, kind or "info")
end

local function markDirty(player: Player)
	dirty[player] = true
end

local function hasPass(player: Player, key: string): boolean
	local p = passes[player]
	return p ~= nil and (p :: any)[key] == true
end

local function equippedPets(profile: Profile): { Pet }
	local byId: { [string]: Pet } = {}
	for _, pet in profile.Pets do
		byId[pet.Id] = pet
	end
	local list = {}
	for _, id in profile.Equipped do
		local pet = byId[id]
		if pet then
			table.insert(list, pet)
		end
	end
	return list
end

local function discoveredCount(profile: Profile): number
	local n = 0
	for name in profile.Discovered do
		if Config.PetIndex[name] then
			n += 1
		end
	end
	return n
end

local function coinMultiplier(player: Player, profile: Profile): number
	return Formulas.CoinMultiplier({
		Rebirths = profile.Rebirths,
		ValueLevel = profile.Upgrades.Value,
		Pets = equippedPets(profile),
		DoubleCoins = hasPass(player, "DoubleCoins"),
		VIP = hasPass(player, "VIP"),
		CoinBoost = profile.Boosts.Coins > 0,
		Trail = profile.Trail,
		Discovered = discoveredCount(profile),
		Friends = friendCount[player] or 0,
	})
end

local function scaledCoins(profile: Profile, base: number): number
	return Formulas.ScaledCoins(base, profile.Rebirths, profile.Zones)
end

local function addCoins(player: Player, profile: Profile, amount: number)
	profile.Coins += amount
	profile.TotalCoins += amount
	markDirty(player)
end

local function applyCharacterStats(player: Player)
	local profile = DataService.Get(player)
	local character = player.Character
	local hum = character and character:FindFirstChildOfClass("Humanoid")
	if profile and hum then
		hum.WalkSpeed = Formulas.WalkSpeed(profile.Upgrades.Speed, hasPass(player, "VIP"))
	end
end

---------------------------------------------------------------------------
-- Trails (skins)
---------------------------------------------------------------------------
local function trailDef(key: string): Config.TrailDef?
	for _, t in Config.Trails do
		if t.Key == key then
			return t
		end
	end
	return nil
end

local function applyTrail(player: Player)
	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart")
	if not root then
		return
	end
	for _, name in { "ZeroTrail", "ZeroTrailA0", "ZeroTrailA1" } do
		local old = root:FindFirstChild(name)
		if old then
			old:Destroy()
		end
	end
	local profile = DataService.Get(player)
	local def = profile and trailDef(profile.Trail)
	if not def then
		return
	end
	local a0 = Instance.new("Attachment")
	a0.Name = "ZeroTrailA0"
	a0.Position = Vector3.new(0, 0.9, 0)
	a0.Parent = root
	local a1 = Instance.new("Attachment")
	a1.Name = "ZeroTrailA1"
	a1.Position = Vector3.new(0, -0.9, 0)
	a1.Parent = root
	local trail = Instance.new("Trail")
	trail.Name = "ZeroTrail"
	trail.Attachment0 = a0
	trail.Attachment1 = a1
	trail.Color = def.Color
	trail.Lifetime = 0.7
	trail.LightEmission = 0.7
	trail.Transparency = NumberSequence.new(0.1, 1)
	trail.WidthScale = NumberSequence.new(1, 0.2)
	trail.Parent = root
end

---------------------------------------------------------------------------
-- Quests
---------------------------------------------------------------------------
local function ensureQuests(player: Player, profile: Profile)
	local day = os.time() // 86400
	if profile.Quests.Day == day then
		return
	end
	local rng = Random.new(day * 7919 + player.UserId % 100000)
	local pool = {}
	for i = 1, #Config.QuestTemplates do
		pool[i] = i
	end
	local list = {}
	for _ = 1, math.min(Config.QuestsPerDay, #pool) do
		local idx = table.remove(pool, rng:NextInteger(1, #pool)) :: number
		table.insert(list, { T = idx, P = 0, C = false })
	end
	profile.Quests = { Day = day, List = list, Bonus = false }
	markDirty(player)
end

local function progressQuest(player: Player, profile: Profile, kind: string, amount: number)
	ensureQuests(player, profile)
	for _, q in profile.Quests.List do
		local t = Config.QuestTemplates[q.T]
		if t and t.Kind == kind and q.P < t.Goal then
			q.P = math.min(t.Goal, q.P + amount)
			if q.P >= t.Goal then
				notify(player, "Quest complete: " .. string.format(t.Text, t.Goal) .. "! Claim it in Quests.", "success")
			end
			markDirty(player)
		end
	end
end

---------------------------------------------------------------------------
-- Boosts & rewards
---------------------------------------------------------------------------
local function addBoost(player: Player, profile: Profile, key: string, seconds: number)
	local b = profile.Boosts :: any
	if type(b[key]) ~= "number" then
		return
	end
	b[key] = math.min(Config.MaxBoostTime, b[key] + seconds)
	markDirty(player)
end

local hatch: (Player, Profile, string, boolean?) -> (boolean, string?)

local function grant(player: Player, profile: Profile, reward: Config.Reward): string
	local parts = {}
	if reward.Coins then
		local c = scaledCoins(profile, reward.Coins)
		addCoins(player, profile, c)
		table.insert(parts, "+" .. Format.Number(c) .. " Coins")
	end
	if reward.Gems then
		profile.Gems += reward.Gems
		table.insert(parts, "+" .. Format.Number(reward.Gems) .. " Gems")
	end
	if reward.Spins then
		profile.Spins += reward.Spins
		table.insert(parts, "+" .. reward.Spins .. " Spin" .. (if reward.Spins > 1 then "s" else ""))
	end
	if reward.Boost and reward.Seconds then
		addBoost(player, profile, reward.Boost, reward.Seconds)
		table.insert(parts, (Config.Boosts :: any)[reward.Boost].Name .. " " .. (reward.Seconds // 60) .. "m")
	end
	if reward.Egg then
		local eggKey = reward.Egg
		table.insert(parts, "Free " .. Config.Eggs[eggKey].Name)
		task.delay(3.2, function()
			local p = DataService.Get(player)
			if p and not hatch(player, p, eggKey, true) then
				p.Gems += 100
				notify(player, "Pet inventory full: got +100 Gems instead", "info")
				markDirty(player)
			end
		end)
	end
	markDirty(player)
	return table.concat(parts, ", ")
end

---------------------------------------------------------------------------
-- Sync to client
---------------------------------------------------------------------------
local function syncPayload(player: Player, profile: Profile)
	local p = passes[player] or { DoubleCoins = false, VIP = false, ExtraPetSlots = false, LuckyHatch = false }
	local quests = {}
	for _, q in profile.Quests.List do
		local t = Config.QuestTemplates[q.T]
		if t then
			table.insert(quests, { Text = string.format(t.Text, t.Goal), Goal = t.Goal, P = q.P, Gems = t.Gems, C = q.C })
		end
	end
	local gifts = {}
	for i in Config.Gifts do
		gifts[i] = (giftsClaimed[player] or {})[i] == true
	end
	return {
		Coins = profile.Coins,
		Gems = profile.Gems,
		Rebirths = profile.Rebirths,
		Hatched = profile.Hatched,
		Upgrades = profile.Upgrades,
		Zones = profile.Zones,
		Pets = profile.Pets,
		Equipped = profile.Equipped,
		LastDaily = profile.LastDaily,
		Streak = profile.Streak,
		ServerTime = os.time(),
		Passes = p,
		Multiplier = coinMultiplier(player, profile),
		Slots = Formulas.EquipSlots(p.ExtraPetSlots),
		Boosts = profile.Boosts,
		Trails = profile.Trails,
		Trail = profile.Trail,
		Spins = profile.Spins,
		LastFreeSpin = profile.LastFreeSpin,
		Quests = quests,
		QuestBonus = profile.Quests.Bonus,
		SessionTime = os.clock() - (sessionStart[player] or os.clock()),
		Gifts = gifts,
		Discovered = profile.Discovered,
		Friends = friendCount[player] or 0,
		StarterPack = profile.StarterPack,
		Restricted = restricted[player] == true,
	}
end

local function flush(player: Player)
	dirty[player] = nil
	local profile = DataService.Get(player)
	if not profile then
		return
	end
	Sync:FireClient(player, syncPayload(player, profile))
	local stats = player:FindFirstChild("leaderstats")
	if stats then
		(stats:FindFirstChild("Coins") :: StringValue).Value = Format.Number(profile.Coins);
		(stats:FindFirstChild("Rebirths") :: IntValue).Value = profile.Rebirths
	end
	local names = {}
	for _, pet in equippedPets(profile) do
		table.insert(names, pet.N .. (if pet.G then "*" else ""))
	end
	player:SetAttribute("EquippedPets", table.concat(names, ","))
	player:SetAttribute("Zones", profile.Zones)
end

task.spawn(function()
	while true do
		task.wait(0.25)
		for player in dirty do
			flush(player)
		end
	end
end)

-- 1-second tick: boosts count down while online, playtime quests, day rollover.
task.spawn(function()
	while true do
		task.wait(1)
		for _, player in Players:GetPlayers() do
			local profile = DataService.Get(player)
			if not profile then
				continue
			end
			local b = profile.Boosts :: any
			for _, key in Config.BoostOrder do
				if b[key] > 0 then
					b[key] = math.max(0, b[key] - 1)
					if b[key] == 0 then
						notify(player, (Config.Boosts :: any)[key].Name .. " boost ended. Get more in Boosts!", "info")
						markDirty(player)
					end
				end
			end
			secondsPlayed[player] = (secondsPlayed[player] or 0) + 1
			if secondsPlayed[player] % 60 == 0 then
				progressQuest(player, profile, "Playtime", 1)
			end
		end
	end
end)

---------------------------------------------------------------------------
-- Orbs
---------------------------------------------------------------------------
type Orb = { Part: BasePart, Zone: number, Active: boolean, Value: number, Big: boolean }
local orbsByZone: { [number]: { Orb } } = {}

local function placeOrb(orb: Orb)
	local big = math.random() < 0.08
	orb.Big = big
	orb.Value = Config.Zones[orb.Zone].OrbValue * (if big then 10 else 1)
	orb.Part.Size = if big then Vector3.new(3.2, 3.2, 3.2) else Vector3.new(1.8, 1.8, 1.8)
	orb.Part.Position = WorldBuilder.RandomOrbPosition(orb.Zone)
	orb.Part.Transparency = 0
	orb.Active = true
end

for zoneIndex, zone in Config.Zones do
	local list = {}
	for _ = 1, Config.OrbsPerZone do
		local p = Instance.new("Part")
		p.Name = "Orb"
		p.Shape = Enum.PartType.Ball
		p.Anchored = true
		p.CanCollide = false
		p.CanQuery = false
		p.CanTouch = false
		p.Material = Enum.Material.Neon
		p.Color = zone.Orb
		p.CastShadow = false
		p.Parent = WorldBuilder.OrbFolders[zoneIndex]
		local orb: Orb = { Part = p, Zone = zoneIndex, Active = false, Value = 0, Big = false }
		placeOrb(orb)
		table.insert(list, orb)
	end
	orbsByZone[zoneIndex] = list
end

local COLLECT_INTERVAL = 0.12
local collectAccum = 0
RunService.Heartbeat:Connect(function(dt)
	collectAccum += dt
	if collectAccum < COLLECT_INTERVAL then
		return
	end
	collectAccum = 0
	for _, player in Players:GetPlayers() do
		local profile = DataService.Get(player)
		local character = player.Character
		local root = character and character:FindFirstChild("HumanoidRootPart") :: BasePart?
		if not profile or not root then
			continue
		end
		local pos = root.Position
		local zoneIndex = WorldBuilder.ZoneAt(pos)
		if zoneIndex > profile.Zones then
			continue -- anti-exploit: locked zone
		end
		local radius = Formulas.Magnet(profile.Upgrades.Magnet, profile.Boosts.Magnet > 0)
		local gained, count, bigCount = 0, 0, 0
		for _, orb in orbsByZone[zoneIndex] do
			if orb.Active and (orb.Part.Position - pos).Magnitude <= radius then
				orb.Active = false
				orb.Part.Transparency = 1
				gained += orb.Value
				count += 1
				if orb.Big then
					bigCount += 1
				end
				task.delay(math.random(30, 70) / 10, placeOrb, orb)
			end
		end
		if count > 0 then
			local amount = math.floor(gained * coinMultiplier(player, profile))
			addCoins(player, profile, amount)
			Collected:FireClient(player, amount, count)
			progressQuest(player, profile, "Orbs", count)
			if bigCount > 0 then
				progressQuest(player, profile, "BigOrbs", bigCount)
			end
		end
	end
end)

---------------------------------------------------------------------------
-- Pets
---------------------------------------------------------------------------
local function rollPet(eggKey: string, luck: number): Config.PetDef
	local egg = Config.Eggs[eggKey]
	local total = 0
	local weights = {}
	for i, pet in egg.Pets do
		local w = pet.Weight * (if i > 1 then luck else 1)
		weights[i] = w
		total += w
	end
	local roll = math.random() * total
	for i, pet in egg.Pets do
		roll -= weights[i]
		if roll <= 0 then
			return pet
		end
	end
	return egg.Pets[#egg.Pets]
end

local function equipBest(player: Player, profile: Profile)
	local slots = Formulas.EquipSlots(hasPass(player, "ExtraPetSlots"))
	local sorted = table.clone(profile.Pets)
	table.sort(sorted, function(a, b)
		return Formulas.PetMult(a) > Formulas.PetMult(b)
	end)
	profile.Equipped = {}
	for i = 1, math.min(slots, #sorted) do
		table.insert(profile.Equipped, sorted[i].Id)
	end
	markDirty(player)
end

hatch = function(player: Player, profile: Profile, eggKey: string, free: boolean?): (boolean, string?)
	local egg = Config.Eggs[eggKey]
	if not egg then
		return false, "Unknown egg"
	end
	if not free then
		if egg.Zone > profile.Zones then
			return false, "Unlock " .. Config.Zones[egg.Zone].Name .. " first!"
		end
		if egg.Currency == "Gems" and restricted[player] then
			return false, "This egg isn't available in your region."
		end
	end
	if #profile.Pets >= Config.MaxPets then
		return false, "Pet inventory full! Delete pets or make them golden."
	end
	if not free then
		if egg.Currency == "Gems" then
			if profile.Gems < egg.Cost then
				return false, "Not enough Gems!"
			end
			profile.Gems -= egg.Cost
		else
			if profile.Coins < egg.Cost then
				return false, "Not enough Coins!"
			end
			profile.Coins -= egg.Cost
		end
	end
	local luck = (if hasPass(player, "LuckyHatch") then 2 else 1) * (if profile.Boosts.Luck > 0 then 2 else 1)
	local pet = rollPet(eggKey, luck)
	local entry: Pet = { Id = HttpService:GenerateGUID(false), N = pet.Name }
	table.insert(profile.Pets, entry)
	profile.Hatched += 1
	local isNew = not profile.Discovered[pet.Name]
	profile.Discovered[pet.Name] = true

	local slots = Formulas.EquipSlots(hasPass(player, "ExtraPetSlots"))
	if #profile.Equipped < slots then
		table.insert(profile.Equipped, entry.Id)
	else
		equipBest(player, profile)
	end
	markDirty(player)
	Hatched:FireClient(player, pet.Name, pet.Rarity, pet.Mult, isNew)
	if isNew then
		notify(player, string.format("New pet discovered! Index bonus +%d%%", math.floor(Config.IndexBonus * 100)), "success")
	end
	if pet.Rarity == "Legendary" or pet.Rarity == "Mythic" then
		for _, other in Players:GetPlayers() do
			notify(other, string.format("%s hatched a %s %s!", player.DisplayName, pet.Rarity, pet.Name), "rare")
		end
	end
	progressQuest(player, profile, "Hatch", 1)
	return true, nil
end

---------------------------------------------------------------------------
-- Actions
---------------------------------------------------------------------------
local function tryUnlockZone(player: Player, profile: Profile): (boolean, string?)
	local nextIndex = profile.Zones + 1
	local zone = Config.Zones[nextIndex]
	if not zone then
		return false, "All zones unlocked!"
	end
	if profile.Coins < zone.Cost then
		return false, "Need " .. Format.Number(zone.Cost) .. " Coins"
	end
	profile.Coins -= zone.Cost
	profile.Zones = nextIndex
	markDirty(player)
	notify(player, "Unlocked " .. zone.Name .. "!", "success")
	return true, nil
end

local Actions: { [string]: (Player, Profile, any) -> (boolean, string?) } = {}

Actions.Upgrade = function(player, profile, kind)
	local def = (Config.Upgrades :: any)[kind]
	if type(kind) ~= "string" or not def then
		return false, "Bad upgrade"
	end
	local level = (profile.Upgrades :: any)[kind] :: number
	if level >= def.Max then
		return false, "Maxed!"
	end
	local cost = Formulas.UpgradeCost(kind, level)
	if profile.Coins < cost then
		return false, "Not enough Coins!"
	end
	profile.Coins -= cost;
	(profile.Upgrades :: any)[kind] = level + 1
	markDirty(player)
	applyCharacterStats(player)
	progressQuest(player, profile, "Upgrade", 1)
	return true, nil
end

Actions.Rebirth = function(player, profile)
	local cost = Formulas.RebirthCost(profile.Rebirths)
	if profile.Coins < cost then
		return false, "Need " .. Format.Number(cost) .. " Coins to rebirth"
	end
	profile.Rebirths += 1
	profile.Coins = 0
	profile.Upgrades = { Speed = 0, Magnet = 0, Value = 0 }
	profile.Gems += Config.RebirthGems * profile.Rebirths
	markDirty(player)
	applyCharacterStats(player)
	notify(player, string.format("Rebirth %d! +%s Gems", profile.Rebirths, Format.Number(Config.RebirthGems * profile.Rebirths)), "success")
	return true, nil
end

Actions.UnlockZone = function(player, profile)
	return tryUnlockZone(player, profile)
end

Actions.Hatch = function(player, profile, eggKey)
	if type(eggKey) ~= "string" then
		return false, "Bad egg"
	end
	return hatch(player, profile, eggKey)
end

Actions.Equip = function(player, profile, id)
	if type(id) ~= "string" then
		return false, nil
	end
	local found = false
	for _, pet in profile.Pets do
		if pet.Id == id then
			found = true
			break
		end
	end
	if not found or table.find(profile.Equipped, id) then
		return false, nil
	end
	if #profile.Equipped >= Formulas.EquipSlots(hasPass(player, "ExtraPetSlots")) then
		return false, "All pet slots full!"
	end
	table.insert(profile.Equipped, id)
	markDirty(player)
	return true, nil
end

Actions.Unequip = function(player, profile, id)
	local i = table.find(profile.Equipped, id)
	if i then
		table.remove(profile.Equipped, i)
		markDirty(player)
	end
	return true, nil
end

Actions.EquipBest = function(player, profile)
	equipBest(player, profile)
	return true, nil
end

Actions.DeletePet = function(player, profile, id)
	for i, pet in profile.Pets do
		if pet.Id == id then
			table.remove(profile.Pets, i)
			local e = table.find(profile.Equipped, id)
			if e then
				table.remove(profile.Equipped, e)
			end
			markDirty(player)
			return true, nil
		end
	end
	return false, nil
end

Actions.MakeGolden = function(player, profile, name)
	if type(name) ~= "string" or not Config.PetIndex[name] then
		return false, nil
	end
	-- prefer using unequipped copies
	local candidates: { Pet } = {}
	for _, pet in profile.Pets do
		if pet.N == name and not pet.G then
			table.insert(candidates, pet)
		end
	end
	if #candidates < Config.GoldenCost then
		return false, string.format("Need %d %s to make a golden one", Config.GoldenCost, name)
	end
	table.sort(candidates, function(a, b)
		local ea = table.find(profile.Equipped, a.Id) ~= nil
		local eb = table.find(profile.Equipped, b.Id) ~= nil
		return (not ea) and eb
	end)
	for i = 1, Config.GoldenCost do
		local id = candidates[i].Id
		for j, pet in profile.Pets do
			if pet.Id == id then
				table.remove(profile.Pets, j)
				break
			end
		end
		local e = table.find(profile.Equipped, id)
		if e then
			table.remove(profile.Equipped, e)
		end
	end
	table.insert(profile.Pets, { Id = HttpService:GenerateGUID(false), N = name, G = true })
	equipBest(player, profile)
	progressQuest(player, profile, "Golden", 1)
	notify(player, "Created Golden " .. name .. "!", "rare")
	return true, nil
end

Actions.Redeem = function(player, profile, code)
	if type(code) ~= "string" then
		return false, "Invalid code"
	end
	code = string.upper((code:gsub("%s", "")))
	local reward = Config.Codes[code]
	if not reward then
		return false, "Invalid code"
	end
	if profile.Codes[code] then
		return false, "Already redeemed"
	end
	profile.Codes[code] = true
	if reward.Coins then
		addCoins(player, profile, reward.Coins)
	end
	if reward.Gems then
		profile.Gems += reward.Gems
	end
	markDirty(player)
	notify(player, "Code redeemed!", "success")
	return true, nil
end

Actions.ClaimDaily = function(player, profile)
	local now = os.time()
	local elapsed = now - profile.LastDaily
	if elapsed < Config.DailyCooldown then
		return false, "Come back in " .. Format.Time(Config.DailyCooldown - elapsed)
	end
	if profile.LastDaily ~= 0 and elapsed > Config.StreakGrace then
		profile.Streak = 0
		notify(player, "Streak lost! Come back every day to keep it.", "error")
	end
	profile.Streak = profile.Streak % #Config.StreakRewards + 1
	profile.LastDaily = now
	local reward = table.clone(Config.StreakRewards[profile.Streak])
	if reward.Gems and hasPass(player, "VIP") then
		reward.Gems *= 2
	end
	local text = grant(player, profile, reward)
	notify(player, string.format("Day %d reward: %s", profile.Streak, text), "success")
	return true, nil
end

Actions.ClaimGift = function(player, profile, index)
	local gift = type(index) == "number" and Config.Gifts[index]
	if not gift then
		return false, nil
	end
	local claimed = giftsClaimed[player]
	if not claimed or claimed[index] then
		return false, "Already claimed"
	end
	if os.clock() - (sessionStart[player] or os.clock()) < gift.Minutes * 60 then
		return false, "Not ready yet!"
	end
	claimed[index] = true
	notify(player, "Gift: " .. grant(player, profile, gift), "success")
	return true, nil
end

Actions.ClaimQuest = function(player, profile, index)
	ensureQuests(player, profile)
	local q = type(index) == "number" and profile.Quests.List[index]
	if not q then
		return false, nil
	end
	local t = Config.QuestTemplates[q.T]
	if q.C or q.P < t.Goal then
		return false, "Quest not finished yet"
	end
	q.C = true
	profile.Gems += t.Gems
	notify(player, "Quest reward: +" .. t.Gems .. " Gems", "success")
	local allDone = true
	for _, other in profile.Quests.List do
		if not other.C then
			allDone = false
		end
	end
	if allDone and not profile.Quests.Bonus then
		profile.Quests.Bonus = true
		notify(player, "All daily quests done! Bonus: " .. grant(player, profile, Config.QuestBonus), "rare")
	end
	markDirty(player)
	return true, nil
end

Actions.Spin = function(player, profile)
	local now = os.time()
	if now - profile.LastFreeSpin >= Config.WheelCooldown then
		profile.LastFreeSpin = now
	elseif profile.Spins > 0 then
		profile.Spins -= 1
	else
		return false, "Next free spin in " .. Format.Time(Config.WheelCooldown - (now - profile.LastFreeSpin))
	end
	local total = 0
	for _, seg in Config.Wheel do
		total += seg.Weight
	end
	local roll = math.random() * total
	local index = #Config.Wheel
	for i, seg in Config.Wheel do
		roll -= seg.Weight
		if roll <= 0 then
			index = i
			break
		end
	end
	local text = grant(player, profile, Config.Wheel[index])
	progressQuest(player, profile, "Spin", 1)
	WheelResult:FireClient(player, index, text)
	return true, nil
end

Actions.BuyBoost = function(player, profile, key)
	local def = type(key) == "string" and (Config.Boosts :: any)[key]
	if not def then
		return false, nil
	end
	if profile.Gems < def.GemCost then
		return false, "Not enough Gems!"
	end
	if (profile.Boosts :: any)[key] + def.Duration > Config.MaxBoostTime then
		return false, "Boost time is maxed out"
	end
	profile.Gems -= def.GemCost
	addBoost(player, profile, key, def.Duration)
	notify(player, def.Name .. " activated!", "success")
	return true, nil
end

Actions.BuyTrail = function(player, profile, key)
	local def = type(key) == "string" and trailDef(key)
	if not def or not def.GemCost then
		return false, nil
	end
	if profile.Trails[key] then
		return false, "Already owned"
	end
	if profile.Gems < def.GemCost then
		return false, "Not enough Gems!"
	end
	profile.Gems -= def.GemCost
	profile.Trails[key] = true
	profile.Trail = key
	applyTrail(player)
	markDirty(player)
	notify(player, def.Name .. " trail unlocked!", "success")
	return true, nil
end

Actions.EquipTrail = function(player, profile, key)
	if key == "" then
		profile.Trail = ""
	elseif type(key) == "string" and profile.Trails[key] then
		profile.Trail = key
	else
		return false, nil
	end
	applyTrail(player)
	markDirty(player)
	return true, nil
end

Actions.GetState = function(player, profile)
	markDirty(player)
	return true, nil
end

Request.OnServerInvoke = function(player: Player, action: any, arg: any)
	if type(action) ~= "string" or not Actions[action] then
		return false, "Unknown action"
	end
	local now = os.clock()
	if lastRequest[player] and now - lastRequest[player] < 0.08 then
		return false, nil
	end
	lastRequest[player] = now
	local profile = DataService.Get(player)
	if not profile then
		return false, "Data still loading..."
	end
	local ok, msg = Actions[action](player, profile, arg)
	if not ok and msg then
		notify(player, msg, "error")
	end
	return ok, msg
end

-- World prompts (gates & eggs)
for zoneIndex, gate in WorldBuilder.Gates do
	local prompt = gate:FindFirstChildOfClass("ProximityPrompt")
	if prompt then
		prompt.Triggered:Connect(function(player)
			local profile = DataService.Get(player)
			if not profile or profile.Zones >= zoneIndex then
				return
			end
			if profile.Zones + 1 < zoneIndex then
				notify(player, "Unlock the previous zone first!", "error")
				return
			end
			local ok, msg = tryUnlockZone(player, profile)
			if not ok and msg then
				notify(player, msg, "error")
			end
		end)
	end
end

for eggKey, eggPart in WorldBuilder.EggStands do
	local prompt = eggPart:FindFirstChildOfClass("ProximityPrompt")
	if prompt then
		prompt.Triggered:Connect(function(player)
			local profile = DataService.Get(player)
			if not profile then
				return
			end
			local ok, msg = hatch(player, profile, eggKey)
			if not ok and msg then
				notify(player, msg, "error")
			end
		end)
	end
end

---------------------------------------------------------------------------
-- Monetization
---------------------------------------------------------------------------
local function ownsPass(player: Player, id: number): boolean
	if id == 0 then
		return false
	end
	local ok, owns = pcall(MarketplaceService.UserOwnsGamePassAsync, MarketplaceService, player.UserId, id)
	return ok and owns == true
end

local function loadPasses(player: Player)
	local gp = Config.GamePasses
	passes[player] = {
		DoubleCoins = ownsPass(player, gp.DoubleCoins.Id),
		VIP = ownsPass(player, gp.VIP.Id),
		ExtraPetSlots = ownsPass(player, gp.ExtraPetSlots.Id),
		LuckyHatch = ownsPass(player, gp.LuckyHatch.Id),
	}
	player:SetAttribute("VIP", passes[player].VIP)
end

MarketplaceService.PromptGamePassPurchaseFinished:Connect(function(player, passId, purchased)
	local p = passes[player]
	if not purchased or not p then
		return
	end
	for key, info in Config.GamePasses do
		if info.Id == passId and info.Id ~= 0 then
			(p :: any)[key] = true
			notify(player, "Thanks for buying " .. info.Name .. "!", "success")
		end
	end
	player:SetAttribute("VIP", p.VIP)
	applyCharacterStats(player)
	markDirty(player)
end)

local productById: { [number]: any } = {}
for _, product in Config.Products do
	if product.Id ~= 0 then
		productById[product.Id] = product
	end
end

local function grantProduct(player: Player, profile: Profile, product: any)
	if product.Kind == "Coins" then
		addCoins(player, profile, Formulas.ScaledCoins(product.Amount, profile.Rebirths, profile.Zones))
	elseif product.Kind == "Gems" then
		profile.Gems += product.Amount
	elseif product.Kind == "Boost" then
		(profile.Boosts :: any)[product.Boost] += product.Amount
	elseif product.Kind == "Spins" then
		profile.Spins += product.Amount
	elseif product.Kind == "Trail" then
		profile.Trails[product.Trail] = true
		profile.Trail = product.Trail
		applyTrail(player)
	elseif product.Kind == "Starter" then
		profile.StarterPack = true
		profile.Gems += 1000
		profile.Trails.Galaxy = true
		profile.Trail = "Galaxy"
		profile.Boosts.Coins += 60 * 60
		profile.Spins += 3
		applyTrail(player)
	end
	markDirty(player)
end

MarketplaceService.ProcessReceipt = function(receipt)
	local player = Players:GetPlayerByUserId(receipt.PlayerId)
	local profile = player and DataService.Get(player)
	if not player or not profile then
		return Enum.ProductPurchaseDecision.NotProcessedYet
	end
	if table.find(profile.Receipts, receipt.PurchaseId) then
		return Enum.ProductPurchaseDecision.PurchaseGranted
	end
	local product = productById[receipt.ProductId]
	if not product then
		warn("[Monetization] Unknown product", receipt.ProductId)
		return Enum.ProductPurchaseDecision.NotProcessedYet
	end
	grantProduct(player, profile, product)
	table.insert(profile.Receipts, receipt.PurchaseId)
	while #profile.Receipts > 50 do
		table.remove(profile.Receipts, 1)
	end
	if not DataService.Save(player) and not RunService:IsStudio() then
		return Enum.ProductPurchaseDecision.NotProcessedYet
	end
	notify(player, "Thanks for your purchase of " .. product.Name .. "!", "success")
	return Enum.ProductPurchaseDecision.PurchaseGranted
end

---------------------------------------------------------------------------
-- Friends bonus
---------------------------------------------------------------------------
local function recountFriends()
	for p, set in friendPairs do
		local n = 0
		for other in set do
			if other.Parent == Players then
				n += 1
			end
		end
		if friendCount[p] ~= n then
			if (friendCount[p] or 0) < n then
				notify(p, string.format("Friend joined! +%d%% coins", math.floor(Config.FriendBonus * 100)), "success")
			end
			friendCount[p] = n
			markDirty(p)
		end
	end
end

local function linkFriends(player: Player)
	friendPairs[player] = friendPairs[player] or {}
	for _, other in Players:GetPlayers() do
		if other ~= player then
			local ok, isFriend = pcall(player.IsFriendsWith, player, other.UserId)
			if ok and isFriend and friendPairs[player] then
				friendPairs[player][other] = true
				friendPairs[other] = friendPairs[other] or {}
				friendPairs[other][player] = true
			end
		end
	end
	recountFriends()
end

---------------------------------------------------------------------------
-- Global leaderboard (top rebirths)
---------------------------------------------------------------------------
local orderedStore: OrderedDataStore? = nil
pcall(function()
	orderedStore = DataStoreService:GetOrderedDataStore(Config.LeaderboardStoreName)
end)

local function renderLeaderboard()
	local gui = WorldBuilder.Leaderboard
	local store = orderedStore
	if not gui then
		return
	end
	gui:ClearAllChildren()
	local title = Instance.new("TextLabel")
	title.Size = UDim2.new(1, 0, 0, 70)
	title.BackgroundColor3 = Color3.fromRGB(255, 190, 40)
	title.Font = Enum.Font.FredokaOne
	title.TextScaled = true
	title.Text = "TOP REBIRTHS"
	title.TextColor3 = Color3.fromRGB(30, 20, 0)
	title.Parent = gui
	if not store then
		return
	end
	local ok, pages = pcall(function()
		return store:GetSortedAsync(false, 10)
	end)
	if not ok then
		return
	end
	for rank, entry in (pages :: DataStorePages):GetCurrentPage() do
		local userId = tonumber(string.sub(entry.key, 3)) or 0
		local nameOk, name = pcall(Players.GetNameFromUserIdAsync, Players, userId)
		local row = Instance.new("TextLabel")
		row.Size = UDim2.new(1, -20, 0, 50)
		row.Position = UDim2.new(0, 10, 0, 75 + (rank - 1) * 52)
		row.BackgroundTransparency = 1
		row.Font = Enum.Font.GothamBold
		row.TextScaled = true
		row.TextXAlignment = Enum.TextXAlignment.Left
		row.TextColor3 = if rank == 1 then Color3.fromRGB(255, 215, 80) elseif rank <= 3 then Color3.fromRGB(220, 220, 255) else Color3.new(1, 1, 1)
		row.Text = string.format("#%d  %s  —  %s", rank, if nameOk then name else "?", Format.Number(entry.value))
		row.Parent = gui
	end
end

local function pushLeaderboard(player: Player)
	local profile = DataService.Get(player)
	local store = orderedStore
	if profile and store and profile.Rebirths > 0 then
		pcall(function()
			store:SetAsync("u_" .. player.UserId, profile.Rebirths)
		end)
	end
end

task.spawn(function()
	while true do
		for _, player in Players:GetPlayers() do
			pushLeaderboard(player)
		end
		renderLeaderboard()
		task.wait(120)
	end
end)

---------------------------------------------------------------------------
-- Player lifecycle
---------------------------------------------------------------------------
local function onPlayerAdded(player: Player)
	local stats = Instance.new("Folder")
	stats.Name = "leaderstats"
	local coins = Instance.new("StringValue")
	coins.Name = "Coins"
	coins.Value = "0"
	coins.Parent = stats
	local rebirths = Instance.new("IntValue")
	rebirths.Name = "Rebirths"
	rebirths.Parent = stats
	stats.Parent = player

	sessionStart[player] = os.clock()
	giftsClaimed[player] = {}
	local policyOk, policy = pcall(PolicyService.GetPolicyInfoForPlayerAsync, PolicyService, player)
	restricted[player] = policyOk and policy.ArePaidRandomItemsRestricted == true

	loadPasses(player)
	DataService.Load(player)
	local profile = DataService.Get(player)
	if not profile then
		return
	end
	for _, pet in profile.Pets do
		profile.Discovered[pet.N] = true
	end
	ensureQuests(player, profile)

	player.CharacterAdded:Connect(function()
		task.defer(function()
			applyCharacterStats(player)
			applyTrail(player)
		end)
	end)
	if player.Character then
		applyCharacterStats(player)
		applyTrail(player)
	end
	flush(player)
	task.spawn(linkFriends, player)

	if os.time() - profile.LastDaily >= Config.DailyCooldown then
		notify(player, "Your daily streak reward is ready!", "rare")
	end
	if os.time() - profile.LastFreeSpin >= Config.WheelCooldown then
		notify(player, "Free Lucky Wheel spin ready!", "info")
	end
end

Players.PlayerAdded:Connect(onPlayerAdded)
for _, player in Players:GetPlayers() do
	task.spawn(onPlayerAdded, player)
end

Players.PlayerRemoving:Connect(function(player)
	pushLeaderboard(player)
	DataService.Release(player)
	passes[player] = nil
	dirty[player] = nil
	lastRequest[player] = nil
	sessionStart[player] = nil
	secondsPlayed[player] = nil
	giftsClaimed[player] = nil
	restricted[player] = nil
	friendCount[player] = nil
	friendPairs[player] = nil
	for _, set in friendPairs do
		set[player] = nil
	end
	recountFriends()
end)
