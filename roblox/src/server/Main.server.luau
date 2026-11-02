--!strict
-- Zero Realms server entry point: world, orbs, economy, pets, monetization.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local MarketplaceService = game:GetService("MarketplaceService")
local DataStoreService = game:GetService("DataStoreService")
local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared.Config)
local Formulas = require(Shared.Formulas)
local Format = require(Shared.Format)

local DataService = require(script.Parent.DataService)
local WorldBuilder = require(script.Parent.WorldBuilder)

type Profile = DataService.Profile

---------------------------------------------------------------------------
-- Remotes
---------------------------------------------------------------------------
local remotes = Instance.new("Folder")
remotes.Name = "Remotes"
local Request = Instance.new("RemoteFunction")
Request.Name = "Request"
Request.Parent = remotes
local Sync = Instance.new("RemoteEvent")
Sync.Name = "Sync"
Sync.Parent = remotes
local Notify = Instance.new("RemoteEvent")
Notify.Name = "Notify"
Notify.Parent = remotes
local Collected = Instance.new("RemoteEvent")
Collected.Name = "Collected"
Collected.Parent = remotes
local Hatched = Instance.new("RemoteEvent")
Hatched.Name = "Hatched"
Hatched.Parent = remotes
remotes.Parent = ReplicatedStorage

WorldBuilder.Build()

---------------------------------------------------------------------------
-- Per-player runtime state
---------------------------------------------------------------------------
type Passes = { DoubleCoins: boolean, VIP: boolean, ExtraPetSlots: boolean, LuckyHatch: boolean }
local passes: { [Player]: Passes } = {}
local dirty: { [Player]: boolean } = {}
local lastRequest: { [Player]: number } = {}

local function notify(player: Player, text: string, kind: string?)
	Notify:FireClient(player, text, kind or "info")
end

local function markDirty(player: Player)
	dirty[player] = true
end

local function equippedNames(profile: Profile): { string }
	local byId: { [string]: string } = {}
	for _, pet in profile.Pets do
		byId[pet.Id] = pet.N
	end
	local names = {}
	for _, id in profile.Equipped do
		local n = byId[id]
		if n then
			table.insert(names, n)
		end
	end
	return names
end

local function coinMultiplier(player: Player, profile: Profile): number
	local p = passes[player]
	return Formulas.CoinMultiplier({
		Rebirths = profile.Rebirths,
		ValueLevel = profile.Upgrades.Value,
		PetNames = equippedNames(profile),
		DoubleCoins = p ~= nil and p.DoubleCoins,
		VIP = p ~= nil and p.VIP,
	})
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
		local p = passes[player]
		hum.WalkSpeed = Formulas.WalkSpeed(profile.Upgrades.Speed, p ~= nil and p.VIP)
	end
end

local function syncPayload(player: Player, profile: Profile)
	local p = passes[player] or { DoubleCoins = false, VIP = false, ExtraPetSlots = false, LuckyHatch = false }
	return {
		Coins = profile.Coins,
		Gems = profile.Gems,
		Rebirths = profile.Rebirths,
		TotalCoins = profile.TotalCoins,
		Hatched = profile.Hatched,
		Upgrades = profile.Upgrades,
		Zones = profile.Zones,
		Pets = profile.Pets,
		Equipped = profile.Equipped,
		LastDaily = profile.LastDaily,
		ServerTime = os.time(),
		Passes = p,
		Multiplier = coinMultiplier(player, profile),
		Slots = Formulas.EquipSlots(p.ExtraPetSlots),
	}
end

local function flush(player: Player)
	local profile = DataService.Get(player)
	if not profile then
		return
	end
	dirty[player] = nil
	Sync:FireClient(player, syncPayload(player, profile))
	local stats = player:FindFirstChild("leaderstats")
	if stats then
		(stats:FindFirstChild("Coins") :: StringValue).Value = Format.Number(profile.Coins);
		(stats:FindFirstChild("Rebirths") :: IntValue).Value = profile.Rebirths
	end
	player:SetAttribute("EquippedPets", table.concat(equippedNames(profile), ","))
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

---------------------------------------------------------------------------
-- Orbs
---------------------------------------------------------------------------
type Orb = { Part: BasePart, Zone: number, Active: boolean, Value: number }
local orbsByZone: { [number]: { Orb } } = {}

local function placeOrb(orb: Orb)
	local big = math.random() < 0.08
	orb.Value = Config.Zones[orb.Zone].OrbValue * (if big then 10 else 1)
	orb.Part.Size = if big then Vector3.new(3.2, 3.2, 3.2) else Vector3.new(1.8, 1.8, 1.8)
	orb.Part.Position = WorldBuilder.RandomOrbPosition(orb.Zone)
	orb.Part.Transparency = 0
	orb.Part:SetAttribute("Big", big)
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
		local orb: Orb = { Part = p, Zone = zoneIndex, Active = false, Value = 0 }
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
		local radius = Formulas.Magnet(profile.Upgrades.Magnet)
		local gained = 0
		local count = 0
		for _, orb in orbsByZone[zoneIndex] do
			if orb.Active and (orb.Part.Position - pos).Magnitude <= radius then
				orb.Active = false
				orb.Part.Transparency = 1
				gained += orb.Value
				count += 1
				task.delay(math.random(30, 70) / 10, placeOrb, orb)
			end
		end
		if count > 0 then
			local amount = math.floor(gained * coinMultiplier(player, profile))
			addCoins(player, profile, amount)
			Collected:FireClient(player, amount, count)
		end
	end
end)

---------------------------------------------------------------------------
-- Pets
---------------------------------------------------------------------------
local function rollPet(eggKey: string, lucky: boolean): Config.PetDef
	local egg = Config.Eggs[eggKey]
	local total = 0
	local weights = {}
	for i, pet in egg.Pets do
		local w = pet.Weight
		if lucky and i > 1 then
			w *= 2
		end
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
	local p = passes[player]
	local slots = Formulas.EquipSlots(p ~= nil and p.ExtraPetSlots)
	local sorted = table.clone(profile.Pets)
	table.sort(sorted, function(a, b)
		local ma = Config.PetIndex[a.N] and Config.PetIndex[a.N].Mult or 0
		local mb = Config.PetIndex[b.N] and Config.PetIndex[b.N].Mult or 0
		return ma > mb
	end)
	profile.Equipped = {}
	for i = 1, math.min(slots, #sorted) do
		table.insert(profile.Equipped, sorted[i].Id)
	end
	markDirty(player)
end

local function hatch(player: Player, profile: Profile, eggKey: string): (boolean, string?)
	local egg = Config.Eggs[eggKey]
	if not egg then
		return false, "Unknown egg"
	end
	if egg.Zone > profile.Zones then
		return false, "Unlock " .. Config.Zones[egg.Zone].Name .. " first!"
	end
	if #profile.Pets >= Config.MaxPets then
		return false, "Pet inventory full! Delete some pets."
	end
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
	local p = passes[player]
	local pet = rollPet(eggKey, p ~= nil and p.LuckyHatch)
	local entry = { Id = HttpService:GenerateGUID(false), N = pet.Name }
	table.insert(profile.Pets, entry)
	profile.Hatched += 1

	-- auto-equip if it beats the weakest equipped pet / free slot
	local slots = Formulas.EquipSlots(p ~= nil and p.ExtraPetSlots)
	if #profile.Equipped < slots then
		table.insert(profile.Equipped, entry.Id)
	else
		equipBest(player, profile)
	end
	markDirty(player)
	Hatched:FireClient(player, pet.Name, pet.Rarity, pet.Mult)
	if pet.Rarity == "Legendary" or pet.Rarity == "Mythic" then
		for _, other in Players:GetPlayers() do
			notify(other, string.format("%s hatched a %s %s!", player.DisplayName, pet.Rarity, pet.Name), "rare")
		end
	end
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
	local p = passes[player]
	if #profile.Equipped >= Formulas.EquipSlots(p ~= nil and p.ExtraPetSlots) then
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
	if now - profile.LastDaily < Config.DailyCooldown then
		return false, "Come back in " .. Format.Time(Config.DailyCooldown - (now - profile.LastDaily))
	end
	profile.LastDaily = now
	local p = passes[player]
	local gems = Config.DailyGems * (if p and p.VIP then 2 else 1)
	local coins = Config.DailyCoins * (1 + profile.Rebirths)
	profile.Gems += gems
	addCoins(player, profile, coins)
	notify(player, string.format("Daily reward: +%s Coins, +%d Gems", Format.Number(coins), gems), "success")
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
			if not profile then
				return
			end
			if profile.Zones >= zoneIndex then
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
	if not purchased then
		return
	end
	local p = passes[player]
	if not p then
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
	if product.Kind == "Coins" then
		addCoins(player, profile, product.Amount * (1 + profile.Rebirths))
	elseif product.Kind == "Gems" then
		profile.Gems += product.Amount
	end
	table.insert(profile.Receipts, receipt.PurchaseId)
	while #profile.Receipts > 50 do
		table.remove(profile.Receipts, 1)
	end
	markDirty(player)
	if not DataService.Save(player) and RunService:IsStudio() == false then
		return Enum.ProductPurchaseDecision.NotProcessedYet
	end
	notify(player, "Thanks for your purchase of " .. product.Name .. "!", "success")
	return Enum.ProductPurchaseDecision.PurchaseGranted
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

	loadPasses(player)
	DataService.Load(player)
	local profile = DataService.Get(player)
	if not profile then
		return
	end

	player.CharacterAdded:Connect(function()
		task.defer(applyCharacterStats, player)
	end)
	if player.Character then
		applyCharacterStats(player)
	end
	flush(player)
	if os.time() - profile.LastDaily >= Config.DailyCooldown then
		notify(player, "Your daily reward is ready! Open the Daily menu.", "info")
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
end)
