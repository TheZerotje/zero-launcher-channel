--!strict
-- Zero Realms client: HUD, menus, shop, retention features, notifications and effects.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local MarketplaceService = game:GetService("MarketplaceService")
local TweenService = game:GetService("TweenService")
local Workspace = game:GetService("Workspace")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local Formulas = require(Shared:WaitForChild("Formulas"))
local Format = require(Shared:WaitForChild("Format"))

local Remotes = ReplicatedStorage:WaitForChild("Remotes")
local Request = Remotes:WaitForChild("Request") :: RemoteFunction
local Sync = Remotes:WaitForChild("Sync") :: RemoteEvent
local Notify = Remotes:WaitForChild("Notify") :: RemoteEvent
local Collected = Remotes:WaitForChild("Collected") :: RemoteEvent
local Hatched = Remotes:WaitForChild("Hatched") :: RemoteEvent
local WheelResult = Remotes:WaitForChild("WheelResult") :: RemoteEvent

local player = Players.LocalPlayer
local playerGui = player:WaitForChild("PlayerGui") :: PlayerGui

local state: any = nil
local syncedAt = os.clock()
local refreshers: { () -> () } = {}
local tickers: { () -> () } = {} -- run every second (timers, badges)

local function since(): number
	return os.clock() - syncedAt
end
local function serverNow(): number
	return (if state then state.ServerTime else os.time()) + since()
end

---------------------------------------------------------------------------
-- UI helpers
---------------------------------------------------------------------------
local COLORS = {
	Panel = Color3.fromRGB(28, 30, 44),
	Card = Color3.fromRGB(42, 45, 64),
	Accent = Color3.fromRGB(255, 196, 60),
	Good = Color3.fromRGB(70, 200, 110),
	Bad = Color3.fromRGB(230, 70, 80),
	Blue = Color3.fromRGB(70, 140, 255),
	Pink = Color3.fromRGB(255, 120, 200),
	Cyan = Color3.fromRGB(110, 220, 255),
	Orange = Color3.fromRGB(255, 160, 60),
	Purple = Color3.fromRGB(170, 100, 255),
	Gray = Color3.fromRGB(90, 90, 100),
	Text = Color3.new(1, 1, 1),
	Sub = Color3.fromRGB(180, 185, 210),
}

local function corner(parent: Instance, r: number?)
	local c = Instance.new("UICorner")
	c.CornerRadius = UDim.new(0, r or 12)
	c.Parent = parent
end

local function stroke(parent: Instance, color: Color3?, thickness: number?)
	local s = Instance.new("UIStroke")
	s.Color = color or Color3.fromRGB(0, 0, 0)
	s.Thickness = thickness or 2
	s.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
	s.Parent = parent
end

local function label(parent: Instance, text: string, size: UDim2, pos: UDim2?, color: Color3?, font: Enum.Font?): TextLabel
	local l = Instance.new("TextLabel")
	l.BackgroundTransparency = 1
	l.Size = size
	l.Position = pos or UDim2.new()
	l.Font = font or Enum.Font.GothamBold
	l.TextScaled = true
	l.TextColor3 = color or COLORS.Text
	l.Text = text
	l.Parent = parent
	return l
end

local function leftLabel(parent: Instance, text: string, size: UDim2, pos: UDim2?, color: Color3?, font: Enum.Font?): TextLabel
	local l = label(parent, text, size, pos, color, font)
	l.TextXAlignment = Enum.TextXAlignment.Left
	return l
end

local function button(parent: Instance, text: string, size: UDim2, pos: UDim2?, color: Color3?): TextButton
	local b = Instance.new("TextButton")
	b.Size = size
	b.Position = pos or UDim2.new()
	b.BackgroundColor3 = color or COLORS.Blue
	b.Font = Enum.Font.FredokaOne
	b.TextScaled = true
	b.TextColor3 = COLORS.Text
	b.AutoButtonColor = true
	b.Text = text
	corner(b, 10)
	stroke(b, Color3.fromRGB(0, 0, 0), 1.5)
	local pad = Instance.new("UIPadding")
	pad.PaddingTop = UDim.new(0, 4)
	pad.PaddingBottom = UDim.new(0, 4)
	pad.PaddingLeft = UDim.new(0, 6)
	pad.PaddingRight = UDim.new(0, 6)
	pad.Parent = b
	b.Parent = parent
	return b
end

local function setActive(b: TextButton, active: boolean, color: Color3)
	b.BackgroundColor3 = if active then color else COLORS.Gray
end

local function request(action: string, arg: any?): boolean
	local ok, result = pcall(function()
		return Request:InvokeServer(action, arg)
	end)
	return ok and result == true
end

---------------------------------------------------------------------------
-- Root GUI
---------------------------------------------------------------------------
local gui = Instance.new("ScreenGui")
gui.Name = "ZeroRealmsUI"
gui.ResetOnSpawn = false
gui.IgnoreGuiInset = true
gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
gui.Parent = playerGui

local uiScale = Instance.new("UIScale")
uiScale.Parent = gui
local function rescale()
	local cam = Workspace.CurrentCamera
	if cam then
		local v = cam.ViewportSize
		uiScale.Scale = math.clamp(math.min(v.X / 1100, v.Y / 700), 0.55, 1)
	end
end
rescale()
if Workspace.CurrentCamera then
	Workspace.CurrentCamera:GetPropertyChangedSignal("ViewportSize"):Connect(rescale)
end

-- Currency bar
local bar = Instance.new("Frame")
bar.Size = UDim2.new(0, 520, 0, 52)
bar.Position = UDim2.new(0.5, -260, 0, 48)
bar.BackgroundTransparency = 1
bar.Parent = gui
local barLayout = Instance.new("UIListLayout")
barLayout.FillDirection = Enum.FillDirection.Horizontal
barLayout.HorizontalAlignment = Enum.HorizontalAlignment.Center
barLayout.Padding = UDim.new(0, 8)
barLayout.Parent = bar

local function pill(icon: string, color: Color3): TextLabel
	local f = Instance.new("Frame")
	f.Size = UDim2.new(0, 160, 1, 0)
	f.BackgroundColor3 = COLORS.Panel
	f.BackgroundTransparency = 0.1
	corner(f, 26)
	stroke(f, color, 2.5)
	f.Parent = bar
	label(f, icon, UDim2.new(0, 40, 0, 40), UDim2.new(0, 6, 0, 6), color, Enum.Font.FredokaOne)
	return label(f, "0", UDim2.new(1, -56, 0.7, 0), UDim2.new(0, 48, 0.15, 0), COLORS.Text, Enum.Font.FredokaOne)
end
local coinsLabel = pill("●", COLORS.Accent)
local gemsLabel = pill("◆", COLORS.Cyan)
local multLabel = pill("✦", COLORS.Pink)

-- Active boost timers under the currency bar
local boostBar = Instance.new("Frame")
boostBar.Size = UDim2.new(0, 520, 0, 30)
boostBar.Position = UDim2.new(0.5, -260, 0, 106)
boostBar.BackgroundTransparency = 1
boostBar.Parent = gui
local boostLayout = Instance.new("UIListLayout")
boostLayout.FillDirection = Enum.FillDirection.Horizontal
boostLayout.HorizontalAlignment = Enum.HorizontalAlignment.Center
boostLayout.Padding = UDim.new(0, 6)
boostLayout.Parent = boostBar
for _, key in Config.BoostOrder do
	local def = (Config.Boosts :: any)[key]
	local chip = Instance.new("Frame")
	chip.Size = UDim2.new(0, 160, 1, 0)
	chip.BackgroundColor3 = COLORS.Panel
	chip.Visible = false
	corner(chip, 15)
	stroke(chip, def.Color, 2)
	chip.Parent = boostBar
	local t = label(chip, "", UDim2.new(1, -12, 0.75, 0), UDim2.new(0, 6, 0.125, 0), def.Color, Enum.Font.FredokaOne)
	table.insert(tickers, function()
		if not state then
			return
		end
		local remaining = state.Boosts[key] - since()
		chip.Visible = remaining > 0
		if remaining > 0 then
			t.Text = def.Name .. "  " .. Format.Time(remaining)
		end
	end)
end

-- Side menus
local function sideMenu(anchorRight: boolean): Frame
	local f = Instance.new("Frame")
	f.Size = UDim2.new(0, 110, 0, 480)
	f.AnchorPoint = Vector2.new(if anchorRight then 1 else 0, 0.5)
	f.Position = if anchorRight then UDim2.new(1, -12, 0.5, 0) else UDim2.new(0, 12, 0.5, 0)
	f.BackgroundTransparency = 1
	f.Parent = gui
	local l = Instance.new("UIListLayout")
	l.Padding = UDim.new(0, 8)
	l.VerticalAlignment = Enum.VerticalAlignment.Center
	l.SortOrder = Enum.SortOrder.LayoutOrder
	l.Parent = f
	return f
end
local leftMenu = sideMenu(false)
local rightMenu = sideMenu(true)

-- Panels
local panels: { [string]: Frame } = {}
local openPanel: string? = nil

local function makePanel(name: string, title: string, color: Color3): (Frame, ScrollingFrame)
	local p = Instance.new("Frame")
	p.Name = name
	p.Size = UDim2.new(0, 580, 0, 420)
	p.AnchorPoint = Vector2.new(0.5, 0.5)
	p.Position = UDim2.new(0.5, 0, 0.53, 0)
	p.BackgroundColor3 = COLORS.Panel
	p.Visible = false
	p.ZIndex = 5
	corner(p, 18)
	stroke(p, color, 3)
	p.Parent = gui
	local header = Instance.new("Frame")
	header.Size = UDim2.new(1, 0, 0, 50)
	header.BackgroundColor3 = color
	corner(header, 18)
	header.Parent = p
	leftLabel(header, title, UDim2.new(1, -80, 0.7, 0), UDim2.new(0, 20, 0.15, 0), COLORS.Text, Enum.Font.FredokaOne)
	local close = button(header, "X", UDim2.new(0, 40, 0, 40), UDim2.new(1, -46, 0, 5), COLORS.Bad)
	close.MouseButton1Click:Connect(function()
		p.Visible = false
		openPanel = nil
	end)
	local body = Instance.new("ScrollingFrame")
	body.Size = UDim2.new(1, -20, 1, -64)
	body.Position = UDim2.new(0, 10, 0, 58)
	body.BackgroundTransparency = 1
	body.BorderSizePixel = 0
	body.ScrollBarThickness = 6
	body.AutomaticCanvasSize = Enum.AutomaticSize.Y
	body.CanvasSize = UDim2.new()
	body.Parent = p
	panels[name] = p
	return p, body
end

local function togglePanel(name: string)
	for n, p in panels do
		p.Visible = (n == name) and openPanel ~= name
	end
	openPanel = if openPanel == name then nil else name
	for _, fn in refreshers do
		fn()
	end
end

local menuOrder = 0
local function menuButton(menu: Frame, text: string, color: Color3, panel: string?): (TextButton, (boolean) -> ())
	menuOrder += 1
	local b = button(menu, text, UDim2.new(1, 0, 0, 54), nil, color)
	b.LayoutOrder = menuOrder
	if panel then
		b.MouseButton1Click:Connect(function()
			togglePanel(panel)
		end)
	end
	local badge = Instance.new("TextLabel")
	badge.Size = UDim2.new(0, 24, 0, 24)
	badge.Position = UDim2.new(1, -14, 0, -10)
	badge.BackgroundColor3 = COLORS.Bad
	badge.Text = "!"
	badge.Font = Enum.Font.FredokaOne
	badge.TextScaled = true
	badge.TextColor3 = COLORS.Text
	badge.Visible = false
	badge.ZIndex = 3
	corner(badge, 12)
	stroke(badge, Color3.new(1, 1, 1), 2)
	badge.Parent = b
	return b, function(on: boolean)
		badge.Visible = on
	end
end

local function list(body: Instance, cellHeight: number?, columns: number?)
	if columns and cellHeight then
		local grid = Instance.new("UIGridLayout")
		grid.CellSize = UDim2.new(1 / columns, -8, 0, cellHeight)
		grid.CellPadding = UDim2.new(0, 8, 0, 8)
		grid.SortOrder = Enum.SortOrder.LayoutOrder
		grid.Parent = body
	else
		local l = Instance.new("UIListLayout")
		l.Padding = UDim.new(0, 8)
		l.SortOrder = Enum.SortOrder.LayoutOrder
		l.Parent = body
	end
end

local function card(parent: Instance, height: number, order: number?): Frame
	local f = Instance.new("Frame")
	f.Size = UDim2.new(1, -8, 0, height)
	f.BackgroundColor3 = COLORS.Card
	f.LayoutOrder = order or 0
	corner(f, 12)
	f.Parent = parent
	return f
end

local function priceInto(id: number, infoType: Enum.InfoType, target: TextButton)
	if id == 0 then
		target.Text = "Soon"
		return
	end
	task.spawn(function()
		local ok, info = pcall(MarketplaceService.GetProductInfo, MarketplaceService, id, infoType)
		target.Text = if ok and info and info.PriceInRobux then "R$ " .. tostring(info.PriceInRobux) else "Buy"
	end)
end

local function productByKey(key: string): any
	for _, p in Config.Products do
		if p.Key == key then
			return p
		end
	end
	return nil
end

local function promptProduct(key: string)
	local p = productByKey(key)
	if p and p.Id ~= 0 then
		MarketplaceService:PromptProductPurchase(player, p.Id)
	end
end

---------------------------------------------------------------------------
-- Upgrades
---------------------------------------------------------------------------
local upgradeBadge: (boolean) -> ()
do
	local _, body = makePanel("Upgrades", "Upgrades", COLORS.Blue)
	list(body)
	for i, kind in { "Speed", "Magnet", "Value" } do
		local def = (Config.Upgrades :: any)[kind]
		local c = card(body, 80, i)
		local title = leftLabel(c, def.Name, UDim2.new(0.6, 0, 0, 34), UDim2.new(0, 14, 0, 6), COLORS.Text, Enum.Font.FredokaOne)
		leftLabel(c, def.Description, UDim2.new(0.6, 0, 0, 24), UDim2.new(0, 14, 0, 44), COLORS.Sub)
		local buy = button(c, "Buy", UDim2.new(0.34, 0, 0, 56), UDim2.new(0.64, -6, 0, 12), COLORS.Good)
		buy.MouseButton1Click:Connect(function()
			request("Upgrade", kind)
		end)
		table.insert(refreshers, function()
			if not state then
				return
			end
			local lvl = state.Upgrades[kind]
			title.Text = string.format("%s  (Lv %d/%d)", def.Name, lvl, def.Max)
			if lvl >= def.Max then
				buy.Text = "MAXED"
				buy.BackgroundColor3 = COLORS.Card
			else
				local cost = Formulas.UpgradeCost(kind, lvl)
				buy.Text = Format.Number(cost) .. " ●"
				setActive(buy, state.Coins >= cost, COLORS.Good)
			end
		end)
	end
end

---------------------------------------------------------------------------
-- Rebirth
---------------------------------------------------------------------------
do
	local _, body = makePanel("Rebirth", "Rebirth", COLORS.Pink)
	list(body)
	local c = card(body, 300, 1)
	local info = label(c, "", UDim2.new(1, -30, 0, 150), UDim2.new(0, 15, 0, 10), COLORS.Text)
	info.TextWrapped = true
	local go = button(c, "REBIRTH", UDim2.new(0.6, 0, 0, 70), UDim2.new(0.2, 0, 0, 190), COLORS.Pink)
	go.MouseButton1Click:Connect(function()
		request("Rebirth")
	end)
	table.insert(refreshers, function()
		if not state then
			return
		end
		local cost = Formulas.RebirthCost(state.Rebirths)
		info.Text = string.format(
			"Rebirths: %d\nCost: %s Coins\n\nReward: +%d%% coins forever & %s Gems\nResets coins and upgrades. Keeps pets, trails & zones!",
			state.Rebirths,
			Format.Number(cost),
			math.floor(Config.RebirthBonus * 100),
			Format.Number(Config.RebirthGems * (state.Rebirths + 1))
		)
		setActive(go, state.Coins >= cost, COLORS.Pink)
	end)
end

---------------------------------------------------------------------------
-- Pets (+ golden crafting and index)
---------------------------------------------------------------------------
do
	local panel, body = makePanel("Pets", "Pets", COLORS.Good)
	local header = Instance.new("Frame")
	header.Size = UDim2.new(1, -20, 0, 40)
	header.Position = UDim2.new(0, 10, 0, 56)
	header.BackgroundTransparency = 1
	header.Parent = panel
	body.Size = UDim2.new(1, -20, 1, -110)
	body.Position = UDim2.new(0, 10, 0, 102)
	local count = leftLabel(header, "", UDim2.new(0.68, 0, 1, 0), nil, COLORS.Sub)
	local best = button(header, "Equip Best", UDim2.new(0.3, 0, 1, 0), UDim2.new(0.7, 0, 0, 0), COLORS.Good)
	best.MouseButton1Click:Connect(function()
		request("EquipBest")
	end)
	list(body, 160, 4)

	local function rebuild()
		for _, child in body:GetChildren() do
			if child:IsA("Frame") then
				child:Destroy()
			end
		end
		if not state then
			return
		end
		local discovered = 0
		for name in state.Discovered do
			if Config.PetIndex[name] then
				discovered += 1
			end
		end
		local totalSpecies = 0
		for _ in Config.PetIndex do
			totalSpecies += 1
		end
		count.Text = string.format(
			"%d/%d pets • %d/%d equipped • Index %d/%d (+%d%%)",
			#state.Pets, Config.MaxPets, #state.Equipped, state.Slots, discovered, totalSpecies, math.floor(discovered * Config.IndexBonus * 100)
		)
		local normalCounts: { [string]: number } = {}
		for _, pet in state.Pets do
			if not pet.G then
				normalCounts[pet.N] = (normalCounts[pet.N] or 0) + 1
			end
		end
		local pets = table.clone(state.Pets)
		table.sort(pets, function(a, b)
			local ea = table.find(state.Equipped, a.Id) ~= nil
			local eb = table.find(state.Equipped, b.Id) ~= nil
			if ea ~= eb then
				return ea
			end
			return Formulas.PetMult(a) > Formulas.PetMult(b)
		end)
		for i, pet in pets do
			local def = Config.PetIndex[pet.N]
			if not def then
				continue
			end
			local equipped = table.find(state.Equipped, pet.Id) ~= nil
			local color = if pet.G then COLORS.Accent else Config.RarityColors[def.Rarity]
			local f = Instance.new("Frame")
			f.BackgroundColor3 = if pet.G then Color3.fromRGB(70, 60, 30) else COLORS.Card
			f.LayoutOrder = i
			corner(f, 12)
			stroke(f, if equipped then COLORS.Good else color, if equipped then 3 else 1.5)
			f.Parent = body
			label(f, (if pet.G then "Golden " else "") .. def.Name, UDim2.new(1, -8, 0, 22), UDim2.new(0, 4, 0, 6), color, Enum.Font.FredokaOne)
			label(f, def.Rarity, UDim2.new(1, -8, 0, 16), UDim2.new(0, 4, 0, 30), COLORS.Sub)
			label(f, Format.Mult(Formulas.PetMult(pet)), UDim2.new(1, -8, 0, 22), UDim2.new(0, 4, 0, 48), COLORS.Accent, Enum.Font.FredokaOne)
			local eq = button(f, if equipped then "Unequip" else "Equip", UDim2.new(1, -12, 0, 26), UDim2.new(0, 6, 0, 74), if equipped then COLORS.Gray else COLORS.Good)
			eq.MouseButton1Click:Connect(function()
				request(if equipped then "Unequip" else "Equip", pet.Id)
			end)
			local have = normalCounts[pet.N] or 0
			if not pet.G then
				local gold = button(f, string.format("Golden %d/%d", math.min(have, Config.GoldenCost), Config.GoldenCost), UDim2.new(1, -12, 0, 24), UDim2.new(0, 6, 0, 104), COLORS.Accent)
				setActive(gold, have >= Config.GoldenCost, COLORS.Accent)
				gold.MouseButton1Click:Connect(function()
					request("MakeGolden", pet.N)
				end)
			end
			local del = button(f, "Delete", UDim2.new(1, -12, 0, 20), UDim2.new(0, 6, 0, 132), COLORS.Bad)
			local armed = false
			del.MouseButton1Click:Connect(function()
				if armed then
					request("DeletePet", pet.Id)
				else
					armed = true
					del.Text = "Sure?"
					task.delay(2, function()
						armed = false
						if del.Parent then
							del.Text = "Delete"
						end
					end)
				end
			end)
		end
	end

	local lastKey = ""
	table.insert(refreshers, function()
		if not state or not panel.Visible then
			return
		end
		local ids = {}
		for _, pet in state.Pets do
			table.insert(ids, pet.Id)
		end
		local key = table.concat(ids, ",") .. "|" .. table.concat(state.Equipped, ",") .. "|" .. state.Slots
		if key ~= lastKey then
			lastKey = key
			rebuild()
		end
	end)
	panel:GetPropertyChangedSignal("Visible"):Connect(function()
		lastKey = ""
	end)
end

---------------------------------------------------------------------------
-- Eggs
---------------------------------------------------------------------------
do
	local _, body = makePanel("Eggs", "Eggs", COLORS.Orange)
	list(body)
	local luckNote = card(body, 34, 0)
	local luckText = label(luckNote, "", UDim2.new(1, -16, 0.8, 0), UDim2.new(0, 8, 0.1, 0), COLORS.Good)
	table.insert(tickers, function()
		if not state then
			return
		end
		local luck = (if state.Passes.LuckyHatch then 2 else 1) * (if state.Boosts.Luck - since() > 0 then 2 else 1)
		luckNote.Visible = luck > 1
		luckText.Text = string.format("Luck x%d active: rare pets are %dx more likely!", luck, luck)
	end)
	for i, key in Config.EggOrder do
		local egg = Config.Eggs[key]
		local c = card(body, 96, i)
		leftLabel(c, egg.Name, UDim2.new(0.6, 0, 0, 30), UDim2.new(0, 14, 0, 6), COLORS.Text, Enum.Font.FredokaOne)
		local odds = {}
		local total = 0
		for _, pet in egg.Pets do
			total += pet.Weight
		end
		for _, pet in egg.Pets do
			table.insert(odds, string.format("%s %s (%d%%)", pet.Name, Format.Mult(pet.Mult), math.floor(pet.Weight / total * 100 + 0.5)))
		end
		local o = leftLabel(c, table.concat(odds, "  •  "), UDim2.new(0.62, 0, 0, 48), UDim2.new(0, 14, 0, 40), COLORS.Sub, Enum.Font.Gotham)
		o.TextWrapped = true
		local buy = button(c, "", UDim2.new(0.32, 0, 0, 64), UDim2.new(0.66, 0, 0, 16), COLORS.Good)
		buy.MouseButton1Click:Connect(function()
			request("Hatch", key)
		end)
		table.insert(refreshers, function()
			if not state then
				return
			end
			if egg.Currency == "Gems" and state.Restricted then
				c.Visible = false
				return
			end
			if egg.Zone > state.Zones then
				buy.Text = "Locked"
				buy.BackgroundColor3 = COLORS.Gray
				return
			end
			local have = if egg.Currency == "Gems" then state.Gems else state.Coins
			buy.Text = Format.Number(egg.Cost) .. (if egg.Currency == "Gems" then " ◆" else " ●")
			setActive(buy, have >= egg.Cost, COLORS.Good)
		end)
	end
end

---------------------------------------------------------------------------
-- Boosts (power-ups)
---------------------------------------------------------------------------
do
	local _, body = makePanel("Boosts", "Power-Ups", COLORS.Purple)
	list(body)
	for i, key in Config.BoostOrder do
		local def = (Config.Boosts :: any)[key]
		local c = card(body, 90, i)
		stroke(c, def.Color, 2)
		leftLabel(c, def.Name, UDim2.new(0.5, 0, 0, 30), UDim2.new(0, 14, 0, 6), def.Color, Enum.Font.FredokaOne)
		leftLabel(c, def.Description .. " for " .. (def.Duration // 60) .. " min", UDim2.new(0.5, 0, 0, 22), UDim2.new(0, 14, 0, 38), COLORS.Sub, Enum.Font.Gotham)
		local timer = leftLabel(c, "", UDim2.new(0.5, 0, 0, 20), UDim2.new(0, 14, 0, 62), COLORS.Good)
		local gemBtn = button(c, Format.Number(def.GemCost) .. " ◆", UDim2.new(0.22, 0, 0, 60), UDim2.new(0.53, 0, 0, 15), COLORS.Cyan)
		gemBtn.MouseButton1Click:Connect(function()
			request("BuyBoost", key)
		end)
		local productKey = if key == "Coins" then "Boost2x" elseif key == "Luck" then "BoostLuck" else nil
		if productKey then
			local p = productByKey(productKey)
			local rb = button(c, "...", UDim2.new(0.22, 0, 0, 60), UDim2.new(0.77, 0, 0, 15), COLORS.Good)
			priceInto(p.Id, Enum.InfoType.Product, rb)
			rb.MouseButton1Click:Connect(function()
				promptProduct(productKey)
			end)
			local note = label(rb, "30 min", UDim2.new(1, 0, 0, 14), UDim2.new(0, 0, 1, -6), COLORS.Text, Enum.Font.Gotham)
			note.ZIndex = 2
		end
		table.insert(tickers, function()
			if not state then
				return
			end
			local remaining = state.Boosts[key] - since()
			timer.Text = if remaining > 0 then "Active: " .. Format.Time(remaining) else "Not active"
			setActive(gemBtn, state.Gems >= def.GemCost, COLORS.Cyan)
		end)
	end
	local tip = card(body, 50, 10)
	local tipText = label(tip, "Power-up time only counts down while you play. Stack them up to 6 hours!", UDim2.new(1, -16, 0.8, 0), UDim2.new(0, 8, 0.1, 0), COLORS.Sub, Enum.Font.Gotham)
	tipText.TextWrapped = true
end

---------------------------------------------------------------------------
-- Trails (skins)
---------------------------------------------------------------------------
do
	local _, body = makePanel("Trails", "Trails", COLORS.Cyan)
	list(body, 150, 3)
	for i, def in Config.Trails do
		local f = Instance.new("Frame")
		f.BackgroundColor3 = COLORS.Card
		f.LayoutOrder = i
		corner(f, 12)
		f.Parent = body
		local swatch = Instance.new("Frame")
		swatch.Size = UDim2.new(1, -16, 0, 26)
		swatch.Position = UDim2.new(0, 8, 0, 8)
		swatch.BackgroundColor3 = Color3.new(1, 1, 1)
		corner(swatch, 8)
		local grad = Instance.new("UIGradient")
		grad.Color = def.Color
		grad.Parent = swatch
		swatch.Parent = f
		label(f, def.Name, UDim2.new(1, -8, 0, 24), UDim2.new(0, 4, 0, 40), COLORS.Text, Enum.Font.FredokaOne)
		label(f, string.format("+%d%% coins", math.floor(def.Bonus * 100 + 0.5)), UDim2.new(1, -8, 0, 18), UDim2.new(0, 4, 0, 66), COLORS.Accent)
		local b = button(f, "", UDim2.new(1, -16, 0, 44), UDim2.new(0, 8, 0, 96), COLORS.Good)
		b.MouseButton1Click:Connect(function()
			if not state then
				return
			end
			if state.Trails[def.Key] then
				request("EquipTrail", if state.Trail == def.Key then "" else def.Key)
			elseif def.GemCost then
				request("BuyTrail", def.Key)
			elseif def.ProductKey then
				promptProduct(def.ProductKey)
			end
		end)
		local robuxPriceText = "..."
		if not def.GemCost and def.ProductKey then
			local p = productByKey(def.ProductKey)
			if p and p.Id ~= 0 then
				task.spawn(function()
					local ok, info = pcall(MarketplaceService.GetProductInfo, MarketplaceService, p.Id, Enum.InfoType.Product)
					robuxPriceText = if ok and info and info.PriceInRobux then "R$ " .. info.PriceInRobux else "Buy"
				end)
			else
				robuxPriceText = "Soon"
			end
		end
		table.insert(refreshers, function()
			if not state then
				return
			end
			if state.Trails[def.Key] then
				local on = state.Trail == def.Key
				b.Text = if on then "Equipped" else "Equip"
				b.BackgroundColor3 = if on then COLORS.Gray else COLORS.Good
			elseif def.GemCost then
				b.Text = Format.Number(def.GemCost) .. " ◆"
				setActive(b, state.Gems >= def.GemCost, COLORS.Cyan)
			elseif def.ProductKey == "StarterPack" then
				b.Text = "Starter Pack"
				b.BackgroundColor3 = COLORS.Pink
			else
				b.Text = robuxPriceText
				b.BackgroundColor3 = COLORS.Good
			end
		end)
	end
end

---------------------------------------------------------------------------
-- Robux shop
---------------------------------------------------------------------------
do
	local _, body = makePanel("Shop", "Shop", COLORS.Accent)
	list(body)
	local order = 0
	for _, key in { "DoubleCoins", "VIP", "ExtraPetSlots", "LuckyHatch" } do
		local pass = (Config.GamePasses :: any)[key]
		order += 1
		local c = card(body, 80, order)
		leftLabel(c, pass.Name, UDim2.new(0.6, 0, 0, 32), UDim2.new(0, 14, 0, 6), COLORS.Accent, Enum.Font.FredokaOne)
		local d = leftLabel(c, pass.Description, UDim2.new(0.6, 0, 0, 30), UDim2.new(0, 14, 0, 42), COLORS.Sub, Enum.Font.Gotham)
		d.TextWrapped = true
		local b = button(c, "...", UDim2.new(0.32, 0, 0, 56), UDim2.new(0.66, 0, 0, 12), COLORS.Good)
		priceInto(pass.Id, Enum.InfoType.GamePass, b)
		b.MouseButton1Click:Connect(function()
			if pass.Id ~= 0 and not (state and state.Passes[key]) then
				MarketplaceService:PromptGamePassPurchase(player, pass.Id)
			end
		end)
		table.insert(refreshers, function()
			if state and state.Passes[key] then
				b.Text = "OWNED"
				b.BackgroundColor3 = COLORS.Gray
			end
		end)
	end

	for _, product in Config.Products do
		order += 1
		local starter = product.Kind == "Starter"
		local c = card(body, if starter then 90 else 70, if starter then -1 else order)
		if starter then
			stroke(c, COLORS.Pink, 3)
		end
		leftLabel(c, product.Name, UDim2.new(0.6, 0, 0, 30), UDim2.new(0, 14, 0, 6), if starter then COLORS.Pink else COLORS.Text, Enum.Font.FredokaOne)
		local d = leftLabel(c, product.Description or "", UDim2.new(0.6, 0, 0, if starter then 44 else 24), UDim2.new(0, 14, 0, 40), COLORS.Sub, Enum.Font.Gotham)
		d.TextWrapped = true
		local b = button(c, "...", UDim2.new(0.32, 0, 0, 50), UDim2.new(0.66, 0, 0, 10), if starter then COLORS.Pink else COLORS.Blue)
		priceInto(product.Id, Enum.InfoType.Product, b)
		b.MouseButton1Click:Connect(function()
			if product.Id ~= 0 then
				MarketplaceService:PromptProductPurchase(player, product.Id)
			end
		end)
		table.insert(refreshers, function()
			if not state then
				return
			end
			if product.Kind == "Coins" then
				d.Text = "+" .. Format.Number(Formulas.ScaledCoins(product.Amount, state.Rebirths, state.Zones)) .. " Coins"
			elseif product.Kind == "Gems" then
				d.Text = "+" .. Format.Number(product.Amount) .. " Gems"
			end
			if starter and state.StarterPack then
				c.Visible = false
			end
			if product.Kind == "Spins" and state.Restricted then
				c.Visible = false
			end
		end)
	end
end

---------------------------------------------------------------------------
-- Daily quests
---------------------------------------------------------------------------
local questBadge: (boolean) -> ()
do
	local _, body = makePanel("Quests", "Daily Quests", COLORS.Good)
	list(body)
	local resetCard = card(body, 34, 0)
	local resetText = label(resetCard, "", UDim2.new(1, -16, 0.8, 0), UDim2.new(0, 8, 0.1, 0), COLORS.Sub)
	table.insert(tickers, function()
		local now = serverNow()
		resetText.Text = "New quests in " .. Format.Time(86400 - now % 86400) .. "  •  Finish all 3 for a bonus spin!"
	end)
	local rows = {}
	for i = 1, Config.QuestsPerDay do
		local c = card(body, 86, i)
		local t = leftLabel(c, "", UDim2.new(0.62, 0, 0, 28), UDim2.new(0, 14, 0, 8), COLORS.Text, Enum.Font.FredokaOne)
		local barBg = Instance.new("Frame")
		barBg.Size = UDim2.new(0.6, 0, 0, 18)
		barBg.Position = UDim2.new(0, 14, 0, 46)
		barBg.BackgroundColor3 = Color3.fromRGB(20, 22, 32)
		corner(barBg, 9)
		barBg.Parent = c
		local fill = Instance.new("Frame")
		fill.BackgroundColor3 = COLORS.Good
		fill.Size = UDim2.new(0, 0, 1, 0)
		corner(fill, 9)
		fill.Parent = barBg
		local progress = label(barBg, "", UDim2.new(1, 0, 1, 0), nil, COLORS.Text)
		progress.ZIndex = 2
		local claim = button(c, "", UDim2.new(0.3, 0, 0, 56), UDim2.new(0.68, 0, 0, 15), COLORS.Good)
		claim.MouseButton1Click:Connect(function()
			request("ClaimQuest", i)
		end)
		rows[i] = { Card = c, Title = t, Fill = fill, Progress = progress, Claim = claim }
	end
	table.insert(refreshers, function()
		if not state then
			return
		end
		local ready = false
		for i, row in rows do
			local q = state.Quests[i]
			row.Card.Visible = q ~= nil
			if q then
				row.Title.Text = q.Text
				row.Fill.Size = UDim2.new(math.clamp(q.P / q.Goal, 0, 1), 0, 1, 0)
				row.Progress.Text = string.format("%d / %d", q.P, q.Goal)
				if q.C then
					row.Claim.Text = "Done ✓"
					row.Claim.BackgroundColor3 = COLORS.Gray
				elseif q.P >= q.Goal then
					row.Claim.Text = "Claim " .. q.Gems .. " ◆"
					row.Claim.BackgroundColor3 = COLORS.Good
					ready = true
				else
					row.Claim.Text = q.Gems .. " ◆"
					row.Claim.BackgroundColor3 = COLORS.Gray
				end
			end
		end
		if questBadge then
			questBadge(ready)
		end
	end)
end

---------------------------------------------------------------------------
-- Playtime gifts
---------------------------------------------------------------------------
local giftBadge: (boolean) -> ()
do
	local _, body = makePanel("Gifts", "Free Gifts", COLORS.Pink)
	list(body, 120, 3)
	local cells = {}
	for i, gift in Config.Gifts do
		local f = Instance.new("Frame")
		f.BackgroundColor3 = COLORS.Card
		f.LayoutOrder = i
		corner(f, 12)
		f.Parent = body
		local desc = {}
		if gift.Coins then
			table.insert(desc, "Coins")
		end
		if gift.Gems then
			table.insert(desc, gift.Gems .. " Gems")
		end
		if gift.Spins then
			table.insert(desc, gift.Spins .. " Spin")
		end
		if gift.Boost then
			table.insert(desc, (Config.Boosts :: any)[gift.Boost].Name)
		end
		label(f, "🎁", UDim2.new(1, 0, 0, 34), UDim2.new(0, 0, 0, 4), COLORS.Text)
		label(f, table.concat(desc, " + "), UDim2.new(1, -8, 0, 20), UDim2.new(0, 4, 0, 40), COLORS.Accent)
		local b = button(f, "", UDim2.new(1, -16, 0, 42), UDim2.new(0, 8, 0, 70), COLORS.Good)
		b.MouseButton1Click:Connect(function()
			request("ClaimGift", i)
		end)
		cells[i] = b
	end
	table.insert(tickers, function()
		if not state then
			return
		end
		local session = state.SessionTime + since()
		local ready = false
		for i, gift in Config.Gifts do
			local b = cells[i]
			if state.Gifts[i] then
				b.Text = "Claimed"
				b.BackgroundColor3 = COLORS.Gray
			else
				local remaining = gift.Minutes * 60 - session
				if remaining <= 0 then
					b.Text = "Claim!"
					b.BackgroundColor3 = COLORS.Good
					ready = true
				else
					b.Text = Format.Time(remaining)
					b.BackgroundColor3 = COLORS.Gray
				end
			end
		end
		if giftBadge then
			giftBadge(ready)
		end
	end)
end

---------------------------------------------------------------------------
-- Lucky Wheel
---------------------------------------------------------------------------
local spinBadge: (boolean) -> ()
do
	local panel, body = makePanel("Spin", "Lucky Wheel", COLORS.Orange)
	list(body, 70, 2)
	local total = 0
	for _, seg in Config.Wheel do
		total += seg.Weight
	end
	local segFrames: { Frame } = {}
	for i, seg in Config.Wheel do
		local f = Instance.new("Frame")
		f.BackgroundColor3 = COLORS.Card
		f.LayoutOrder = i
		corner(f, 12)
		f.Parent = body
		label(f, seg.Name, UDim2.new(1, -12, 0, 30), UDim2.new(0, 6, 0, 6), COLORS.Text, Enum.Font.FredokaOne)
		label(f, string.format("%.1f%% chance", seg.Weight / total * 100), UDim2.new(1, -12, 0, 20), UDim2.new(0, 6, 0, 40), COLORS.Sub)
		segFrames[i] = f
	end
	body.Size = UDim2.new(1, -20, 1, -150)
	local footer = Instance.new("Frame")
	footer.Size = UDim2.new(1, -20, 0, 76)
	footer.Position = UDim2.new(0, 10, 1, -86)
	footer.BackgroundTransparency = 1
	footer.Parent = panel
	local spin = button(footer, "SPIN", UDim2.new(0.62, 0, 1, 0), nil, COLORS.Orange)
	local buy = button(footer, "...", UDim2.new(0.35, 0, 1, 0), UDim2.new(0.65, 0, 0, 0), COLORS.Good)
	local spinsProduct = productByKey("Spins5")
	priceInto(spinsProduct.Id, Enum.InfoType.Product, buy)
	label(buy, "+5 spins", UDim2.new(1, 0, 0, 16), UDim2.new(0, 0, 1, -8), COLORS.Text, Enum.Font.Gotham).ZIndex = 2
	buy.MouseButton1Click:Connect(function()
		promptProduct("Spins5")
	end)

	local spinning = false
	spin.MouseButton1Click:Connect(function()
		if not spinning then
			request("Spin")
		end
	end)

	WheelResult.OnClientEvent:Connect(function(index: number, text: string)
		spinning = true
		local n = #segFrames
		local steps = n * 3 + index
		for s = 1, steps do
			local i = (s - 1) % n + 1
			for j, f in segFrames do
				f.BackgroundColor3 = if j == i then COLORS.Orange else COLORS.Card
			end
			task.wait(0.04 + (s / steps) ^ 3 * 0.25)
		end
		local result = label(panel, "You won: " .. text, UDim2.new(0.9, 0, 0, 44), UDim2.new(0.05, 0, 0.4, 0), COLORS.Accent, Enum.Font.FredokaOne)
		result.BackgroundTransparency = 0
		result.BackgroundColor3 = COLORS.Panel
		result.ZIndex = 10
		corner(result, 12)
		stroke(result, COLORS.Accent, 3)
		task.wait(2)
		result:Destroy()
		for _, f in segFrames do
			f.BackgroundColor3 = COLORS.Card
		end
		spinning = false
	end)

	table.insert(tickers, function()
		if not state then
			return
		end
		buy.Visible = not state.Restricted
		local remaining = Config.WheelCooldown - (serverNow() - state.LastFreeSpin)
		local ready = remaining <= 0 or state.Spins > 0
		if remaining <= 0 then
			spin.Text = "FREE SPIN!"
		elseif state.Spins > 0 then
			spin.Text = string.format("SPIN (%d left)", state.Spins)
		else
			spin.Text = "Free in " .. Format.Time(remaining)
		end
		setActive(spin, ready, COLORS.Orange)
		if spinBadge then
			spinBadge(ready)
		end
	end)
end

---------------------------------------------------------------------------
-- Rewards (7-day streak + codes)
---------------------------------------------------------------------------
local dailyBadge: (boolean) -> ()
do
	local _, body = makePanel("Rewards", "Daily Streak", COLORS.Cyan)
	list(body)
	local streakCard = card(body, 190, 1)
	local streakTitle = label(streakCard, "", UDim2.new(1, -20, 0, 28), UDim2.new(0, 10, 0, 6), COLORS.Text, Enum.Font.FredokaOne)
	local row = Instance.new("Frame")
	row.Size = UDim2.new(1, -16, 0, 80)
	row.Position = UDim2.new(0, 8, 0, 40)
	row.BackgroundTransparency = 1
	row.Parent = streakCard
	local rowLayout = Instance.new("UIListLayout")
	rowLayout.FillDirection = Enum.FillDirection.Horizontal
	rowLayout.Padding = UDim.new(0, 4)
	rowLayout.Parent = row
	local days = {}
	for d, reward in Config.StreakRewards do
		local f = Instance.new("Frame")
		f.Size = UDim2.new(1 / 7, -4, 1, 0)
		f.BackgroundColor3 = COLORS.Panel
		corner(f, 8)
		f.Parent = row
		label(f, "Day " .. d, UDim2.new(1, 0, 0, 20), UDim2.new(0, 0, 0, 4), COLORS.Sub)
		local extra = if reward.Spins then "+Spin" elseif reward.Boost then "+Boost" else ""
		label(f, (reward.Gems or 0) .. "◆", UDim2.new(1, 0, 0, 24), UDim2.new(0, 0, 0, 28), COLORS.Cyan, Enum.Font.FredokaOne)
		label(f, extra, UDim2.new(1, 0, 0, 16), UDim2.new(0, 0, 0, 56), COLORS.Accent)
		days[d] = f
	end
	local claim = button(streakCard, "Claim", UDim2.new(0.5, 0, 0, 52), UDim2.new(0.25, 0, 0, 130), COLORS.Good)
	claim.MouseButton1Click:Connect(function()
		request("ClaimDaily")
	end)

	local codeCard = card(body, 130, 2)
	label(codeCard, "Codes", UDim2.new(1, -20, 0, 32), UDim2.new(0, 10, 0, 6), COLORS.Text, Enum.Font.FredokaOne)
	local box = Instance.new("TextBox")
	box.Size = UDim2.new(0.6, 0, 0, 50)
	box.Position = UDim2.new(0, 14, 0, 56)
	box.BackgroundColor3 = Color3.fromRGB(20, 22, 32)
	box.PlaceholderText = "Enter code..."
	box.Text = ""
	box.Font = Enum.Font.GothamBold
	box.TextScaled = true
	box.TextColor3 = COLORS.Text
	box.ClearTextOnFocus = false
	corner(box, 10)
	box.Parent = codeCard
	local redeem = button(codeCard, "Redeem", UDim2.new(0.3, 0, 0, 50), UDim2.new(0.66, 0, 0, 56), COLORS.Blue)
	redeem.MouseButton1Click:Connect(function()
		if request("Redeem", box.Text) then
			box.Text = ""
		end
	end)

	table.insert(tickers, function()
		if not state then
			return
		end
		local elapsed = serverNow() - state.LastDaily
		local ready = elapsed >= Config.DailyCooldown
		local streak = state.Streak
		if state.LastDaily ~= 0 and elapsed > Config.StreakGrace then
			streak = 0
		end
		local nextDay = streak % #Config.StreakRewards + 1
		streakTitle.Text = string.format("Streak: %d day%s", streak, if streak == 1 then "" else "s")
		for d, f in days do
			local done = d <= streak and not (ready and nextDay == 1)
			f.BackgroundColor3 = if ready and d == nextDay then COLORS.Good elseif done then Color3.fromRGB(40, 90, 60) else COLORS.Panel
		end
		if ready then
			claim.Text = "Claim Day " .. nextDay .. "!"
			claim.BackgroundColor3 = COLORS.Good
		else
			claim.Text = Format.Time(Config.DailyCooldown - elapsed)
			claim.BackgroundColor3 = COLORS.Gray
		end
		if dailyBadge then
			dailyBadge(ready)
		end
	end)
end

---------------------------------------------------------------------------
-- Menus
---------------------------------------------------------------------------
menuButton(leftMenu, "Pets", COLORS.Good, "Pets")
menuButton(leftMenu, "Eggs", COLORS.Orange, "Eggs")
local _, setUpgradeBadge = menuButton(leftMenu, "Upgrade", COLORS.Blue, "Upgrades")
upgradeBadge = setUpgradeBadge
menuButton(leftMenu, "Rebirth", COLORS.Pink, "Rebirth")
menuButton(leftMenu, "Power-Ups", COLORS.Purple, "Boosts")
menuButton(leftMenu, "Trails", COLORS.Cyan, "Trails")
menuButton(leftMenu, "Shop", COLORS.Accent, "Shop")

local _, b1 = menuButton(rightMenu, "Quests", COLORS.Good, "Quests")
questBadge = b1
local _, b2 = menuButton(rightMenu, "Gifts", COLORS.Pink, "Gifts")
giftBadge = b2
local _, b3 = menuButton(rightMenu, "Spin", COLORS.Orange, "Spin")
spinBadge = b3
local _, b4 = menuButton(rightMenu, "Daily", COLORS.Cyan, "Rewards")
dailyBadge = b4

-- Pulsing starter pack button (hidden once bought or if not configured)
local starterProduct = productByKey("StarterPack")
local starterBtn = button(rightMenu, "STARTER\nPACK", UDim2.new(1, 0, 0, 64), nil, COLORS.Pink)
starterBtn.LayoutOrder = 100
starterBtn.Visible = false
starterBtn.MouseButton1Click:Connect(function()
	promptProduct("StarterPack")
end)
task.spawn(function()
	while true do
		TweenService:Create(starterBtn, TweenInfo.new(0.6, Enum.EasingStyle.Sine), { Rotation = 4 }):Play()
		task.wait(0.6)
		TweenService:Create(starterBtn, TweenInfo.new(0.6, Enum.EasingStyle.Sine), { Rotation = -4 }):Play()
		task.wait(0.6)
	end
end)

table.insert(refreshers, function()
	if not state then
		return
	end
	starterBtn.Visible = starterProduct ~= nil and starterProduct.Id ~= 0 and not state.StarterPack
	local canUpgrade = false
	for _, kind in { "Speed", "Magnet", "Value" } do
		local def = (Config.Upgrades :: any)[kind]
		local lvl = state.Upgrades[kind]
		if lvl < def.Max and state.Coins >= Formulas.UpgradeCost(kind, lvl) then
			canUpgrade = true
		end
	end
	upgradeBadge(canUpgrade)
end)

---------------------------------------------------------------------------
-- Toast notifications
---------------------------------------------------------------------------
local toastHolder = Instance.new("Frame")
toastHolder.Size = UDim2.new(0, 440, 0, 300)
toastHolder.Position = UDim2.new(0.5, -220, 0, 142)
toastHolder.BackgroundTransparency = 1
toastHolder.ZIndex = 20
toastHolder.Parent = gui
local toastLayout = Instance.new("UIListLayout")
toastLayout.Padding = UDim.new(0, 6)
toastLayout.HorizontalAlignment = Enum.HorizontalAlignment.Center
toastLayout.Parent = toastHolder

local function toast(text: string, kind: string)
	local color = if kind == "error" then COLORS.Bad elseif kind == "success" then COLORS.Good elseif kind == "rare" then COLORS.Accent else COLORS.Blue
	local f = Instance.new("Frame")
	f.Size = UDim2.new(1, 0, 0, 40)
	f.BackgroundColor3 = COLORS.Panel
	f.BackgroundTransparency = 0.05
	f.ZIndex = 20
	corner(f, 10)
	stroke(f, color, 2)
	f.Parent = toastHolder
	local l = label(f, text, UDim2.new(1, -16, 0.75, 0), UDim2.new(0, 8, 0.125, 0), color, Enum.Font.GothamBold)
	l.ZIndex = 21
	task.delay(3.5, function()
		TweenService:Create(f, TweenInfo.new(0.4), { BackgroundTransparency = 1 }):Play()
		TweenService:Create(l, TweenInfo.new(0.4), { TextTransparency = 1 }):Play()
		task.wait(0.45)
		f:Destroy()
	end)
	local frames = {}
	for _, c in toastHolder:GetChildren() do
		if c:IsA("Frame") then
			table.insert(frames, c)
		end
	end
	for i = 1, #frames - 6 do
		frames[i]:Destroy()
	end
end

Notify.OnClientEvent:Connect(toast)

---------------------------------------------------------------------------
-- Collect popups & sound
---------------------------------------------------------------------------
local collectSound = Instance.new("Sound")
collectSound.SoundId = "rbxasset://sounds/electronicpingshort.wav"
collectSound.Volume = 0.25
collectSound.Parent = gui

Collected.OnClientEvent:Connect(function(amount: number)
	collectSound.PlaybackSpeed = 1 + math.random() * 0.3
	collectSound:Play()
	local pop = label(gui, "+" .. Format.Number(amount), UDim2.new(0, 160, 0, 36), UDim2.new(0.5, math.random(-120, 40), 0.55, math.random(-30, 30)), COLORS.Accent, Enum.Font.FredokaOne)
	local s = Instance.new("UIStroke")
	s.Thickness = 2
	s.Parent = pop
	TweenService:Create(pop, TweenInfo.new(0.8, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), { Position = pop.Position - UDim2.new(0, 0, 0.12, 0), TextTransparency = 1 }):Play()
	TweenService:Create(s, TweenInfo.new(0.8), { Transparency = 1 }):Play()
	task.delay(0.85, function()
		pop:Destroy()
	end)
end)

---------------------------------------------------------------------------
-- Hatch reveal
---------------------------------------------------------------------------
Hatched.OnClientEvent:Connect(function(name: string, rarity: string, mult: number, isNew: boolean?)
	local color = Config.RarityColors[rarity] or COLORS.Text
	local f = Instance.new("Frame")
	f.Size = UDim2.new(0, 0, 0, 0)
	f.Position = UDim2.new(0.5, 0, 0.45, 0)
	f.AnchorPoint = Vector2.new(0.5, 0.5)
	f.BackgroundColor3 = COLORS.Panel
	f.ZIndex = 30
	corner(f, 20)
	stroke(f, color, 4)
	f.Parent = gui
	local t1 = label(f, if isNew then "NEW PET!" else "You hatched", UDim2.new(1, 0, 0.2, 0), UDim2.new(0, 0, 0.08, 0), if isNew then COLORS.Good else COLORS.Sub, Enum.Font.FredokaOne)
	local t2 = label(f, name, UDim2.new(1, -20, 0.32, 0), UDim2.new(0, 10, 0.28, 0), color, Enum.Font.FredokaOne)
	local t3 = label(f, rarity .. "  •  " .. Format.Mult(mult), UDim2.new(1, 0, 0.2, 0), UDim2.new(0, 0, 0.66, 0), COLORS.Accent, Enum.Font.FredokaOne)
	for _, t in { t1, t2, t3 } do
		t.ZIndex = 31
	end
	TweenService:Create(f, TweenInfo.new(0.35, Enum.EasingStyle.Back), { Size = UDim2.new(0, 340, 0, 200) }):Play()
	task.delay(2.2, function()
		TweenService:Create(f, TweenInfo.new(0.25), { Size = UDim2.new(0, 0, 0, 0) }):Play()
		task.wait(0.3)
		f:Destroy()
	end)
end)

---------------------------------------------------------------------------
-- Gates: unlocked gates become walk-through for this player only
---------------------------------------------------------------------------
local function updateGates()
	local root = Workspace:FindFirstChild("ZeroRealms")
	if not root or not state then
		return
	end
	for _, d in root:GetDescendants() do
		if d:IsA("BasePart") and d:GetAttribute("Zone") then
			local open = state.Zones >= (d:GetAttribute("Zone") :: number)
			d.CanCollide = not open
			d.Transparency = if open then 0.9 else 0.2
			local bb = d:FindFirstChildOfClass("BillboardGui")
			if bb then
				bb.Enabled = not open
			end
			local prompt = d:FindFirstChildOfClass("ProximityPrompt")
			if prompt then
				prompt.Enabled = not open
			end
		end
	end
end

---------------------------------------------------------------------------
-- State sync
---------------------------------------------------------------------------
Sync.OnClientEvent:Connect(function(newState)
	local zonesChanged = not state or state.Zones ~= newState.Zones
	state = newState
	syncedAt = os.clock()
	coinsLabel.Text = Format.Number(state.Coins)
	gemsLabel.Text = Format.Number(state.Gems)
	multLabel.Text = Format.Mult(state.Multiplier)
	if zonesChanged then
		updateGates()
	end
	for _, fn in refreshers do
		fn()
	end
	for _, fn in tickers do
		fn()
	end
end)

task.spawn(function()
	while true do
		task.wait(1)
		for _, fn in tickers do
			fn()
		end
	end
end)

task.spawn(function()
	request("GetState")
end)
