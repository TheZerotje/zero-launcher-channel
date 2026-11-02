--!strict
-- Renders every player's equipped pets locally (smooth, zero server cost).

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local Workspace = game:GetService("Workspace")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))

local folder = Instance.new("Folder")
folder.Name = "LocalPets"
folder.Parent = Workspace

type Follower = { Part: BasePart, Name: string }
local followers: { [Player]: { Follower } } = {}

local function makePet(name: string): BasePart
	local def = Config.PetIndex[name]
	local color = if def then Config.RarityColors[def.Rarity] else Color3.new(1, 1, 1)
	local body = Instance.new("Part")
	body.Name = name
	body.Shape = Enum.PartType.Ball
	body.Size = Vector3.new(2.4, 2.4, 2.4)
	body.Color = color
	body.Material = if def and (def.Rarity == "Legendary" or def.Rarity == "Mythic") then Enum.Material.Neon else Enum.Material.SmoothPlastic
	body.Anchored = true
	body.CanCollide = false
	body.CanQuery = false
	body.CanTouch = false
	body.CastShadow = false
	for _, x in { -0.45, 0.45 } do
		local eye = Instance.new("Part")
		eye.Shape = Enum.PartType.Ball
		eye.Size = Vector3.new(0.45, 0.45, 0.45)
		eye.Color = Color3.new(0.05, 0.05, 0.05)
		eye.CanCollide = false
		eye.CanQuery = false
		eye.CanTouch = false
		eye.Massless = true
		eye.Anchored = false
		local weld = Instance.new("Weld")
		weld.Part0 = body
		weld.Part1 = eye
		weld.C0 = CFrame.new(x, 0.35, -1.05)
		weld.Parent = eye
		eye.Parent = body
	end
	if def and def.Rarity == "Mythic" then
		local s = Instance.new("Sparkles")
		s.Parent = body
	end
	local gui = Instance.new("BillboardGui")
	gui.Size = UDim2.fromOffset(120, 22)
	gui.StudsOffset = Vector3.new(0, 2.2, 0)
	gui.MaxDistance = 60
	local l = Instance.new("TextLabel")
	l.Size = UDim2.fromScale(1, 1)
	l.BackgroundTransparency = 1
	l.Font = Enum.Font.FredokaOne
	l.TextScaled = true
	l.TextColor3 = color
	l.TextStrokeTransparency = 0.3
	l.Text = name
	l.Parent = gui
	gui.Parent = body
	body.Parent = folder
	return body
end

local function sync(player: Player)
	local wanted = string.split((player:GetAttribute("EquippedPets") :: string?) or "", ",")
	local current = followers[player] or {}
	local names = {}
	for _, n in wanted do
		if n ~= "" then
			table.insert(names, n)
		end
	end
	-- rebuild if changed
	local same = #names == #current
	if same then
		for i, n in names do
			if current[i].Name ~= n then
				same = false
				break
			end
		end
	end
	if same then
		return
	end
	for _, f in current do
		f.Part:Destroy()
	end
	local list = {}
	for _, n in names do
		table.insert(list, { Part = makePet(n), Name = n })
	end
	followers[player] = list
end

local function watch(player: Player)
	player:GetAttributeChangedSignal("EquippedPets"):Connect(function()
		sync(player)
	end)
	sync(player)
end

Players.PlayerAdded:Connect(watch)
for _, p in Players:GetPlayers() do
	watch(p)
end
Players.PlayerRemoving:Connect(function(player)
	for _, f in followers[player] or {} do
		f.Part:Destroy()
	end
	followers[player] = nil
end)

local t = 0
RunService.RenderStepped:Connect(function(dt)
	t += dt
	for player, list in followers do
		local character = player.Character
		local root = character and character:FindFirstChild("HumanoidRootPart") :: BasePart?
		if not root then
			continue
		end
		local n = #list
		for i, f in list do
			local angle = (i - (n + 1) / 2) * 0.7
			local offset = CFrame.Angles(0, angle, 0) * Vector3.new(0, 0, 6)
			local bob = math.sin(t * 4 + i) * 0.4
			local target = root.CFrame * CFrame.new(offset.X, -1 + bob, offset.Z)
			local pos = f.Part.Position:Lerp(target.Position, math.min(1, dt * 10))
			f.Part.CFrame = CFrame.lookAt(pos, pos + root.CFrame.LookVector)
		end
	end
end)
