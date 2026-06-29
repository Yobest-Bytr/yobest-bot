

-- UnitFollowHandler (Client) - UNITS BEHIND PLAYER
local UnitManager = {}

-- Services
local Players           = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService        = game:GetService("RunService")
local LocalPlayer       = Players.LocalPlayer

-- Modules
local UnitsData         = require(ReplicatedStorage.Modules.Data.LoadUnitsData)
local UnitAnimator      = require(ReplicatedStorage.Modules.Shared.UnitAnimator)
local AnimationCallbacks = require(ReplicatedStorage.Modules.Data.AnimationCallbacks)
local UnitCollisionHandler = require(ReplicatedStorage.Modules.UnitCollisionHandler)
local TraitEffects      = require(script.Parent.Parent.Interfaces.Visuals.TraitEffects)
local EmotesData        = require(ReplicatedStorage.Modules.Data.EmotesData)

-- Networking
local Following         = ReplicatedStorage.RemoteEvents.Units.Following
local RequestFollowed   = Following.RequestFollowed
local UnitUnequipped    = Following.UnitUnequipped
local UnitEquipped      = Following.UnitEquipped
local UnequipAllUnits   = Following.UnequipAllUnits
local UpdateTrait       = Following.UpdateTrait
local PlayUnitEmote     = Following.PlayUnitEmote

-- Storage
local playerUnits           = {}  -- [Player] -> { [slot] = unitData }
local lastCharacterByPlayer = {}  -- [Player] -> Character, used to detect respawns/teleports
local PetFolder = workspace:FindFirstChild("PetFolder") or Instance.new("Folder")
PetFolder.Name = "PetFolder"
PetFolder.Parent = workspace

-- MAX 6 UNITS
local MAX_UNITS = 6

-- Raycast for ground
local raycastParams = RaycastParams.new()
raycastParams.FilterType = Enum.RaycastFilterType.Include
raycastParams.FilterDescendantsInstances = {workspace:WaitForChild("Lobby")}

-- Safe GUI call
local function coreCall(method, ...)
	local ok, res
	for _ = 1, 8 do
		ok, res = pcall(game:GetService("StarterGui")[method], game:GetService("StarterGui"), ...)
		if ok then break end
		RunService.Stepped:Wait()
	end
	return ok, res
end
coreCall("SetCore", "ResetButtonCallback", false)

-- Animation: Store Animation instances
function UnitManager:LoadUnitAnimations(model, data)
	local info = UnitsData:GetUnitDataByName(data.DisplayName) or UnitsData:GetUnitDataByDisplayName(data.DisplayName)
	if not info then return end

	local hum = model:FindFirstChild("Humanoid")
	if not hum then return end

	local idleAnimInst = ReplicatedStorage.Assets.Animations.Idles:FindFirstChild(info.Rarity):FindFirstChild(info.Name)
		or ReplicatedStorage.Assets.Animations.Player.Idle
	local runAnimInst = ReplicatedStorage.Assets.Animations.Misc.Movement:FindFirstChild(info.Name)
		or ReplicatedStorage.Assets.Animations.Player.Run

	data.Animations = {
		IdleAnim = idleAnimInst,
		RunAnim = runAnimInst,
	}
	data.RunTrack = nil
	data.IdleTrack = nil

	if AnimationCallbacks[info.Name] then
		AnimationCallbacks[info.Name](model)
	end
end

-- Play Run
function UnitManager:PlayRun(model, data)
	if not data.Animations or not data.Animations.RunAnim then return end
	local hum = model:FindFirstChild("Humanoid")
	if not hum then return end

	if data.IdleTrack and data.IdleTrack.IsPlaying then
		data.IdleTrack:Stop(0.2)
	end
	if not data.RunTrack or not data.RunTrack.IsPlaying then
		data.RunTrack = hum:LoadAnimation(data.Animations.RunAnim)
		data.RunTrack:Play()
	end
end

-- Play Idle
function UnitManager:PlayIdle(model, data)
	if not data.Animations or not data.Animations.IdleAnim then return end
	local hum = model:FindFirstChild("Humanoid")
	if not hum then return end

	if data.RunTrack and data.RunTrack.IsPlaying then
		data.RunTrack:Stop(0.2)
	end
	if not data.IdleTrack or not data.IdleTrack.IsPlaying then
		data.IdleTrack = hum:LoadAnimation(data.Animations.IdleAnim)
		data.IdleTrack:Play()
	end
end

-- XZ Lock
function UnitManager:LockCFrameOrientationXZ(cf)
	return CFrame.fromMatrix(cf.Position, cf.RightVector, Vector3.new(0,1,0), -cf.LookVector)
end

-- Hide others
function UnitManager:HideOthersUnits(hide)
	self.OthersUnitsHidden = hide
	for pl, list in playerUnits do
		if pl ~= LocalPlayer then
			for _, d in list do
				if d.UnitModel then
					d.UnitModel.Parent = hide and nil or PetFolder
				end
			end
		end
	end
end

-- Trait
function UnitManager:UpdateUnitTrait(model, trait)
	if not trait or trait == "None" then return end
	local pp = model.PrimaryPart
	if not pp then return end
	if pp:FindFirstChild("TraitTag") then pp.TraitTag:Destroy() end

	local tag = ReplicatedStorage.Assets.Misc.Units.TraitTag:Clone()
	tag.Parent = pp
	local icon 
	if typeof(trait) == "table" then
		icon = ReplicatedStorage.Assets.TraitIcons:FindFirstChild(trait.Name)
	else
		icon = ReplicatedStorage.Assets.TraitIcons:FindFirstChild(trait)
	end
	if icon then
		icon = icon:Clone()
		icon.Position = UDim2.fromScale(0.5, 0.5)
		icon.Size = UDim2.fromScale(1, 1)
		icon.Parent = tag
	end
end

-- Create unit
function UnitManager:AddUnit(player, data)
	local info = UnitsData:GetUnitDataByName(data.DisplayName) or UnitsData:GetUnitDataByDisplayName(data.DisplayName)
	if not info then warn("No unit data:", data.DisplayName) return end

	local char = player.Character or player.CharacterAdded:Wait()
	local hrp = char:WaitForChild("HumanoidRootPart", 15)
	if not hrp then return end

	local model = info.Model:Clone()
	model:ScaleTo(model:GetScale() * 1.35)
	model:PivotTo(hrp.CFrame)
	model.Name = data.Identifier
	UnitCollisionHandler:DisableHumanoidStates(model)
	UnitCollisionHandler:SetUnitCollisions(model)

	-- Tag
	local grad = ReplicatedStorage.Assets.RarityGradients:FindFirstChild(info.Rarity)
		or ReplicatedStorage.Assets.RarityGradients.Vanguards:FindFirstChild(info.Name)
	local tag = ReplicatedStorage.Assets.Misc.Units.UnitTag:Clone()
	tag.Main.NameTag.Text = data.SkinName and `{info.Name:match("^(.-)%s%(")} ({data.SkinName:split("_")[2]})` or info.Name
	tag.Main.RarityFrame.BackgroundColor3 = grad and grad:Clone().Color.Keypoints[1].Value or Color3.new(1,1,1)
	tag.Parent = model:FindFirstChild("Torso") or model.PrimaryPart

	-- Shiny
	if data.Shiny then
		local g = info.Rarity == "Secret" and grad:Clone() or Instance.new("UIGradient")
		g.Parent = tag.Main.NameTag
		if info.Rarity ~= "Secret" then g:AddTag("RainbowGradient") end
	end

	TraitEffects:PlayTraitEffect(data.Traits, model)
	self:UpdateUnitTrait(model, data.Traits)

	model.Parent = (self.OthersUnitsHidden and player ~= LocalPlayer) and nil or PetFolder
	return model
end

-- EQUIP: MAX 6 + 3x2 GRID BEHIND PLAYER
function UnitManager:PlayerUnitEquipped(player, unitsTable, identifier, unitInfo)
	local currentCount = 0
	for _ in unitsTable do currentCount += 1 end
	if currentCount >= MAX_UNITS then
		warn(`[UnitFollowHandler] MAX ${MAX_UNITS} units reached`)
		return
	end

	local data = {
		Identifier  = identifier,
		DisplayName = unitInfo.DisplayName,
		Traits       = unitInfo.Traits,
		Shiny       = unitInfo.Shiny,
		SkinName    = unitInfo.SkinName,
		Familiar    = unitInfo.Familiar,
		PlayingEmotes = {},
		Slot        = unitInfo.Slot,
		CurrentPos  = nil,
		OffsetCFrame = nil,
		RunTrack = nil,
		IdleTrack = nil,
	}

	local model = self:AddUnit(player, data)
	if not model then return end
	data.UnitModel = model

	-- 3x2 GRID: 5 studs apart, 6 studs BEHIND
	local index = currentCount + 1
	local row = math.floor((index - 1) / 3)  -- 0 or 1
	local col = (index - 1) % 3              -- 0, 1, 2

	local offsetX = (col - 1) * 5            -- -5, 0, +5
	local offsetZ = 6 + (row * 5)            -- +6, +11 (BEHIND)

	data.OffsetCFrame = CFrame.new(offsetX, 0, offsetZ)
	data.CurrentPos = model.PrimaryPart.Position

	unitsTable[unitInfo.Slot] = data
	self:LoadUnitAnimations(model, data)
end

-- Init
function UnitManager:Init()
	if not game:IsLoaded() then game.Loaded:Wait() end
	
	PetFolder:ClearAllChildren()

	RequestFollowed:FireServer()
	local data = RequestFollowed.OnClientEvent:Wait()

	for _, pd in data do
		if pd.Player then
			local list = {}
			playerUnits[pd.Player] = list

			local loaded = 0
			for slot, info in pd.Units do
				if loaded < MAX_UNITS then
					self:PlayerUnitEquipped(pd.Player, list, slot, info)
					loaded += 1
				end
			end
		end
	end

	-- Highlight
	local hl = Instance.new("Highlight")
	hl.FillTransparency = 1
	hl.OutlineTransparency = 0.5
	hl.OutlineColor = Color3.new(0,0,0)
	hl.DepthMode = Enum.HighlightDepthMode.Occluded
	hl.Parent = PetFolder

	-- Events
	Players.PlayerRemoving:Connect(function(p) self:HandlePlayerRemoving(p) end)

	UnitUnequipped.OnClientEvent:Connect(function(p, id)
		local list = playerUnits[p]
		if list then
			for s, d in list do
				if tostring(d.Identifier) == tostring(id) then
					if d.UnitModel then d.UnitModel:Destroy() end
					list[s] = nil
				end
			end
		end
	end)

	UnitEquipped.OnClientEvent:Connect(function(p, id, info)
		local list = playerUnits[p] or {}
		playerUnits[p] = list

		local count = 0
		for _ in list do count += 1 end
		if count >= MAX_UNITS then
			warn(`[UnitFollowHandler] Cannot equip - max ${MAX_UNITS} units`)
			return
		end

		self:PlayerUnitEquipped(p, list, id, info)
	end)

	UnequipAllUnits.OnClientEvent:Connect(function(p)
		local list = playerUnits[p]
		if list then
			for _, d in list do if d.UnitModel then d.UnitModel:Destroy() end end
			playerUnits[p] = {}
		end
	end)

	UpdateTrait.OnClientEvent:Connect(function(p, id, trait)
		local list = playerUnits[p]
		if list then
			for s, d in list do
				if tostring(d.Identifier) == tostring(id) then
					if d.UnitModel then d.UnitModel:Destroy() end
					list[s] = nil
					d.Traits = trait
					d.Slot = s
					self:PlayerUnitEquipped(p, list, id, d)
--[[				else
					if d.UnitModel then d.UnitModel:Destroy() end
					list[s] = nil
					d.Slot = s
					self:PlayerUnitEquipped(p, list, d.Identifier, d)]]
				end
			end
		end
	end)

	PlayUnitEmote.OnClientEvent:Connect(function(p, act, name)
		if act == "Play" then self:PlayUnitEmotes(p, name)
		elseif act == "Stop" then self:StopUnitEmotes(p) end
	end)

	-- MAIN LOOP: Always Update
	--
	-- Key improvements over the original:
	--   1. Frame-rate-independent smoothing via exponential decay (dt-scaled alpha),
	--      so follow speed is identical at 30 Hz and 144 Hz.
	--   2. Respawn / teleport detection: when the player's Character changes, units
	--      are instantly warped to their target instead of smearing across the map.
	--   3. Look direction uses a Y-flattened target so units don't tilt their faces
	--      up/down when the player is on a different elevation.
	--   4. Animation state is driven by the unit's own movement speed, not the
	--      player's input direction, so lagging units run and idle units idle.
	--
	local BASE_ALPHA    = 0.15   -- follow speed at 60 Hz (tune here)
	local ROT_BASE      = 0.20   -- rotation smoothing at 60 Hz
	local SNAP_DISTANCE = 20     -- studs: teleport instead of lerp beyond this

	RunService.Heartbeat:Connect(function(dt)
		-- dt-scaled exponential-decay alphas — frame-rate independent
		local posAlpha = 1 - (1 - BASE_ALPHA) ^ (dt * 60)
		local rotAlpha = 1 - (1 - ROT_BASE)   ^ (dt * 60)

		for pl, list in playerUnits do
			local char = pl.Character
			if not char then continue end
			local hrp = char:FindFirstChild("HumanoidRootPart")
			if not hrp then continue end

			-- Detect respawn / teleport: character object changed this frame
			local justRespawned = lastCharacterByPlayer[pl] ~= char
			lastCharacterByPlayer[pl] = char

			for _, data in list do
				local model = data.UnitModel
				if not model or not model.PrimaryPart then continue end

				-- Target position = player HRP CFrame * behind-offset
				local targetCF  = hrp.CFrame * data.OffsetCFrame
				local targetPos = targetCF.Position

				-- On respawn, teleport units instantly; otherwise smooth-lerp
				local currentPos = data.CurrentPos or targetPos
				local distSq     = (currentPos - targetPos).Magnitude

				local newPos
				if justRespawned or distSq > SNAP_DISTANCE then
					-- Hard snap: avoids smearing on respawn or extreme lag
					newPos = targetPos
				else
					newPos = currentPos:Lerp(targetPos, posAlpha)
				end

				-- Ground snap (raycast downward from slightly above)
				local ray = workspace:Raycast(
					newPos + Vector3.new(0, 5, 0),
					Vector3.new(0, -12, 0),
					raycastParams
				)
				if ray then
					newPos = Vector3.new(newPos.X, ray.Position.Y + 1.5, newPos.Z)
				end

				-- Look toward player, but flatten to the unit's own Y so the
				-- unit never tilts its head up/down to track elevation changes
				local lookTarget = Vector3.new(hrp.Position.X, newPos.Y, hrp.Position.Z)
				local xzDist = (Vector3.new(newPos.X, 0, newPos.Z)
				              - Vector3.new(lookTarget.X, 0, lookTarget.Z)).Magnitude
				local targetLookCF = xzDist > 0.01
					and CFrame.lookAt(newPos, lookTarget)
					or  (data.CurrentCF or CFrame.new(newPos))

				-- Smooth rotation: slerp from previous orientation toward target
				local previousCF = data.CurrentCF or targetLookCF
				local blendedCF  = justRespawned
					and targetLookCF
					or  previousCF:Lerp(targetLookCF, rotAlpha)

				-- Recombine: use blended rotation with the freshly-computed newPos
				local rotOnly = blendedCF - blendedCF.Position
				local finalCF = CFrame.new(newPos) * rotOnly

				model:PivotTo(finalCF)
				data.CurrentPos = newPos
				data.CurrentCF  = finalCF

				-- Drive animation from the unit's own movement speed, not the
				-- player's input — a catching-up unit should run; a standing unit idle
				local unitSpeed = (newPos - currentPos).Magnitude / dt
				if unitSpeed > 0.5 then
					self:PlayRun(model, data)
				else
					self:PlayIdle(model, data)
				end
			end
		end
	end)
end

-- Cleanup
function UnitManager:HandlePlayerRemoving(p)
	local list = playerUnits[p]
	if list then
		for _, d in list do if d.UnitModel then d.UnitModel:Destroy() end end
		playerUnits[p] = nil
	end
	lastCharacterByPlayer[p] = nil
end

function UnitManager:StopUnitEmotes(p)
	local list = playerUnits[p]
	if not list then return end
	for _, d in list do
		for _, a in d.PlayingEmotes do a:Stop() end
		table.clear(d.PlayingEmotes)
	end
end

function UnitManager:PlayUnitEmotes(p, name)
	local ed = EmotesData.GetDataFromEmoteName(name)
	if not ed then return end
	local list = playerUnits[p]
	if not list then return end

	for _, d in list do
		local ctrl = d.UnitModel:FindFirstChildOfClass("AnimationController") or d.UnitModel:FindFirstChildOfClass("Humanoid")
		local anim = ctrl and ctrl:FindFirstChildOfClass("Animator")
		if anim then
			for _, a in d.PlayingEmotes do a:Stop() end
			table.clear(d.PlayingEmotes)
			local track = anim:LoadAnimation(ed.Animation)
			track:Play(0)
			table.insert(d.PlayingEmotes, track)
		end
	end
end

return UnitManager