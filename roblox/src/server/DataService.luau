--!strict
-- Player profiles: load/save with retries, autosave, and in-memory fallback
-- when DataStores are unavailable (e.g. Studio without API access).

local DataStoreService = game:GetService("DataStoreService")
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local HttpService = game:GetService("HttpService")

local Config = require(game:GetService("ReplicatedStorage").Shared.Config)

local DataService = {}

export type Pet = { Id: string, N: string }
export type Profile = {
	Coins: number,
	Gems: number,
	Rebirths: number,
	TotalCoins: number,
	Hatched: number,
	Upgrades: { Speed: number, Magnet: number, Value: number },
	Zones: number,
	Pets: { Pet },
	Equipped: { string },
	Codes: { [string]: boolean },
	LastDaily: number,
	Receipts: { string },
}

local function defaultProfile(): Profile
	return {
		Coins = 0,
		Gems = 0,
		Rebirths = 0,
		TotalCoins = 0,
		Hatched = 0,
		Upgrades = { Speed = 0, Magnet = 0, Value = 0 },
		Zones = 1,
		Pets = {},
		Equipped = {},
		Codes = {},
		LastDaily = 0,
		Receipts = {},
	}
end

local function reconcile(target: any, template: any)
	for k, v in template do
		if target[k] == nil then
			target[k] = if type(v) == "table" then table.clone(v) else v
		elseif type(v) == "table" and type(target[k]) == "table" and next(v) ~= nil then
			reconcile(target[k], v)
		end
	end
end

local store: DataStore? = nil
do
	local ok, result = pcall(function()
		return DataStoreService:GetDataStore(Config.DataStoreName)
	end)
	if ok then
		store = result
	else
		warn("[DataService] DataStore unavailable, using memory only:", result)
	end
end

local profiles: { [Player]: Profile } = {}
local loaded: { [Player]: boolean } = {}
DataService.Loaded = Instance.new("BindableEvent")

local function key(player: Player): string
	return "u_" .. player.UserId
end

local function retry<T>(fn: () -> T, attempts: number): (boolean, T | string)
	local lastErr: any
	for i = 1, attempts do
		local ok, res = pcall(fn)
		if ok then
			return true, res
		end
		lastErr = res
		task.wait(1.5 * i)
	end
	return false, tostring(lastErr)
end

function DataService.Get(player: Player): Profile?
	return profiles[player]
end

function DataService.IsLoaded(player: Player): boolean
	return loaded[player] == true
end

function DataService.Load(player: Player)
	local data: any = nil
	local s = store
	if s then
		local ok, res = retry(function()
			return s:GetAsync(key(player))
		end, 4)
		if not ok then
			player:Kick("Could not load your data. Please rejoin in a minute.")
			return
		end
		data = res
	end
	if type(data) ~= "table" then
		data = defaultProfile()
	end
	reconcile(data, defaultProfile())
	if player.Parent ~= Players then
		return
	end
	profiles[player] = data
	loaded[player] = true
	DataService.Loaded:Fire(player, data)
end

function DataService.Save(player: Player): boolean
	local profile = profiles[player]
	local s = store
	if not profile or not s or not loaded[player] then
		return false
	end
	local snapshot = HttpService:JSONDecode(HttpService:JSONEncode(profile))
	local ok, err = retry(function()
		return s:UpdateAsync(key(player), function()
			return snapshot
		end)
	end, 3)
	if not ok then
		warn("[DataService] Save failed for", player.Name, err)
	end
	return ok
end

function DataService.Release(player: Player)
	DataService.Save(player)
	profiles[player] = nil
	loaded[player] = nil
end

-- Autosave loop
task.spawn(function()
	while true do
		task.wait(120)
		for player in profiles do
			task.spawn(DataService.Save, player)
		end
	end
end)

game:BindToClose(function()
	if RunService:IsStudio() and not store then
		return
	end
	local pending = 0
	for player in profiles do
		pending += 1
		task.spawn(function()
			DataService.Save(player)
			pending -= 1
		end)
	end
	local start = os.clock()
	while pending > 0 and os.clock() - start < 25 do
		task.wait(0.1)
	end
end)

return DataService
