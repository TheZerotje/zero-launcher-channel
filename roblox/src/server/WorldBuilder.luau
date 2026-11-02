--!strict
-- Procedurally builds the whole map so the game works from an empty baseplate.

local Workspace = game:GetService("Workspace")
local Lighting = game:GetService("Lighting")

local Config = require(game:GetService("ReplicatedStorage").Shared.Config)
local Format = require(game:GetService("ReplicatedStorage").Shared.Format)

local WorldBuilder = {}

local root: Folder
WorldBuilder.Gates = {} :: { [number]: BasePart }
WorldBuilder.EggStands = {} :: { [string]: BasePart }
WorldBuilder.OrbFolders = {} :: { [number]: Folder }
WorldBuilder.Leaderboard = nil :: SurfaceGui?

local function part(props: { [string]: any }): Part
	local p = Instance.new("Part")
	p.Anchored = true
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	for k, v in props do
		(p :: any)[k] = v
	end
	return p
end

local function billboard(adornee: BasePart, text: string, color: Color3, offsetY: number, size: number?): TextLabel
	local gui = Instance.new("BillboardGui")
	gui.Size = UDim2.fromOffset(320, size or 70)
	gui.StudsOffset = Vector3.new(0, offsetY, 0)
	gui.AlwaysOnTop = false
	gui.MaxDistance = 220
	gui.LightInfluence = 0
	local label = Instance.new("TextLabel")
	label.Size = UDim2.fromScale(1, 1)
	label.BackgroundTransparency = 1
	label.Font = Enum.Font.FredokaOne
	label.TextScaled = true
	label.TextColor3 = color
	label.TextStrokeTransparency = 0.2
	label.Text = text
	label.Parent = gui
	gui.Parent = adornee
	return label
end

function WorldBuilder.ZoneCenter(index: number): Vector3
	return Vector3.new((index - 1) * Config.ZoneSpacing, 0, 0)
end

-- Returns which zone a world X position lies in (nearest center).
function WorldBuilder.ZoneAt(position: Vector3): number
	local i = math.floor(position.X / Config.ZoneSpacing + 0.5) + 1
	return math.clamp(i, 1, #Config.Zones)
end

function WorldBuilder.RandomOrbPosition(index: number): Vector3
	local c = WorldBuilder.ZoneCenter(index)
	local half = Config.ZoneSize / 2 - 12
	local x = c.X + (math.random() * 2 - 1) * half
	local z = c.Z + (math.random() * 2 - 1) * half
	-- keep the spawn pad / egg area clear
	if index == 1 and math.abs(x - c.X) < 22 and math.abs(z - c.Z) < 22 then
		z += 40
	end
	return Vector3.new(x, 3, z)
end

local function buildDecor(zoneIndex: number, center: Vector3, zone: Config.Zone, folder: Folder)
	local rng = Random.new(zoneIndex * 1337)
	local half = Config.ZoneSize / 2
	for _ = 1, 18 do
		local pos = center + Vector3.new(rng:NextNumber(-half + 8, half - 8), 0, rng:NextNumber(-half + 8, half - 8))
		if math.abs(pos.Z) < 30 then
			continue -- keep the main path open
		end
		if zoneIndex == 1 or zoneIndex == 4 then
			local trunk = part({ Size = Vector3.new(2, 10, 2), Position = pos + Vector3.new(0, 5, 0), Color = Color3.fromRGB(110, 75, 45), Material = Enum.Material.Wood, Parent = folder })
			trunk.Name = "Trunk"
			local leaves = part({ Shape = Enum.PartType.Ball, Size = Vector3.new(9, 9, 9), Position = pos + Vector3.new(0, 12, 0), Color = if zoneIndex == 4 then Color3.fromRGB(255, 255, 255) else Color3.fromRGB(70, 150, 60), Material = Enum.Material.Grass, Parent = folder })
			leaves.Name = "Leaves"
		elseif zoneIndex == 2 then
			local crystal = part({ Size = Vector3.new(3, rng:NextNumber(6, 16), 3), Color = zone.Orb, Material = Enum.Material.Glass, Transparency = 0.2, Parent = folder })
			crystal.CFrame = CFrame.new(pos + Vector3.new(0, crystal.Size.Y / 2, 0)) * CFrame.Angles(rng:NextNumber(-0.3, 0.3), rng:NextNumber(0, 6), rng:NextNumber(-0.3, 0.3))
			crystal.Name = "Crystal"
		elseif zoneIndex == 3 then
			local rock = part({ Size = Vector3.new(rng:NextNumber(5, 10), rng:NextNumber(4, 12), rng:NextNumber(5, 10)), Color = Color3.fromRGB(45, 30, 28), Material = Enum.Material.Basalt, Parent = folder })
			rock.Position = pos + Vector3.new(0, rock.Size.Y / 2, 0)
			local lava = part({ Size = Vector3.new(rock.Size.X + 4, 0.4, rock.Size.Z + 4), Position = pos + Vector3.new(0, 0.2, 0), Color = Color3.fromRGB(255, 90, 20), Material = Enum.Material.Neon, CanCollide = false, Parent = folder })
			lava.Name = "LavaGlow"
		else
			local pillar = part({ Size = Vector3.new(4, rng:NextNumber(10, 30), 4), Color = Color3.fromRGB(40, 20, 60), Material = Enum.Material.Slate, Parent = folder })
			pillar.Position = pos + Vector3.new(0, pillar.Size.Y / 2 + 4, 0)
			local glow = Instance.new("PointLight")
			glow.Color = zone.Orb
			glow.Range = 16
			glow.Parent = pillar
		end
	end
end

local function buildZone(index: number, zone: Config.Zone)
	local folder = Instance.new("Folder")
	folder.Name = string.format("Zone%d_%s", index, (zone.Name:gsub(" ", "")))
	folder.Parent = root

	local center = WorldBuilder.ZoneCenter(index)
	local ground = part({
		Name = "Ground",
		Size = Vector3.new(Config.ZoneSize, 4, Config.ZoneSize),
		Position = center - Vector3.new(0, 2, 0),
		Color = zone.Ground,
		Material = if index == 4 then Enum.Material.SmoothPlastic else Enum.Material.Grass,
		Parent = folder,
	})
	if index >= 2 then
		ground.Material = if index == 2 then Enum.Material.Slate elseif index == 3 then Enum.Material.Basalt elseif index == 4 then Enum.Material.Marble else Enum.Material.Foil
	end

	-- Low border walls
	local half = Config.ZoneSize / 2
	for _, spec in {
		{ Vector3.new(0, 3, half), Vector3.new(Config.ZoneSize, 6, 2) },
		{ Vector3.new(0, 3, -half), Vector3.new(Config.ZoneSize, 6, 2) },
	} do
		part({ Name = "Wall", Size = spec[2], Position = center + spec[1], Color = zone.Ground:Lerp(Color3.new(0, 0, 0), 0.35), Transparency = 0.3, Parent = folder })
	end
	if index == 1 then
		part({ Name = "Wall", Size = Vector3.new(2, 6, Config.ZoneSize), Position = center + Vector3.new(-half, 3, 0), Color = zone.Ground:Lerp(Color3.new(0, 0, 0), 0.35), Transparency = 0.3, Parent = folder })
	end
	if index == #Config.Zones then
		part({ Name = "Wall", Size = Vector3.new(2, 6, Config.ZoneSize), Position = center + Vector3.new(half, 3, 0), Color = zone.Ground:Lerp(Color3.new(0, 0, 0), 0.35), Transparency = 0.3, Parent = folder })
	end

	-- Zone sign
	local sign = part({ Name = "Sign", Size = Vector3.new(1, 1, 1), Position = center + Vector3.new(-half + 20, 14, 0), Transparency = 1, CanCollide = false, Parent = folder })
	billboard(sign, zone.Name, zone.Orb, 0, 90)

	buildDecor(index, center, zone, folder)

	-- Bridge + gate to the next zone
	if index < #Config.Zones then
		local gap = Config.ZoneSpacing - Config.ZoneSize
		local bridgeX = center.X + half + gap / 2
		part({ Name = "Bridge", Size = Vector3.new(gap, 4, 40), Position = Vector3.new(bridgeX, -2, 0), Color = Color3.fromRGB(120, 100, 80), Material = Enum.Material.WoodPlanks, Parent = folder })
		for _, z in { 21, -21 } do
			part({ Name = "Rail", Size = Vector3.new(gap, 4, 2), Position = Vector3.new(bridgeX, 2, z), Color = Color3.fromRGB(90, 70, 55), Material = Enum.Material.Wood, Parent = folder })
		end
		-- side walls of this zone's right edge, leaving the bridge opening
		local sideLen = (Config.ZoneSize - 40) / 2
		for _, z in { 20 + sideLen / 2, -20 - sideLen / 2 } do
			part({ Name = "Wall", Size = Vector3.new(2, 6, sideLen), Position = Vector3.new(center.X + half, 3, z), Color = zone.Ground:Lerp(Color3.new(0, 0, 0), 0.35), Transparency = 0.3, Parent = folder })
		end
		local nextZone = Config.Zones[index + 1]
		local gate = part({
			Name = "Gate" .. (index + 1),
			Size = Vector3.new(2, 24, 40),
			Position = Vector3.new(bridgeX, 10, 0),
			Color = nextZone.Orb,
			Material = Enum.Material.ForceField,
			Transparency = 0.2,
			Parent = folder,
		})
		gate:SetAttribute("Zone", index + 1)
		billboard(gate, string.format("%s\n%s Coins", nextZone.Name, Format.Number(nextZone.Cost)), Color3.new(1, 1, 1), 15, 90)
		local prompt = Instance.new("ProximityPrompt")
		prompt.ActionText = "Unlock " .. nextZone.Name
		prompt.ObjectText = Format.Number(nextZone.Cost) .. " Coins"
		prompt.HoldDuration = 0.3
		prompt.MaxActivationDistance = 14
		prompt.RequiresLineOfSight = false
		prompt.Parent = gate
		WorldBuilder.Gates[index + 1] = gate
	end
	if index > 1 then
		local sideLen = (Config.ZoneSize - 40) / 2
		for _, z in { 20 + sideLen / 2, -20 - sideLen / 2 } do
			part({ Name = "Wall", Size = Vector3.new(2, 6, sideLen), Position = Vector3.new(center.X - half, 3, z), Color = zone.Ground:Lerp(Color3.new(0, 0, 0), 0.35), Transparency = 0.3, Parent = folder })
		end
	end

	-- Egg stand for this zone
	local eggKey = zone.Egg
	local egg = Config.Eggs[eggKey]
	local eggPos = center + Vector3.new(-half + 30, 0, -40)
	part({ Name = "EggPedestal", Size = Vector3.new(10, 2, 10), Position = eggPos + Vector3.new(0, 1, 0), Color = Color3.fromRGB(60, 60, 70), Material = Enum.Material.Marble, Parent = folder })
	local eggPart = part({
		Name = "Egg_" .. eggKey,
		Shape = Enum.PartType.Ball,
		Size = Vector3.new(6, 7.5, 6),
		Position = eggPos + Vector3.new(0, 5.8, 0),
		Color = zone.Orb,
		Material = Enum.Material.SmoothPlastic,
		Parent = folder,
	})
	local mesh = Instance.new("SpecialMesh")
	mesh.MeshType = Enum.MeshType.Sphere
	mesh.Scale = Vector3.new(1, 1.25, 1)
	mesh.Parent = eggPart
	billboard(eggPart, string.format("%s\n%s %s", egg.Name, Format.Number(egg.Cost), egg.Currency), Color3.new(1, 1, 1), 6.5, 80)
	local eggPrompt = Instance.new("ProximityPrompt")
	eggPrompt.ActionText = "Hatch"
	eggPrompt.ObjectText = egg.Name
	eggPrompt.KeyboardKeyCode = Enum.KeyCode.E
	eggPrompt.MaxActivationDistance = 12
	eggPrompt.RequiresLineOfSight = false
	eggPrompt.Parent = eggPart
	WorldBuilder.EggStands[eggKey] = eggPart

	local orbs = Instance.new("Folder")
	orbs.Name = "Orbs"
	orbs.Parent = folder
	WorldBuilder.OrbFolders[index] = orbs
end

local function buildSpawn()
	local center = WorldBuilder.ZoneCenter(1)
	local spawn = Instance.new("SpawnLocation")
	spawn.Name = "Spawn"
	spawn.Anchored = true
	spawn.Size = Vector3.new(14, 1, 14)
	spawn.Position = center + Vector3.new(-60, 0.5, 0)
	spawn.Color = Color3.fromRGB(40, 40, 50)
	spawn.Material = Enum.Material.Neon
	spawn.Duration = 0
	spawn.Parent = root

	-- Mythic (gem) egg next to spawn
	local egg = Config.Eggs.Mythic
	local eggPos = center + Vector3.new(-60, 0, 30)
	part({ Name = "MythicPedestal", Size = Vector3.new(10, 2, 10), Position = eggPos + Vector3.new(0, 1, 0), Color = Color3.fromRGB(255, 70, 120), Material = Enum.Material.Neon, Parent = root })
	local eggPart = part({ Name = "Egg_Mythic", Shape = Enum.PartType.Ball, Size = Vector3.new(6, 7.5, 6), Position = eggPos + Vector3.new(0, 5.8, 0), Color = Color3.fromRGB(255, 120, 200), Material = Enum.Material.Glass, Parent = root })
	local mesh = Instance.new("SpecialMesh")
	mesh.MeshType = Enum.MeshType.Sphere
	mesh.Scale = Vector3.new(1, 1.25, 1)
	mesh.Parent = eggPart
	local sparkle = Instance.new("Sparkles")
	sparkle.Parent = eggPart
	billboard(eggPart, string.format("%s\n%s Gems", egg.Name, Format.Number(egg.Cost)), Color3.fromRGB(255, 160, 220), 6.5, 80)
	local prompt = Instance.new("ProximityPrompt")
	prompt.ActionText = "Hatch"
	prompt.ObjectText = egg.Name
	prompt.MaxActivationDistance = 12
	prompt.RequiresLineOfSight = false
	prompt.Parent = eggPart
	WorldBuilder.EggStands.Mythic = eggPart

	-- Global leaderboard board
	local board = part({ Name = "Leaderboard", Size = Vector3.new(24, 30, 1), Position = center + Vector3.new(-100, 15, 0), Color = Color3.fromRGB(25, 25, 35), Material = Enum.Material.SmoothPlastic, Parent = root })
	board.CFrame = CFrame.lookAt(board.Position, center + Vector3.new(-60, 15, 0))
	local gui = Instance.new("SurfaceGui")
	gui.Face = Enum.NormalId.Front
	gui.CanvasSize = Vector2.new(480, 600)
	gui.LightInfluence = 0
	gui.Parent = board
	WorldBuilder.Leaderboard = gui
end

function WorldBuilder.Build()
	local existing = Workspace:FindFirstChild("ZeroRealms")
	if existing then
		existing:Destroy()
	end
	root = Instance.new("Folder")
	root.Name = "ZeroRealms"
	root.Parent = Workspace

	local baseplate = Workspace:FindFirstChild("Baseplate")
	if baseplate then
		baseplate:Destroy()
	end

	for i, zone in Config.Zones do
		buildZone(i, zone)
	end
	buildSpawn()

	-- Atmosphere
	if not Lighting:FindFirstChildOfClass("Atmosphere") then
		local atm = Instance.new("Atmosphere")
		atm.Density = 0.3
		atm.Haze = 1
		atm.Parent = Lighting
	end
	if not Lighting:FindFirstChildOfClass("BloomEffect") then
		local bloom = Instance.new("BloomEffect")
		bloom.Intensity = 0.6
		bloom.Threshold = 1.6
		bloom.Parent = Lighting
	end

	-- Kill floor (respawn if you fall off)
	local kill = part({ Name = "KillFloor", Size = Vector3.new(4000, 2, 4000), Position = Vector3.new(Config.ZoneSpacing * 2, -80, 0), Transparency = 1, CanCollide = false, Parent = root })
	kill.Touched:Connect(function(hit)
		local hum = hit.Parent and hit.Parent:FindFirstChildOfClass("Humanoid")
		if hum then
			hum.Health = 0
		end
	end)

	return root
end

return WorldBuilder
