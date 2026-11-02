--!strict
-- Zero Realms client: HUD, menus, shop, notifications and effects.

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

local player = Players.LocalPlayer
local playerGui = player:WaitForChild("PlayerGui") :: PlayerGui

local state: any = nil
local refreshers: { () -> () } = {}

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
	b.MouseButton1Down:Connect(function()
		local s = b.Size
		TweenService:Create(b, TweenInfo.new(0.06), { Size = UDim2.new(s.X.Scale * 0.95, s.X.Offset * 0.95, s.Y.Scale * 0.95, s.Y.Offset * 0.95) }):Play()
		task.delay(0.08, function()
			TweenService:Create(b, TweenInfo.new(0.08), { Size = s }):Play()
		end)
	end)
	return b
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
local gemsLabel = pill("◆", Color3.fromRGB(110, 220, 255))
local multLabel = pill("✦", Color3.fromRGB(255, 120, 200))

-- Side menu
local side = Instance.new("Frame")
side.Size = UDim2.new(0, 110, 0, 420)
side.Position = UDim2.new(0, 12, 0.5, -210)
side.BackgroundTransparency = 1
side.Parent = gui
local sideLayout = Instance.new("UIListLayout")
sideLayout.Padding = UDim.new(0, 8)
sideLayout.Parent = side

-- Panel container
local panels: { [string]: Frame } = {}
local openPanel: string? = nil

local function makePanel(name: string, title: string, color: Color3): (Frame, ScrollingFrame)
	local p = Instance.new("Frame")
	p.Name = name
	p.Size = UDim2.new(0, 560, 0, 400)
	p.Position = UDim2.new(0.5, -280, 0.5, -190)
	p.BackgroundColor3 = COLORS.Panel
	p.Visible = false
	corner(p, 18)
	stroke(p, color, 3)
	p.Parent = gui
	local sizer = Instance.new("UISizeConstraint")
	sizer.MaxSize = Vector2.new(560, 400)
	sizer.Parent = p
	local header = Instance.new("Frame")
	header.Size = UDim2.new(1, 0, 0, 50)
	header.BackgroundColor3 = color
	corner(header, 18)
	header.Parent = p
	label(header, title, UDim2.new(1, -80, 0.7, 0), UDim2.new(0, 20, 0.15, 0), COLORS.Text, Enum.Font.FredokaOne).TextXAlignment = Enum.TextXAlignment.Left
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

local function menuButton(text: string, color: Color3, panel: string?)
	local b = button(side, text, UDim2.new(1, 0, 0, 58), nil, color)
	if panel then
		b.MouseButton1Click:Connect(function()
			togglePanel(panel)
		end)
	end
	return b
end

local function list(body: Instance, cellHeight: number, columns: number?)
	if columns then
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

---------------------------------------------------------------------------
-- Upgrades panel
---------------------------------------------------------------------------
do
	local _, body = makePanel("Upgrades", "Upgrades", COLORS.Blue)
	list(body, 0)
	for i, kind in { "Speed", "Magnet", "Value" } do
		local def = (Config.Upgrades :: any)[kind]
		local c = card(body, 80, i)
		local title = label(c, def.Name, UDim2.new(0.6, 0, 0, 34), UDim2.new(0, 14, 0, 6), COLORS.Text, Enum.Font.FredokaOne)
		title.TextXAlignment = Enum.TextXAlignment.Left
		local desc = label(c, def.Description, UDim2.new(0.6, 0, 0, 24), UDim2.new(0, 14, 0, 44), COLORS.Sub)
		desc.TextXAlignment = Enum.TextXAlignment.Left
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
				buy.BackgroundColor3 = if state.Coins >= cost then COLORS.Good else Color3.fromRGB(90, 90, 100)
			end
		end)
	end
end

---------------------------------------------------------------------------
-- Rebirth panel
---------------------------------------------------------------------------
do
	local _, body = makePanel("Rebirth", "Rebirth", Color3.fromRGB(255, 120, 200))
	list(body, 0)
	local c = card(body, 300, 1)
	local info = label(c, "", UDim2.new(1, -30, 0, 150), UDim2.new(0, 15, 0, 10), COLORS.Text)
	info.TextWrapped = true
	local go = button(c, "REBIRTH", UDim2.new(0.6, 0, 0, 70), UDim2.new(0.2, 0, 0, 190), Color3.fromRGB(255, 90, 170))
	go.MouseButton1Click:Connect(function()
		request("Rebirth")
	end)
	table.insert(refreshers, function()
		if not state then
			return
		end
		local cost = Formulas.RebirthCost(state.Rebirths)
		info.Text = string.format(
			"Rebirths: %d\nCost: %s Coins\n\nReward: +%d%% coins forever & %s Gems\nResets coins and upgrades. Keeps pets & zones!",
			state.Rebirths,
			Format.Number(cost),
			math.floor(Config.RebirthBonus * 100),
			Format.Number(Config.RebirthGems * (state.Rebirths + 1))
		)
		go.BackgroundColor3 = if state.Coins >= cost then Color3.fromRGB(255, 90, 170) else Color3.fromRGB(90, 90, 100)
	end)
end

---------------------------------------------------------------------------
-- Pets panel
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
	local count = label(header, "", UDim2.new(0.5, 0, 1, 0), nil, COLORS.Sub)
	count.TextXAlignment = Enum.TextXAlignment.Left
	local best = button(header, "Equip Best", UDim2.new(0.3, 0, 1, 0), UDim2.new(0.7, 0, 0, 0), COLORS.Good)
	best.MouseButton1Click:Connect(function()
		request("EquipBest")
	end)
	list(body, 130, 4)

	local function rebuild()
		for _, child in body:GetChildren() do
			if child:IsA("Frame") then
				child:Destroy()
			end
		end
		if not state then
			return
		end
		count.Text = string.format("%d/%d pets  •  %d/%d equipped", #state.Pets, Config.MaxPets, #state.Equipped, state.Slots)
		local pets = table.clone(state.Pets)
		table.sort(pets, function(a, b)
			local ea = table.find(state.Equipped, a.Id) ~= nil
			local eb = table.find(state.Equipped, b.Id) ~= nil
			if ea ~= eb then
				return ea
			end
			local ma = Config.PetIndex[a.N] and Config.PetIndex[a.N].Mult or 0
			local mb = Config.PetIndex[b.N] and Config.PetIndex[b.N].Mult or 0
			return ma > mb
		end)
		for i, pet in pets do
			local def = Config.PetIndex[pet.N]
			if not def then
				continue
			end
			local equipped = table.find(state.Equipped, pet.Id) ~= nil
			local f = Instance.new("Frame")
			f.BackgroundColor3 = COLORS.Card
			f.LayoutOrder = i
			corner(f, 12)
			stroke(f, if equipped then COLORS.Good else Config.RarityColors[def.Rarity], if equipped then 3 else 1.5)
			f.Parent = body
			label(f, def.Name, UDim2.new(1, -8, 0, 22), UDim2.new(0, 4, 0, 6), Config.RarityColors[def.Rarity], Enum.Font.FredokaOne)
			label(f, def.Rarity, UDim2.new(1, -8, 0, 16), UDim2.new(0, 4, 0, 30), COLORS.Sub)
			label(f, Format.Mult(def.Mult), UDim2.new(1, -8, 0, 22), UDim2.new(0, 4, 0, 48), COLORS.Accent, Enum.Font.FredokaOne)
			local eq = button(f, if equipped then "Unequip" else "Equip", UDim2.new(1, -12, 0, 26), UDim2.new(0, 6, 0, 74), if equipped then Color3.fromRGB(120, 120, 130) else COLORS.Good)
			eq.MouseButton1Click:Connect(function()
				request(if equipped then "Unequip" else "Equip", pet.Id)
			end)
			local del = button(f, "Delete", UDim2.new(1, -12, 0, 20), UDim2.new(0, 6, 0, 104), COLORS.Bad)
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
		local key = #state.Pets .. "|" .. table.concat(state.Equipped, ",") .. "|" .. state.Slots
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
-- Eggs panel (hatch from anywhere once unlocked)
---------------------------------------------------------------------------
do
	local _, body = makePanel("Eggs", "Eggs", Color3.fromRGB(255, 160, 60))
	list(body, 0)
	for i, key in Config.EggOrder do
		local egg = Config.Eggs[key]
		local c = card(body, 96, i)
		local t = label(c, egg.Name, UDim2.new(0.6, 0, 0, 30), UDim2.new(0, 14, 0, 6), COLORS.Text, Enum.Font.FredokaOne)
		t.TextXAlignment = Enum.TextXAlignment.Left
		local odds = {}
		local total = 0
		for _, pet in egg.Pets do
			total += pet.Weight
		end
		for _, pet in egg.Pets do
			table.insert(odds, string.format("%s %s (%d%%)", pet.Name, Format.Mult(pet.Mult), math.floor(pet.Weight / total * 100 + 0.5)))
		end
		local o = label(c, table.concat(odds, "  •  "), UDim2.new(0.62, 0, 0, 48), UDim2.new(0, 14, 0, 40), COLORS.Sub, Enum.Font.Gotham)
		o.TextWrapped = true
		o.TextXAlignment = Enum.TextXAlignment.Left
		local buy = button(c, "", UDim2.new(0.32, 0, 0, 64), UDim2.new(0.66, 0, 0, 16), COLORS.Good)
		buy.MouseButton1Click:Connect(function()
			request("Hatch", key)
		end)
		table.insert(refreshers, function()
			if not state then
				return
			end
			if egg.Zone > state.Zones then
				buy.Text = "Locked"
				buy.BackgroundColor3 = Color3.fromRGB(90, 90, 100)
				return
			end
			local have = if egg.Currency == "Gems" then state.Gems else state.Coins
			buy.Text = Format.Number(egg.Cost) .. (if egg.Currency == "Gems" then " ◆" else " ●")
			buy.BackgroundColor3 = if have >= egg.Cost then COLORS.Good else Color3.fromRGB(90, 90, 100)
		end)
	end
end

---------------------------------------------------------------------------
-- Robux shop
---------------------------------------------------------------------------
do
	local _, body = makePanel("Shop", "Shop", COLORS.Accent)
	list(body, 0)
	local order = 0
	local function priceLabel(id: number, infoType: Enum.InfoType, target: TextButton)
		if id == 0 then
			target.Text = "Coming soon"
			return
		end
		task.spawn(function()
			local ok, info = pcall(MarketplaceService.GetProductInfo, MarketplaceService, id, infoType)
			if ok and info and info.PriceInRobux then
				target.Text = "R$ " .. tostring(info.PriceInRobux)
			else
				target.Text = "Buy"
			end
		end)
	end

	for _, key in { "DoubleCoins", "VIP", "ExtraPetSlots", "LuckyHatch" } do
		local pass = (Config.GamePasses :: any)[key]
		order += 1
		local c = card(body, 80, order)
		local t = label(c, pass.Name, UDim2.new(0.6, 0, 0, 32), UDim2.new(0, 14, 0, 6), COLORS.Accent, Enum.Font.FredokaOne)
		t.TextXAlignment = Enum.TextXAlignment.Left
		local d = label(c, pass.Description, UDim2.new(0.6, 0, 0, 30), UDim2.new(0, 14, 0, 42), COLORS.Sub, Enum.Font.Gotham)
		d.TextXAlignment = Enum.TextXAlignment.Left
		d.TextWrapped = true
		local b = button(c, "...", UDim2.new(0.32, 0, 0, 56), UDim2.new(0.66, 0, 0, 12), COLORS.Good)
		priceLabel(pass.Id, Enum.InfoType.GamePass, b)
		b.MouseButton1Click:Connect(function()
			if pass.Id ~= 0 and not (state and state.Passes[key]) then
				MarketplaceService:PromptGamePassPurchase(player, pass.Id)
			end
		end)
		table.insert(refreshers, function()
			if state and state.Passes[key] then
				b.Text = "OWNED"
				b.BackgroundColor3 = Color3.fromRGB(90, 90, 100)
			end
		end)
	end

	for _, product in Config.Products do
		order += 1
		local c = card(body, 70, order)
		local t = label(c, product.Name, UDim2.new(0.6, 0, 0, 30), UDim2.new(0, 14, 0, 6), COLORS.Text, Enum.Font.FredokaOne)
		t.TextXAlignment = Enum.TextXAlignment.Left
		local d = label(c, "", UDim2.new(0.6, 0, 0, 24), UDim2.new(0, 14, 0, 40), COLORS.Sub, Enum.Font.Gotham)
		d.TextXAlignment = Enum.TextXAlignment.Left
		local b = button(c, "...", UDim2.new(0.32, 0, 0, 50), UDim2.new(0.66, 0, 0, 10), COLORS.Blue)
		priceLabel(product.Id, Enum.InfoType.Product, b)
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
				d.Text = "+" .. Format.Number(product.Amount * (1 + state.Rebirths)) .. " Coins"
			else
				d.Text = "+" .. Format.Number(product.Amount) .. " Gems"
			end
		end)
	end
end

---------------------------------------------------------------------------
-- Rewards panel (daily + codes)
---------------------------------------------------------------------------
do
	local _, body = makePanel("Rewards", "Rewards", Color3.fromRGB(110, 220, 255))
	list(body, 0)
	local dailyCard = card(body, 120, 1)
	label(dailyCard, "Daily Reward", UDim2.new(1, -20, 0, 32), UDim2.new(0, 10, 0, 6), COLORS.Text, Enum.Font.FredokaOne)
	local claim = button(dailyCard, "Claim", UDim2.new(0.6, 0, 0, 56), UDim2.new(0.2, 0, 0, 50), COLORS.Good)
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

	local clockOffset = 0
	table.insert(refreshers, function()
		if not state then
			return
		end
		clockOffset = state.ServerTime - os.time()
	end)
	task.spawn(function()
		while true do
			if state then
				local remaining = Config.DailyCooldown - ((os.time() + clockOffset) - state.LastDaily)
				if remaining <= 0 then
					claim.Text = "Claim!"
					claim.BackgroundColor3 = COLORS.Good
				else
					claim.Text = Format.Time(remaining)
					claim.BackgroundColor3 = Color3.fromRGB(90, 90, 100)
				end
			end
			task.wait(1)
		end
	end)
end

menuButton("Pets", COLORS.Good, "Pets")
menuButton("Eggs", Color3.fromRGB(255, 160, 60), "Eggs")
menuButton("Upgrade", COLORS.Blue, "Upgrades")
menuButton("Rebirth", Color3.fromRGB(255, 120, 200), "Rebirth")
menuButton("Rewards", Color3.fromRGB(110, 220, 255), "Rewards")
menuButton("Shop", COLORS.Accent, "Shop")

---------------------------------------------------------------------------
-- Toast notifications
---------------------------------------------------------------------------
local toastHolder = Instance.new("Frame")
toastHolder.Size = UDim2.new(0, 420, 0, 300)
toastHolder.Position = UDim2.new(0.5, -210, 0, 110)
toastHolder.BackgroundTransparency = 1
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
	corner(f, 10)
	stroke(f, color, 2)
	f.Parent = toastHolder
	local l = label(f, text, UDim2.new(1, -16, 0.75, 0), UDim2.new(0, 8, 0.125, 0), color, Enum.Font.GothamBold)
	task.delay(3, function()
		TweenService:Create(f, TweenInfo.new(0.4), { BackgroundTransparency = 1 }):Play()
		TweenService:Create(l, TweenInfo.new(0.4), { TextTransparency = 1 }):Play()
		task.wait(0.45)
		f:Destroy()
	end)
	while #toastHolder:GetChildren() > 6 do
		for _, c in toastHolder:GetChildren() do
			if c:IsA("Frame") then
				c:Destroy()
				break
			end
		end
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
Hatched.OnClientEvent:Connect(function(name: string, rarity: string, mult: number)
	local color = Config.RarityColors[rarity] or COLORS.Text
	local f = Instance.new("Frame")
	f.Size = UDim2.new(0, 0, 0, 0)
	f.Position = UDim2.new(0.5, 0, 0.45, 0)
	f.AnchorPoint = Vector2.new(0.5, 0.5)
	f.BackgroundColor3 = COLORS.Panel
	corner(f, 20)
	stroke(f, color, 4)
	f.ZIndex = 10
	f.Parent = gui
	local t1 = label(f, "You hatched", UDim2.new(1, 0, 0.2, 0), UDim2.new(0, 0, 0.08, 0), COLORS.Sub, Enum.Font.GothamBold)
	local t2 = label(f, name, UDim2.new(1, -20, 0.32, 0), UDim2.new(0, 10, 0.28, 0), color, Enum.Font.FredokaOne)
	local t3 = label(f, rarity .. "  •  " .. Format.Mult(mult), UDim2.new(1, 0, 0.2, 0), UDim2.new(0, 0, 0.66, 0), COLORS.Accent, Enum.Font.FredokaOne)
	for _, t in { t1, t2, t3 } do
		t.ZIndex = 11
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
	coinsLabel.Text = Format.Number(state.Coins)
	gemsLabel.Text = Format.Number(state.Gems)
	multLabel.Text = Format.Mult(state.Multiplier)
	if zonesChanged then
		updateGates()
	end
	for _, fn in refreshers do
		fn()
	end
end)

task.spawn(function()
	request("GetState")
end)
