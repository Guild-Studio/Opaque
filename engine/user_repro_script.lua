local Version = "1.6.66"
local success, windUI = pcall(function()
    return loadstring(game:HttpGet("https://github.com/Footagesus/WindUI/releases/download/1.6.66/main.lua"))()
end)

if not success or not windUI then
    warn("⚠️ UI failed to load!")
    return
else
    warn("✓ UI loaded successfully!")
end

local playersService = game:GetService("Players")
local runService = game:GetService("RunService")
local workspaceService = workspace
local replicatedStorage = game:GetService("ReplicatedStorage")
local userInputService = game:GetService("UserInputService")
local virtualUserService = game:GetService("VirtualUser")
local virtualInputManager = game:GetService("VirtualInputManager")
local tweenService = game:GetService("TweenService")
local collectionService = game:GetService("CollectionService")
local lightingService = game:GetService("Lighting")
local teleportService = game:GetService("TeleportService")
local httpService = game:GetService("HttpService")

local localPlayer = playersService.LocalPlayer

local remotes = replicatedStorage:WaitForChild("Remotes")
local rebirthRemote = remotes:WaitForChild("Rebirth")
local selectUpgradeRemote = remotes:WaitForChild("SelectUpgrade")
local teleportWorldRemote = remotes:WaitForChild("TeleportWorld")
local buyTrailRemote = remotes:WaitForChild("BuyTrail")
local equipTrailRemote = remotes:WaitForChild("EquipTrail")
local buyAuraRemote = remotes:WaitForChild("BuyAura")
local equipAuraRemote = remotes:WaitForChild("EquipAura")
local equipBestCharmsRemote = remotes:WaitForChild("EquipBestCharms")
local usePotionRemote = remotes:WaitForChild("UsePotion")

local upgradesConfig = {}
local trailsConfig = {}
local aurasConfig = {}
pcall(function()
	upgradesConfig = require(replicatedStorage.Config.Upgrades)
end)
pcall(function()
	trailsConfig = require(replicatedStorage.Config.Trails)
end)
pcall(function()
	aurasConfig = require(replicatedStorage.Config.Auras)
end)

local function getHumanoid()
	local character = localPlayer.Character
	return character and character:FindFirstChildOfClass("Humanoid")
end

local function getHrp()
	local character = localPlayer.Character
	return character and character:FindFirstChild("HumanoidRootPart")
end

local function requestStream(position)
	pcall(function()
		localPlayer:RequestStreamAroundAsync(position, 1)
	end)
end

local function Notify(title, message, duration, icon)
	pcall(function()
		windUI:Notify({ Title = title, Content = message, Duration = duration or 3, Icon = icon or "info" })
	end)
end

windUI:AddTheme({
	Name = "Yolk",
	Accent = "#D9A066",
	Dialog = "#1B1C25",
	Outline = "#2B2C38",
	Text = "#F2F0EA",
	Placeholder = "#8A8B99",
	Background = "#14151D",
	Button = "#20212C",
	Icon = "#D9A066",
})

local Window = windUI:CreateWindow({
	Title = "Yolk Hub",
	Icon = "rbxassetid://102847073936864",
	Author = "By Shoyo",
	Folder = "YolkHub",
	Size = UDim2.fromOffset(280, 320),
	Transparent = true,
	Theme = "Yolk",
	SideBarWidth = 200,
	ScrollBarEnabled = true,
	HideSearchBar = false,
	NewElements = true,
	Resizable = true,
	User = { Enabled = true, Anonymous = false },
	Topbar = { Height = 45, ButtonsType = "Mac" },
})

Window:Tag({
	Title = "+1 Speed Monkey",
	Icon = "circle-check",
	Color = Color3.fromHex("#D9A066"),
})

Window:EditOpenButton({
	Title = "Yolk Hub",
	Icon = "rbxassetid://102847073936864",
	CornerRadius = UDim.new(0, 12),
	StrokeThickness = 1,
	Color = ColorSequence.new(Color3.fromHex("D9A066"), Color3.fromHex("F2C79A")),
	OnlyMobile = false,
	Enabled = true,
	Draggable = true,
})

Window:Tag({
	Title = "v2.2",
	Color = Color3.fromHex("#52514f"),
})

local Tabs = {
	Main = Window:Tab({ Title = "Main", Icon = "house", Opened = true }),
	Farm = Window:Tab({ Title = "Insta Wins", Icon = "trophy" }),
	Automation = Window:Tab({ Title = "Automation", Icon = "cog" }),
	Shop = Window:Tab({ Title = "Shop", Icon = "shopping-cart" }),
	Collectibles = Window:Tab({ Title = "Collectibles", Icon = "gem" }),
	Player = Window:Tab({ Title = "Player", Icon = "footprints" }),
	Visuals = Window:Tab({ Title = "Visuals", Icon = "eye" }),
	Settings = Window:Tab({ Title = "Settings", Icon = "settings" }),
}

Tabs.Main:Paragraph({
	Title = "Yolk Hub - Update v2.2",
	Desc = "line1 \n line2",
	Image = "sparkles",
	ImageSize = 20,
	Color = Color3.fromHex("#D9A066"),
})

Tabs.Main:Paragraph({
	Title = "Credits & Information",
	Desc = "Developed by Shoyo for the Yolk Hub community. Enjoy the script!",
	Image = "code",
	ImageSize = 20,
	Color = Color3.fromHex("#D9A066"),
})

local linksSection = Tabs.Main:Section({ Title = "Support", Opened = true })

linksSection:Button({
	Title = "Discord",
	Desc = "Join our support server",
	Icon = "message-circle",
	Callback = function()
		pcall(function() setclipboard("https://discord.gg/2P5dgeqyNK") end)
		Notify("Yolk Hub", "Discord link copied", 3, "message-circle")
	end,
})

local function getWorldNames()
	local worlds = {}
	local checkpointsRoot = workspaceService:FindFirstChild("Map") and workspaceService.Map:FindFirstChild("Checkpoints")
	if not checkpointsRoot then return worlds end
	for _, world in ipairs(checkpointsRoot:GetChildren()) do
		local hasCheckpoint = false
		for _, child in ipairs(world:GetChildren()) do
			if type(child.Name) == "string" and child.Name:match("^Checkpoint%d+$") then
				hasCheckpoint = true
				break
			end
		end
		if hasCheckpoint then
			table.insert(worlds, world.Name)
		end
	end
	table.sort(worlds, function(a, b)
		return (tonumber(a:match("%d+")) or 0) < (tonumber(b:match("%d+")) or 0)
	end)
	return worlds
end

local function getCheckpointOrder(checkpointName)
	return tonumber((checkpointName or ""):match("%d+")) or 0
end

local function getCheckpoints(worldName)
	local checkpoints = {}
	local checkpointsRoot = workspaceService:FindFirstChild("Map") and workspaceService.Map:FindFirstChild("Checkpoints")
	local worldFolder = checkpointsRoot and checkpointsRoot:FindFirstChild(worldName)
	if not worldFolder then return checkpoints end
	for _, checkpoint in ipairs(worldFolder:GetChildren()) do
		if checkpoint:IsA("Model") and checkpoint.Name:match("^Checkpoint%d+$") then
			table.insert(checkpoints, checkpoint)
		end
	end
	table.sort(checkpoints, function(a, b)
		return getCheckpointOrder(a.Name) < getCheckpointOrder(b.Name)
	end)
	return checkpoints
end

local function getCheckpointNames(worldName)
	local names = {}
	for _, checkpoint in ipairs(getCheckpoints(worldName)) do
		table.insert(names, checkpoint.Name)
	end
	return names
end

local function ensureActiveWorld(worldName)
	local data = localPlayer:FindFirstChild("Data")
	local worldValue = data and data:FindFirstChild("World")
	if not worldValue then return true end

	local targetNumber = tonumber(worldName:match("%d+"))
	if not targetNumber then return false end

	if worldValue.Value == targetNumber then return true end

	local map = workspaceService:FindFirstChild("Map")
	local spawnsFolder = map and map:FindFirstChild("Spawns")
	local spawnLoc = spawnsFolder and spawnsFolder:FindFirstChild("SpawnLocation" .. targetNumber)
	local hrp = getHrp()
	if hrp and spawnLoc then
		hrp.CFrame = spawnLoc.CFrame + Vector3.new(0, 3, 0)
	end

	teleportWorldRemote:FireServer(targetNumber)

	local deadline = tick() + 6
	while worldValue.Value ~= targetNumber and tick() < deadline do
		task.wait(0.3)
		if hrp and spawnLoc then
			hrp.CFrame = spawnLoc.CFrame + Vector3.new(0, 3, 0)
		end
		teleportWorldRemote:FireServer(targetNumber)
	end

	return worldValue.Value == targetNumber
end

local function getStageWinTargets(worldName, stageNumber)
	local targets = {}
	local map = workspaceService:FindFirstChild("Map")
	if not map then return targets end

	local checkpointsRoot = map:FindFirstChild("Checkpoints")
	local worldCheckpoints = checkpointsRoot and checkpointsRoot:FindFirstChild(worldName)
	local checkpointModel = worldCheckpoints and (worldCheckpoints:FindFirstChild("Checkpoint" .. stageNumber) or worldCheckpoints:FindFirstChild("Stage" .. stageNumber))

	if checkpointModel then
		local spawnPt = checkpointModel:FindFirstChild("SpawnPoint")
		if spawnPt and spawnPt:IsA("BasePart") then
			table.insert(targets, { Part = spawnPt })
		end
		local hitbox = checkpointModel:FindFirstChild("Hitbox")
		if hitbox and hitbox:IsA("BasePart") then
			table.insert(targets, { Part = hitbox })
		end
	end

	local allCheckpoints = worldCheckpoints and worldCheckpoints:GetChildren() or {}
	local maxStage = 0
	for _, cp in ipairs(allCheckpoints) do
		local order = tonumber(cp.Name:match("%d+")) or 0
		if order > maxStage then maxStage = order end
	end

	if stageNumber == maxStage or stageNumber == 9 then
		local worldFolder = map:FindFirstChild(worldName)
		if worldFolder and checkpointModel then
			local pivot = checkpointModel:GetPivot().Position
			for _, desc in ipairs(worldFolder:GetDescendants()) do
				if desc:IsA("BasePart") and desc.CanTouch and desc.Name == "Button" then
					local parentName = desc.Parent and desc.Parent.Name:lower() or ""
					if parentName:find("normalwin") then
						local dist = (desc.Position - pivot).Magnitude
						if dist <= 150 then
							local alreadyAdded = false
							for _, t in ipairs(targets) do
								if t.Part == desc then alreadyAdded = true break end
							end
							if not alreadyAdded then
								table.insert(targets, { Part = desc })
							end
						end
					end
				end
			end
		end
	end

	if #targets == 0 then
		if checkpointModel then
			table.insert(targets, { Position = checkpointModel:GetPivot().Position, Marker = true })
		end
	end

	return targets
end

local function touchWinTarget(target)
	local hrp = getHrp()
	if not (target and hrp) then return false end

	local part = target.Part
	local targetCFrame = part and part.CFrame or (target.Position and CFrame.new(target.Position))
	if not targetCFrame then return false end

	local dist = (hrp.Position - targetCFrame.Position).Magnitude
	hrp.CFrame = targetCFrame

	if dist > 2000 then
		task.wait(0.35)
	elseif dist > 500 then
		task.wait(0.22)
	else
		task.wait(0.08)
	end

	if part and typeof(firetouchinterest) == "function" and part.CanTouch then
		for _ = 1, 2 do
			firetouchinterest(hrp, part, 0)
			task.wait(0.03)
			firetouchinterest(hrp, part, 1)
			task.wait(0.03)
		end
	end

	local map = workspaceService:FindFirstChild("Map")
	if map then
		local charPos = hrp.Position
		for _, desc in ipairs(map:GetDescendants()) do
			if desc:IsA("BasePart") and desc.CanTouch and desc.Name == "Button" then
				local parentName = desc.Parent and desc.Parent.Name:lower() or ""
				if parentName:find("normalwin") then
					local btnDist = (desc.Position - charPos).Magnitude
					if btnDist <= 150 then
						hrp.CFrame = desc.CFrame
						task.wait(0.04)
						firetouchinterest(hrp, desc, 0)
						task.wait(0.02)
						firetouchinterest(hrp, desc, 1)
						task.wait(0.04)
					end
				end
			end
		end
	end

	task.wait(0.05)
	return true
end

local winsSection = Tabs.Farm:Section({ Title = "Insta Wins", Opened = true })

winsSection:Paragraph({
	Title = "Unlocked worlds only",
	Desc = "The script automatically switches to the selected active world.",
	Image = "alert-triangle",
	ImageSize = 18,
	Color = Color3.fromHex("#D9A066"),
})

local allWorldNames = getWorldNames()
local selectedFarmWorld = allWorldNames[1] or "World1"
local farmStageDropdown

local function getStageDropdownValues(worldName)
	local values = {}
	for _, stageName in ipairs(getCheckpointNames(worldName)) do
		table.insert(values, stageName)
	end
	return values
end

local initialStageValues = getStageDropdownValues(selectedFarmWorld)
local selectedFarmStage = initialStageValues[#initialStageValues] or initialStageValues[1] or "Checkpoint1"

winsSection:Dropdown({
	Title = "World to farm",
	Values = allWorldNames,
	Value = selectedFarmWorld,
	Callback = function(value)
		selectedFarmWorld = value
		local names = getStageDropdownValues(selectedFarmWorld)
		selectedFarmStage = names[#names] or names[1] or "Checkpoint1"
		if farmStageDropdown then
			farmStageDropdown:Refresh(names)
			farmStageDropdown:Set(selectedFarmStage)
		end
	end,
})

farmStageDropdown = winsSection:Dropdown({
	Title = "Stage to farm",
	Values = initialStageValues,
	Value = selectedFarmStage,
	Callback = function(value)
		selectedFarmStage = value
	end,
})

local farmDelaySeconds = 0.4
winsSection:Slider({
	Title = "Activation delay",
	Icon = "timer",
	Value = { Min = 0.2, Max = 5, Default = 0.4 },
	Callback = function(value)
		farmDelaySeconds = value
	end,
})

local autoFarmWinsEnabled = false

local function runFarmCycle()
	if not selectedFarmWorld or not selectedFarmStage then
		Notify("Insta Wins", "No world or stage was selected", 2, "x-circle")
		autoFarmWinsEnabled = false
		return
	end

	while autoFarmWinsEnabled do
		if not ensureActiveWorld(selectedFarmWorld) then
			Notify("Insta Wins", "Could not switch to " .. selectedFarmWorld .. " (check your Rebirths)", 4, "x-circle")
			autoFarmWinsEnabled = false
			return
		end

		local stageNumber = getCheckpointOrder(selectedFarmStage)
		local winTargets = getStageWinTargets(selectedFarmWorld, stageNumber)
		if #winTargets > 0 then
			for _, target in ipairs(winTargets) do
				if not autoFarmWinsEnabled then break end
				touchWinTarget(target)
			end
		end

		task.wait(farmDelaySeconds)
	end
end

winsSection:Toggle({
	Title = "Insta Wins",
	Icon = "trophy",
	Flag = "AutoFarmWinsToggle",
	Value = false,
	Callback = function(state)
		autoFarmWinsEnabled = state
		if state then
			task.spawn(runFarmCycle)
		else
			Notify("Insta Wins", "Farming stopped", 2, "x-circle")
		end
	end,
})

local rebirthSection = Tabs.Automation:Section({ Title = "Rebirth", Opened = true })

local autoRebirthEnabled = false
local autoRebirthInterval = 5

task.spawn(function()
	while true do
		task.wait(autoRebirthInterval)
		if autoRebirthEnabled then
			pcall(function()
				rebirthRemote:FireServer()
			end)
		end
	end
end)

rebirthSection:Toggle({
	Title = "Auto Rebirth",
	Icon = "refresh-cw",
	Flag = "AutoRebirthToggle",
	Value = false,
	Callback = function(state)
		autoRebirthEnabled = state
	end,
})

rebirthSection:Slider({
	Title = "Rebirth interval",
	Icon = "timer",
	Value = { Min = 2, Max = 30, Default = 5 },
	Callback = function(value)
		autoRebirthInterval = value
	end,
})

local upgradesSection = Tabs.Automation:Section({ Title = "Upgrades", Opened = true })

local autoBuyUpgradesEnabled = false
local upgradesBuyInterval = 3

task.spawn(function()
	while true do
		task.wait(upgradesBuyInterval)
		if autoBuyUpgradesEnabled then
			pcall(function()
				for upgradeId in pairs(upgradesConfig) do
					selectUpgradeRemote:FireServer(upgradeId)
				end
			end)
		end
	end
end)

upgradesSection:Toggle({
	Title = "Auto Buy Upgrades",
	Icon = "trending-up",
	Flag = "AutoBuyUpgradesToggle",
	Value = false,
	Callback = function(state)
		autoBuyUpgradesEnabled = state
	end,
})

upgradesSection:Slider({
	Title = "Purchase interval",
	Icon = "timer",
	Value = { Min = 1, Max = 30, Default = 3 },
	Callback = function(value)
		upgradesBuyInterval = value
	end,
})

local treadmillSection = Tabs.Automation:Section({ Title = "Treadmills", Opened = true })

local selectedTreadmillType = "Basic"
local autoTreadmillEnabled = false

local function findTreadmill(tType)
	local cs = collectionService
	for _, inst in ipairs(cs:GetTagged("Treadmill")) do
		if inst:IsA("BasePart") then
			local instType = inst:GetAttribute("Type") or inst.Name
			if instType:lower():find(tType:lower()) or inst.Name:lower():find(tType:lower()) then
				return inst
			end
		end
	end
	for _, inst in ipairs(cs:GetTagged("QuantumTreadmill")) do
		local part = inst:IsA("BasePart") and inst or inst:FindFirstChildWhichIsA("BasePart", true)
		if part then return part end
	end
	return nil
end

task.spawn(function()
	while true do
		task.wait(0.2)
		if autoTreadmillEnabled then
			local hrp = getHrp()
			local tm = findTreadmill(selectedTreadmillType)
			if hrp and tm then
				hrp.CFrame = tm.CFrame + Vector3.new(0, 2.5, 0)
				if typeof(firetouchinterest) == "function" and tm.CanTouch then
					firetouchinterest(hrp, tm, 0)
				end
			end
		end
	end
end)

treadmillSection:Dropdown({
	Title = "Treadmill type",
	Values = { "Basic", "Golden", "Diamond", "Galaxy", "Celestial", "Void", "Quantum" },
	Value = "Basic",
	Callback = function(value)
		selectedTreadmillType = value
	end,
})

treadmillSection:Toggle({
	Title = "Auto Treadmill Farm",
	Icon = "activity",
	Flag = "AutoTreadmillToggle",
	Value = false,
	Callback = function(state)
		autoTreadmillEnabled = state
	end,
})

treadmillSection:Button({
	Title = "Teleport to Treadmill",
	Icon = "map-pin",
	Callback = function()
		local hrp = getHrp()
		local tm = findTreadmill(selectedTreadmillType)
		if hrp and tm then
			hrp.CFrame = tm.CFrame + Vector3.new(0, 3, 0)
			Notify("Treadmills", "Teleported to " .. selectedTreadmillType .. " Treadmill", 2, "check")
		else
			Notify("Treadmills", selectedTreadmillType .. " Treadmill not found in current world", 3, "x-circle")
		end
	end,
})

local quantumAvailable = false
local quantumNotified = false

task.spawn(function()
	while true do
		task.wait(1)
		local qtm = findTreadmill("Quantum")
		if qtm then
			quantumAvailable = true
			if not quantumNotified then
				quantumNotified = true
			end
		else
			quantumAvailable = false
			quantumNotified = false
		end
	end
end)

treadmillSection:Button({
	Title = "Farm Quantum Treadmill",
	Icon = "zap",
	Callback = function()
		local qtm = findTreadmill("Quantum")
		if qtm then
			selectedTreadmillType = "Quantum"
			autoTreadmillEnabled = true
			local hrp = getHrp()
			if hrp then
				requestStream(qtm.Position)
				hrp.CFrame = qtm.CFrame + Vector3.new(0, 2.5, 0)
				if typeof(firetouchinterest) == "function" and qtm.CanTouch then
					firetouchinterest(hrp, qtm, 0)
				end
			end
			Notify("Quantum Treadmill", "Teleported to Quantum Treadmill & Auto Farm activated!", 2, "check")
		else
			Notify("Quantum Treadmill", "Quantum Treadmill has NOT spawned yet in this world!.", 2, "alert-circle")
		end
	end,
})

local secretDoorSection = Tabs.Automation:Section({ Title = "Secret Door & Key", Opened = true })

secretDoorSection:Paragraph({
	Title = "Secret Door Off",
	Desc = "None of these secret door options are working.",
	Image = "alert-triangle",
	ImageSize = 18,
	Color = Color3.fromHex("#D9A066"),
})

local autoSecretDoorEnabled = false
local autoSecretChestsEnabled = false
local autoCollectKeyEnabled = false

local function findSecretKey()
	for _, desc in ipairs(workspaceService:GetDescendants()) do
		if desc:IsA("Model") and desc.Name == "Key" and desc.Parent ~= replicatedStorage then
			local hitbox = desc:FindFirstChild("Hitbox") or desc:FindFirstChildWhichIsA("BasePart", true)
			if hitbox then
				return desc, hitbox
			end
		end
	end
	return nil, nil
end

task.spawn(function()
	while true do
		task.wait(0.5)
		if autoCollectKeyEnabled then
			local hrp = getHrp()
			local keyModel, hitbox = findSecretKey()
			if hrp and hitbox then
				hrp.CFrame = hitbox.CFrame
				task.wait(0.04)
				if typeof(firetouchinterest) == "function" and hitbox.CanTouch then
					firetouchinterest(hrp, hitbox, 0)
					task.wait(0.02)
					firetouchinterest(hrp, hitbox, 1)
				end
			end
		end
	end
end)

secretDoorSection:Toggle({
	Title = "Auto Collect Secret Key",
	Icon = "key",
	Flag = "AutoCollectKeyToggle",
	Value = false,
	Callback = function(state)
		autoCollectKeyEnabled = state
	end,
})

secretDoorSection:Button({
	Title = "Teleport to Secret Door",
	Icon = "door-open",
	Callback = function()
		local hrp = getHrp()
		local secretDoor = workspaceService:FindFirstChild("Map") and workspaceService.Map:FindFirstChild("SecretDoor")
		if hrp and secretDoor then
			local targetPos = secretDoor:GetPivot().Position + Vector3.new(0, 3, 0)
			hrp.CFrame = CFrame.new(targetPos)
			Notify("Secret Door", "Teleported to Secret Door", 2, "check")
		else
			Notify("Secret Door", "Secret Door not found in Map", 3, "x-circle")
		end
	end,
})

task.spawn(function()
	while true do
		task.wait(1)
		if autoSecretDoorEnabled then
			pcall(function()
				secretDoorEnterRemote:FireServer()
			end)
		end
		if autoSecretChestsEnabled then
			pcall(function()
				for chestIndex = 1, 6 do
					openSecretChestRemote:FireServer(chestIndex)
				end
			end)
		end
	end
end)

secretDoorSection:Toggle({
	Title = "Auto Enter Secret Door",
	Icon = "log-in",
	Flag = "AutoSecretDoorToggle",
	Value = false,
	Callback = function(state)
		autoSecretDoorEnabled = state
	end,
})

secretDoorSection:Toggle({
	Title = "Auto Open Secret Chests",
	Icon = "package",
	Flag = "AutoSecretChestsToggle",
	Value = false,
	Callback = function(state)
		autoSecretChestsEnabled = state
	end,
})

local clickerSection = Tabs.Automation:Section({ Title = "Auto Clicker", Opened = true })

local autoClickerEnabled = false
clickerSection:Toggle({
	Title = "Auto Clicker (+1 Speed)",
	Icon = "mouse-pointer-click",
	Flag = "AutoClickerToggle",
	Value = false,
	Callback = function(state)
		autoClickerEnabled = state
	end,
})

task.spawn(function()
	while true do
		task.wait(0.04)
		if autoClickerEnabled then
			pcall(function()
				virtualUserService:CaptureController()
				virtualUserService:ClickButton1(Vector2.new(500, 500))
			end)
			pcall(function()
				virtualInputManager:SendMouseButtonEvent(500, 500, 0, true, game, 0)
				task.wait(0.01)
				virtualInputManager:SendMouseButtonEvent(500, 500, 0, false, game, 0)
			end)
		end
	end
end)

--------------------------------------------------------------------------------
-- Shop tab.
--------------------------------------------------------------------------------

local function formatPrice(value)
	if typeof(value) == "number" then
		return string.format("%d", value)
	end
	return tostring(value)
end

local function buildCosmeticOptions(config)
	local names = {}
	for name in pairs(config) do
		table.insert(names, name)
	end
	table.sort(names, function(a, b)
		local priceA = (config[a] and config[a].Price) or 0
		local priceB = (config[b] and config[b].Price) or 0
		return priceA < priceB
	end)

	local labels = {}
	local labelToName = {}
	for _, name in ipairs(names) do
		local data = config[name]
		local price = data and data.Price
		local label = price and (name .. " - $" .. formatPrice(price)) or name
		table.insert(labels, label)
		labelToName[label] = name
	end

	return labels, labelToName
end

local shopTrailsSection = Tabs.Shop:Section({ Title = "Trails", Opened = true })

local trailLabels, trailLabelToName = buildCosmeticOptions(trailsConfig)
local selectedTrailLabel = trailLabels[1]
local selectedTrailName = selectedTrailLabel and trailLabelToName[selectedTrailLabel]

shopTrailsSection:Dropdown({
	Title = "Trail",
	Values = trailLabels,
	Value = selectedTrailLabel,
	Callback = function(value)
		selectedTrailLabel = value
		selectedTrailName = trailLabelToName[value]
	end,
})

shopTrailsSection:Button({
	Title = "Buy and Equip",
	Icon = "sparkles",
	Callback = function()
		if not selectedTrailName then return end
		pcall(function()
			buyTrailRemote:FireServer(selectedTrailName)
			task.wait(0.3)
			equipTrailRemote:FireServer(selectedTrailName)
		end)
		Notify("Trails", "Requested " .. selectedTrailName, 2, "sparkles")
	end,
})

local autoBuyTrailsEnabled = false
local trailsBuyInterval = 5

task.spawn(function()
	while true do
		task.wait(trailsBuyInterval)
		if autoBuyTrailsEnabled and selectedTrailName then
			pcall(function()
				buyTrailRemote:FireServer(selectedTrailName)
				equipTrailRemote:FireServer(selectedTrailName)
			end)
		end
	end
end)

shopTrailsSection:Toggle({
	Title = "Auto Buy",
	Desc = "Retry the chosen trail until you can afford it",
	Icon = "repeat",
	Flag = "AutoBuyTrailToggle",
	Value = false,
	Callback = function(state)
		autoBuyTrailsEnabled = state
	end,
})

local shopAurasSection = Tabs.Shop:Section({ Title = "Auras", Opened = true })

local auraLabels, auraLabelToName = buildCosmeticOptions(aurasConfig)
local selectedAuraLabel = auraLabels[1]
local selectedAuraName = selectedAuraLabel and auraLabelToName[selectedAuraLabel]

shopAurasSection:Dropdown({
	Title = "Aura",
	Values = auraLabels,
	Value = selectedAuraLabel,
	Callback = function(value)
		selectedAuraLabel = value
		selectedAuraName = auraLabelToName[value]
	end,
})

shopAurasSection:Button({
	Title = "Buy and Equip",
	Icon = "zap",
	Callback = function()
		if not selectedAuraName then return end
		pcall(function()
			buyAuraRemote:FireServer(selectedAuraName)
			task.wait(0.3)
			equipAuraRemote:FireServer(selectedAuraName)
		end)
		Notify("Auras", "Requested " .. selectedAuraName, 2, "zap")
	end,
})

local autoBuyAurasEnabled = false
local aurasBuyInterval = 5

task.spawn(function()
	while true do
		task.wait(aurasBuyInterval)
		if autoBuyAurasEnabled and selectedAuraName then
			pcall(function()
				buyAuraRemote:FireServer(selectedAuraName)
				equipAuraRemote:FireServer(selectedAuraName)
			end)
		end
	end
end)

shopAurasSection:Toggle({
	Title = "Auto Buy",
	Desc = "Retry the chosen trail until you can afford it",
	Icon = "repeat",
	Flag = "AutoBuyAuraToggle",
	Value = false,
	Callback = function(state)
		autoBuyAurasEnabled = state
	end,
})

local shopCharmsSection = Tabs.Shop:Section({ Title = "Charms & Potions", Opened = true })

local autoEquipBestCharmsEnabled = false
local autoConsumePotionsEnabled = false
local selectedPotionType = "Speed"

task.spawn(function()
	while true do
		task.wait(3)
		if autoEquipBestCharmsEnabled then
			pcall(function()
				equipBestCharmsRemote:FireServer()
			end)
		end
		if autoConsumePotionsEnabled then
			pcall(function()
				usePotionRemote:FireServer(selectedPotionType)
			end)
		end
	end
end)

shopCharmsSection:Button({
	Title = "Equip Best Charms",
	Icon = "shield",
	Callback = function()
		pcall(function()
			equipBestCharmsRemote:FireServer()
			Notify("Shop", "Equipped Best Charms", 2, "check")
		end)
	end,
})

shopCharmsSection:Toggle({
	Title = "Auto Equip Best Charms",
	Icon = "shield-check",
	Flag = "AutoEquipCharmsToggle",
	Value = false,
	Callback = function(state)
		autoEquipBestCharmsEnabled = state
	end,
})

shopCharmsSection:Dropdown({
	Title = "Potion type",
	Values = { "Speed", "Wins" },
	Value = "Speed",
	Callback = function(value)
		selectedPotionType = value
	end,
})

shopCharmsSection:Toggle({
	Title = "Auto Consume Potions",
	Icon = "flask-conical",
	Flag = "AutoConsumePotionsToggle",
	Value = false,
	Callback = function(state)
		autoConsumePotionsEnabled = state
	end,
})

local collectSection = Tabs.Collectibles:Section({ Title = "Auto Collect", Opened = true })

local COLLECTIBLE_TAGS = {
	{ label = "Soul Shards", tag = "SunkenShard" },
}

local function getCollectibleOptions()
	local options = {}
	for _, entry in ipairs(COLLECTIBLE_TAGS) do
		table.insert(options, entry.label)
	end
	return options
end

local function getTagForLabel(label)
	for _, entry in ipairs(COLLECTIBLE_TAGS) do
		if entry.label == label then
			return entry.tag
		end
	end
	return nil
end

local selectedCollectibleLabel = COLLECTIBLE_TAGS[1].label
collectSection:Dropdown({
	Title = "Collectible",
	Values = getCollectibleOptions(),
	Value = selectedCollectibleLabel,
	Callback = function(value)
		selectedCollectibleLabel = value
	end,
})

local autoCollectEnabled = false

local function tweenTo(hrp, targetPosition)
	local distance = (targetPosition - hrp.Position).Magnitude
	local duration = math.max(distance / 50, 0.05)
	local tween = tweenService:Create(hrp, TweenInfo.new(duration, Enum.EasingStyle.Linear), {
		CFrame = CFrame.new(targetPosition, targetPosition + hrp.CFrame.LookVector),
	})
	tween:Play()
	tween.Completed:Wait()
end

local function getNearestCollectible(hrp, tagName)
	local nearest, nearestDistance = nil, math.huge
	for _, instance in ipairs(collectionService:GetTagged(tagName)) do
		local part = instance:IsA("BasePart") and instance or instance:FindFirstChildWhichIsA("BasePart", true)
		if part and part.Parent then
			local distance = (part.Position - hrp.Position).Magnitude
			if distance < nearestDistance then
				nearest, nearestDistance = part, distance
			end
		end
	end
	return nearest
end

local fastCollectEnabled = false

collectSection:Toggle({
	Title = "Fast Teleport Collect",
	Icon = "zap",
	Flag = "FastCollectToggle",
	Value = false,
	Callback = function(state)
		fastCollectEnabled = state
	end,
})

local function runCollectCycle()
	while autoCollectEnabled do
		local hrp = getHrp()
		if not hrp then
			task.wait(0.5)
			continue
		end

		local tagName = getTagForLabel(selectedCollectibleLabel)
		local target = tagName and getNearestCollectible(hrp, tagName)

		if not target then
			task.wait(1)
			continue
		end

		requestStream(target.Position)
		if fastCollectEnabled then
			hrp.CFrame = target.CFrame
			if typeof(firetouchinterest) == "function" and target.CanTouch then
				firetouchinterest(hrp, target, 0)
				task.wait(0.02)
				firetouchinterest(hrp, target, 1)
			end
			task.wait(0.05)
		else
			tweenTo(hrp, target.Position)
			task.wait(0.2)
		end
	end
end

collectSection:Toggle({
	Title = "Auto Collect",
	Icon = "gem",
	Flag = "AutoCollectToggle",
	Value = false,
	Callback = function(state)
		autoCollectEnabled = state
		if state then
			task.spawn(runCollectCycle)
		end
	end,
})

local speedSection = Tabs.Player:Section({ Title = "Speed", Opened = true })

local walkSpeedValue = 16
speedSection:Slider({
	Title = "WalkSpeed",
	Icon = "gauge",
	Value = { Min = 16, Max = 300, Default = 16 },
	Callback = function(value)
		walkSpeedValue = value
		local humanoid = getHumanoid()
		if humanoid then
			humanoid.WalkSpeed = value
		end
	end,
})

local jumpPowerValue = 50
speedSection:Slider({
	Title = "JumpPower",
	Icon = "arrow-up",
	Value = { Min = 50, Max = 300, Default = 50 },
	Callback = function(value)
		jumpPowerValue = value
		local humanoid = getHumanoid()
		if humanoid then
			humanoid.JumpPower = value
		end
	end,
})

localPlayer.CharacterAdded:Connect(function(character)
	local humanoid = character:WaitForChild("Humanoid")
	humanoid.WalkSpeed = walkSpeedValue
	humanoid.JumpPower = jumpPowerValue
end)

local movementSection = Tabs.Player:Section({ Title = "Movement", Opened = true })

local infiniteJumpEnabled = false
movementSection:Toggle({
	Title = "Infinite Jump",
	Icon = "wind",
	Flag = "InfiniteJumpToggle",
	Value = false,
	Callback = function(state)
		infiniteJumpEnabled = state
	end,
})

userInputService.JumpRequest:Connect(function()
	if infiniteJumpEnabled then
		local humanoid = getHumanoid()
		if humanoid then
			humanoid:ChangeState(Enum.HumanoidStateType.Jumping)
		end
	end
end)

local noclipEnabled = false
movementSection:Toggle({
	Title = "Noclip",
	Icon = "shield-off",
	Flag = "NoclipToggle",
	Value = false,
	Callback = function(state)
		noclipEnabled = state
	end,
})

runService.Stepped:Connect(function()
	if not noclipEnabled then return end
	local character = localPlayer.Character
	if not character then return end
	for _, part in ipairs(character:GetDescendants()) do
		if part:IsA("BasePart") and part.CanCollide then
			part.CanCollide = false
		end
	end
end)

local gravityValue = 196.2
movementSection:Slider({
	Title = "Gravity",
	Icon = "orbit",
	Value = { Min = 0, Max = 300, Default = 196 },
	Callback = function(value)
		gravityValue = value
		workspaceService.Gravity = value
	end,
})

local espSection = Tabs.Visuals:Section({ Title = "ESP", Opened = true })

local espStates = {
	Shards = false,
	Treadmills = false,
	SecretDoor = false,
	SecretKey = false,
	Players = false,
	Tracers = false,
}

local activeEspObjects = {}
local activeTracers = {}

local function clearCategoryEsp(categoryName)
	for obj, data in pairs(activeEspObjects) do
		if data.Category == categoryName then
			pcall(function()
				if data.Highlight then data.Highlight:Destroy() end
				if data.Billboard then data.Billboard:Destroy() end
			end)
			activeEspObjects[obj] = nil
		end
	end
end

local function applyEspToObject(targetPart, title, colorHex, categoryName)
	if not (targetPart and targetPart:IsA("BasePart")) then return end
	if activeEspObjects[targetPart] then return end

	local color = Color3.fromHex(colorHex)
	local modelOrPart = targetPart.Parent:IsA("Model") and targetPart.Parent or targetPart

	local highlight = Instance.new("Highlight")
	highlight.Name = "YolkHighlight"
	highlight.FillColor = color
	highlight.OutlineColor = Color3.fromRGB(255, 255, 255)
	highlight.FillTransparency = 0.35
	highlight.OutlineTransparency = 0
	highlight.DepthMode = Enum.HighlightDepthMode.AlwaysOnTop
	highlight.Adornee = modelOrPart
	highlight.Parent = targetPart

	local bbg = Instance.new("BillboardGui")
	bbg.Name = "YolkBillboard"
	bbg.AlwaysOnTop = true
	bbg.Size = UDim2.new(0, 160, 0, 30)
	bbg.StudsOffset = Vector3.new(0, 3.5, 0)
	bbg.Adornee = targetPart

	local label = Instance.new("TextLabel")
	label.Size = UDim2.new(1, 0, 1, 0)
	label.BackgroundTransparency = 1
	label.Text = title
	label.TextColor3 = color
	label.TextStrokeTransparency = 0.1
	label.TextStrokeColor3 = Color3.fromRGB(0, 0, 0)
	label.Font = Enum.Font.SourceSansBold
	label.TextSize = 14
	label.Parent = bbg
	bbg.Parent = targetPart

	activeEspObjects[targetPart] = {
		Highlight = highlight,
		Billboard = bbg,
		Category = categoryName,
	}
end

local function clearTracers()
	for _, beam in ipairs(activeTracers) do
		pcall(function()
			if beam.Attachment0 then beam.Attachment0:Destroy() end
			if beam.Attachment1 then beam.Attachment1:Destroy() end
			beam:Destroy()
		end)
	end
	table.clear(activeTracers)
end

local function createBeamTracer(hrp, targetPart, colorHex)
	if not (hrp and targetPart and targetPart:IsA("BasePart")) then return end
	local att0 = Instance.new("Attachment")
	att0.Parent = hrp
	local att1 = Instance.new("Attachment")
	att1.Parent = targetPart

	local beam = Instance.new("Beam")
	beam.Attachment0 = att0
	beam.Attachment1 = att1
	beam.Color = ColorSequence.new(Color3.fromHex(colorHex))
	beam.Width0 = 0.2
	beam.Width1 = 0.2
	beam.FaceCamera = true
	beam.Parent = att0

	table.insert(activeTracers, beam)
end

local function refreshEspLoop()
	local hrp = getHrp()

	if espStates.Shards then
		for _, instance in ipairs(collectionService:GetTagged("SunkenShard")) do
			local part = instance:IsA("BasePart") and instance or instance:FindFirstChildWhichIsA("BasePart", true)
			if part then applyEspToObject(part, "Sunken Shard", "#D9A066", "Shards") end
		end
	end

	if espStates.Treadmills then
		for _, instance in ipairs(collectionService:GetTagged("Treadmill")) do
			local part = instance:IsA("BasePart") and instance or instance:FindFirstChildWhichIsA("BasePart", true)
			if part then applyEspToObject(part, "Treadmill", "#00FF88", "Treadmills") end
		end
		for _, instance in ipairs(collectionService:GetTagged("QuantumTreadmill")) do
			local part = instance:IsA("BasePart") and instance or instance:FindFirstChildWhichIsA("BasePart", true)
			if part then applyEspToObject(part, "Quantum Treadmill", "#A020F0", "Treadmills") end
		end
	end

	if espStates.SecretDoor then
		local door = workspaceService:FindFirstChild("Map") and workspaceService.Map:FindFirstChild("SecretDoor")
		if door then
			local part = door:IsA("BasePart") and door or door:FindFirstChildWhichIsA("BasePart", true)
			if part then applyEspToObject(part, "Secret Door", "#FFA500", "SecretDoor") end
		end
	end

	if espStates.SecretKey then
		for _, desc in ipairs(workspaceService:GetDescendants()) do
			if desc:IsA("Model") and desc.Name == "Key" and desc.Parent ~= replicatedStorage then
				local part = desc:FindFirstChild("Hitbox") or desc:FindFirstChildWhichIsA("BasePart", true)
				if part then applyEspToObject(part, "Secret Key", "#FFD700", "SecretKey") end
			end
		end
	end

	if espStates.Players then
		for _, plr in ipairs(playersService:GetPlayers()) do
			if plr ~= localPlayer and plr.Character then
				local hrpPlr = plr.Character:FindFirstChild("HumanoidRootPart")
				if hrpPlr then applyEspToObject(hrpPlr, plr.DisplayName or plr.Name, "#FF4444", "Players") end
			end
		end
	end

	clearTracers()
	if espStates.Tracers and hrp then
		for _, desc in ipairs(workspaceService:GetDescendants()) do
			if desc:IsA("Model") and desc.Name == "Key" and desc.Parent ~= replicatedStorage then
				local part = desc:FindFirstChild("Hitbox") or desc:FindFirstChildWhichIsA("BasePart", true)
				if part then createBeamTracer(hrp, part, "#FFD700") end
			end
		end
		local door = workspaceService:FindFirstChild("Map") and workspaceService.Map:FindFirstChild("SecretDoor")
		if door then
			local part = door:IsA("BasePart") and door or door:FindFirstChildWhichIsA("BasePart", true)
			if part then createBeamTracer(hrp, part, "#FFA500") end
		end
	end
end

task.spawn(function()
	while true do
		task.wait(1)
		pcall(refreshEspLoop)
	end
end)

espSection:Toggle({
	Title = "Soul Shards ESP",
	Icon = "sparkles",
	Flag = "SoulShardEspToggle",
	Value = false,
	Callback = function(state)
		espStates.Shards = state
		if not state then clearCategoryEsp("Shards") end
		pcall(refreshEspLoop)
	end,
})

espSection:Toggle({
	Title = "Treadmills ESP",
	Icon = "activity",
	Flag = "TreadmillsEspToggle",
	Value = false,
	Callback = function(state)
		espStates.Treadmills = state
		if not state then clearCategoryEsp("Treadmills") end
		pcall(refreshEspLoop)
	end,
})

espSection:Toggle({
	Title = "Secret Door ESP",
	Icon = "door-open",
	Flag = "SecretDoorEspToggle",
	Value = false,
	Callback = function(state)
		espStates.SecretDoor = state
		if not state then clearCategoryEsp("SecretDoor") end
		pcall(refreshEspLoop)
	end,
})

espSection:Toggle({
	Title = "Secret Key ESP",
	Icon = "key-round",
	Flag = "SecretKeyEspToggle",
	Value = false,
	Callback = function(state)
		espStates.SecretKey = state
		if not state then clearCategoryEsp("SecretKey") end
		pcall(refreshEspLoop)
	end,
})

espSection:Toggle({
	Title = "Player ESP",
	Icon = "users",
	Flag = "PlayerEspToggle",
	Value = false,
	Callback = function(state)
		espStates.Players = state
		if not state then clearCategoryEsp("Players") end
		pcall(refreshEspLoop)
	end,
})

local tracersSection = Tabs.Visuals:Section({ Title = "ESP Tracers", Opened = true })

tracersSection:Toggle({
	Title = "Key & Door Tracers",
	Icon = "navigation",
	Flag = "TracersToggle",
	Value = false,
	Callback = function(state)
		espStates.Tracers = state
		if not state then clearTracers() end
		pcall(refreshEspLoop)
	end,
})

local performanceSection = Tabs.Visuals:Section({ Title = "Performance", Opened = true })

local fpsBoosterEnabled = false
performanceSection:Toggle({
	Title = "Low Graphics",
	Icon = "zap",
	Flag = "FpsBoosterToggle",
	Value = false,
	Callback = function(state)
		fpsBoosterEnabled = state
		lightingService.GlobalShadows = not state
		if state then
			lightingService.FogEnd = 9e9
			for _, v in ipairs(workspaceService:GetDescendants()) do
				if v:IsA("BasePart") then
					v.Material = Enum.Material.SmoothPlastic
				elseif v:IsA("Decal") or v:IsA("Texture") then
					v.Transparency = 1
				elseif v:IsA("ParticleEmitter") or v:IsA("Trail") then
					v.Enabled = false
				end
			end
			Notify("Performance", "Low Graphics", 2, "check")
		else
			Notify("Performance", "Low Graphics", 2, "info")
		end
	end,
})

local environmentSection = Tabs.Visuals:Section({ Title = "Environment", Opened = true })

local fullbrightEnabled = false
local savedBrightness, savedClockTime, savedFogEnd = lightingService.Brightness, lightingService.ClockTime, lightingService.FogEnd

environmentSection:Toggle({
	Title = "Fullbright",
	Icon = "sun",
	Flag = "FullbrightToggle",
	Value = false,
	Callback = function(state)
		fullbrightEnabled = state
		if state then
			savedBrightness, savedClockTime, savedFogEnd = lightingService.Brightness, lightingService.ClockTime, lightingService.FogEnd
			lightingService.Brightness = 2
			lightingService.ClockTime = 14
			lightingService.FogEnd = 100000
		else
			lightingService.Brightness = savedBrightness
			lightingService.ClockTime = savedClockTime
			lightingService.FogEnd = savedFogEnd
		end
	end,
})

local generalSection = Tabs.Settings:Section({ Title = "General", Opened = true })

local antiAfkEnabled = true
generalSection:Toggle({
	Title = "Anti AFK",
	Icon = "shield",
	Flag = "AntiAfkToggle",
	Value = true,
	Callback = function(state)
		antiAfkEnabled = state
		Notify("Anti AFK", state and "Enabled" or "Disabled", 2, "shield")
	end,
})

localPlayer.Idled:Connect(function()
	if antiAfkEnabled then
		virtualUserService:CaptureController()
		virtualUserService:ClickButton2(Vector2.new())
	end
end)

task.spawn(function()
	while true do
		task.wait(60)
		if antiAfkEnabled then
			pcall(function()
				virtualUserService:CaptureController()
				virtualUserService:ClickButton2(Vector2.new())
			end)
		end
	end
end)

local serverSection = Tabs.Settings:Section({ Title = "Server Options", Opened = true })

serverSection:Button({
	Title = "Rejoin Server",
	Icon = "rotate-ccw",
	Callback = function()
		Notify("Server", "Rejoining server...", 3, "refresh-cw")
		teleportService:TeleportToPlaceInstance(game.PlaceId, game.JobId, localPlayer)
	end,
})

serverSection:Button({
	Title = "Server Hop",
	Icon = "server",
	Callback = function()
		Notify("Server", "Finding new server...", 3, "search")
		pcall(function()
			local req = (syn and syn.request) or (http and http.request) or http_request or (fluxus and fluxus.request) or request
			if req then
				local serversUrl = "https://games.roblox.com/v1/games/" .. tostring(game.PlaceId) .. "/servers/Public?sortOrder=Asc&limit=100"
				local res = req({ Url = serversUrl, Method = "GET" })
				if res and res.Body then
					local data = httpService:JSONDecode(res.Body)
					if data and data.data then
						for _, server in ipairs(data.data) do
							if server.id ~= game.JobId and server.playing < server.maxPlayers then
								teleportService:TeleportToPlaceInstance(game.PlaceId, server.id, localPlayer)
								return
							end
						end
					end
				end
			end
			teleportService:Teleport(game.PlaceId, localPlayer)
		end)
	end,
})

local configSection = Tabs.Settings:Section({ Title = "Configuration", Opened = true })
local configManager = Window.ConfigManager
local configName = "default"

local configNameInput = configSection:Input({
	Title = "Configuration name",
	Icon = "file-cog",
	Value = configName,
	Callback = function(value)
		configName = value
	end,
})

local allConfigs = configManager:AllConfigs()
local configDropdown = configSection:Dropdown({
	Title = "Saved configurations",
	Values = allConfigs,
	Value = table.find(allConfigs, configName) and configName or nil,
	Callback = function(value)
		configName = value
		configNameInput:Set(value)
	end,
})

configSection:Button({
	Title = "Save configuration",
	Icon = "save",
	Callback = function()
		Window.CurrentConfig = configManager:Config(configName)
		if Window.CurrentConfig:Save() then
			Notify("Configuration", "Saved as '" .. configName .. "'", 3, "check")
		end
		configDropdown:Refresh(configManager:AllConfigs())
	end,
})

configSection:Button({
	Title = "Load configuration",
	Icon = "refresh-cw",
	Callback = function()
		Window.CurrentConfig = configManager:CreateConfig(configName)
		if Window.CurrentConfig:Load() then
			Notify("Configuration", "'" .. configName .. "' loaded", 3, "check")
		end
	end,
})
