local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerScriptService = game:GetService("ServerScriptService")
local Players = game:GetService("Players")
local ProfileService = require(ReplicatedStorage.Modules:WaitForChild("ProfileService"))
local QuestRewardsDataHandler = require(ReplicatedStorage.Modules.Data:WaitForChild("QuestRewardsDataHandler"))

-- RemoteEvents
local RemoteEvents = ReplicatedStorage:WaitForChild("RemoteEvents")
local QuestsRemote = RemoteEvents:WaitForChild("Quests")
local RequestQuests = QuestsRemote:WaitForChild("RequestQuests")
local ClaimQuest = QuestsRemote:WaitForChild("ClaimQuest")
local QuestStatus = QuestsRemote:WaitForChild("QuestStatus")
local UpdateQuest = QuestsRemote:WaitForChild("UpdateQuest")
local QuestTimerEvent = RemoteEvents:WaitForChild("QuestTimerEvent")
local NotificationEvent = RemoteEvents:WaitForChild("NotificationEvent")

-- Profile template for quests
local QuestProfileTemplate = {
	QuestProgress = {
		Daily = {},
		Weekly = {}
	},
	QuestCompletion = {
		Daily = {},
		Weekly = {}
	},
	LastDailyReset = 0,
	LastWeeklyReset = 0,
	DailyCounters = {
		Kills = 0,
		TotalSummons = 0,
		Wins = 0
	},
	WeeklyCounters = {
		Kills = 0,
		TotalSummons = 0,
		Wins = 0
	}
}

local ProfileStore = ProfileService.GetProfileStore("QuestData_v1", QuestProfileTemplate)
local loadedQuestProfiles = {}

local QuestsData = {}

-- Define quest types
QuestsData.QuestTypes = {
	Daily = "Daily",
	Weekly = "Weekly"
}

-- Sample quest data
QuestsData.Quests = {
	Daily = {
		["Defeat 1000 Enemies"] = {
			Type = QuestsData.QuestTypes.Daily,
			Goal = {Description = "Defeat %d Enemies", AmountNeeded = 1000},
			Rewards = QuestRewardsDataHandler.GetRewards("Defeat 1000 Enemies")
		},
		["Open 10 Crates"] = {
			Type = QuestsData.QuestTypes.Daily,
			Goal = {Description = "Open %d Crates", AmountNeeded = 10},
			Rewards = QuestRewardsDataHandler.GetRewards("Open 10 Crates")
		},
		["Win 5 Matches"] = {
			Type = QuestsData.QuestTypes.Daily,
			Goal = {Description = "Win %d Matches", AmountNeeded = 5},
			Rewards = QuestRewardsDataHandler.GetRewards("Win 5 Matches")
		}
	},
	Weekly = {
		["Defeat 10000 Enemies"] = {
			Type = QuestsData.QuestTypes.Weekly,
			Goal = {Description = "Defeat %d Enemies", AmountNeeded = 10000},
			Rewards = QuestRewardsDataHandler.GetRewards("Defeat 10000 Enemies")
		},
		["Open 50 Crates"] = {
			Type = QuestsData.QuestTypes.Weekly,
			Goal = {Description = "Open %d Crates", AmountNeeded = 50},
			Rewards = QuestRewardsDataHandler.GetRewards("Open 50 Crates")
		},
		["Win 20 Matches"] = {
			Type = QuestsData.QuestTypes.Weekly,
			Goal = {Description = "Win %d Matches", AmountNeeded = 20},
			Rewards = QuestRewardsDataHandler.GetRewards("Win 20 Matches")
		}
	}
}

-- Function to handle session conflicts.
-- ProfileStore:GetMetaTag() does not exist — MetaTags live on a loaded Profile,
-- not on the ProfileStore itself, so the original call always errored.
-- We ForceLoad to claim the session; ProfileService will safely migrate the data.
local function notReleasedHandler(placeId, gameJobId)
	return "ForceLoad"
end

-- Function to get player's quest profile
local function getPlayerQuestProfile(player)
	return loadedQuestProfiles[player.UserId]
end

-- Function to get player's quest progress
local function getPlayerQuestProgress(player)
	local profile = getPlayerQuestProfile(player)
	if not profile then return nil end
	return profile.Data.QuestProgress
end

-- Function to update quest progress
local function updateQuestProgress(player, questName, progress)
	local profile = getPlayerQuestProfile(player)
	if not profile or not profile:IsActive() then return end
	local questType = QuestsData.Quests.Daily[questName] and "Daily" or "Weekly"
	if not profile.Data.QuestProgress[questType][questName] then
		profile.Data.QuestProgress[questType][questName] = {Amount = 0}
	end
	profile.Data.QuestProgress[questType][questName].Amount = progress
	UpdateQuest:FireClient(player, questName, profile.Data.QuestProgress[questType][questName])
end

-- Function to mark quest as completed
local function markQuestCompleted(player, questName)
	local profile = getPlayerQuestProfile(player)
	if not profile or not profile:IsActive() then return end
	local questType = QuestsData.Quests.Daily[questName] and "Daily" or "Weekly"
	profile.Data.QuestCompletion[questType][questName] = {Claimed = false}
	QuestStatus:FireClient(player, questName, {Completed = true, Claimed = false})
	NotificationEvent:FireClient(player, {Name = "Success", Text = "Quest Completed: " .. questName})
end

-- Function to mark quest as claimed
local function markQuestClaimed(player, questName)
	local profile = getPlayerQuestProfile(player)
	if not profile or not profile:IsActive() then return end
	local questType = QuestsData.Quests.Daily[questName] and "Daily" or "Weekly"
	if profile.Data.QuestCompletion[questType][questName] then
		profile.Data.QuestCompletion[questType][questName].Claimed = true
		QuestStatus:FireClient(player, questName, {Completed = true, Claimed = true})
		NotificationEvent:FireClient(player, {Name = "Info", Text = "Quest Claimed: " .. questName})
	end
end

-- Function to check if quest is completed
local function isQuestCompleted(player, questName)
	local profile = getPlayerQuestProfile(player)
	if not profile then return false end
	local quest = QuestsData.Quests.Daily[questName] or QuestsData.Quests.Weekly[questName]
	if not quest then return false end
	local currentProgress = profile.Data.QuestProgress[quest.Type][questName]
	if not currentProgress then return false end
	return currentProgress.Amount >= quest.Goal.AmountNeeded
end

-- Handle quest requests
RequestQuests.OnServerEvent:Connect(function(player)
	local profile = getPlayerQuestProfile(player)
	if not profile or not profile:IsActive() then return end
	local questsData = {
		Daily = QuestsData.Quests.Daily,
		Weekly = QuestsData.Quests.Weekly
	}
	RequestQuests:FireClient(player, questsData, profile.Data.QuestProgress, profile.Data.QuestCompletion)
end)

-- Handle quest claims
ClaimQuest.OnServerEvent:Connect(function(player, questName)
	local profile = getPlayerQuestProfile(player)
	if not profile or not profile:IsActive() then return end
	if questName == "ClaimAll" then
		for qName, quest in pairs(QuestsData.Quests.Daily) do
			if isQuestCompleted(player, qName) and not profile.Data.QuestCompletion.Daily[qName].Claimed then
				local rewards = QuestRewardsDataHandler.GetRewards(qName)
				for rewardType, rewardItems in pairs(rewards) do
					for rewardName, rewardDetails in pairs(rewardItems) do
						if rewardType == "Currencies" and rewardName == "Credits" then
							player.GameStats.Gold.Value += rewardDetails.Amount
							ReplicatedStorage.RemoteEvents.RewardFlyout:FireClient(player, rewardDetails.Amount)
						end
					end
				end
				markQuestClaimed(player, qName)
			end
		end
		for qName, quest in pairs(QuestsData.Quests.Weekly) do
			if isQuestCompleted(player, qName) and not profile.Data.QuestCompletion.Weekly[qName].Claimed then
				local rewards = QuestRewardsDataHandler.GetRewards(qName)
				for rewardType, rewardItems in pairs(rewards) do
					for rewardName, rewardDetails in pairs(rewardItems) do
						if rewardType == "Currencies" and rewardName == "Credits" then
							player.GameStats.Gold.Value += rewardDetails.Amount
							ReplicatedStorage.RemoteEvents.RewardFlyout:FireClient(player, rewardDetails.Amount)
						end
					end
				end
				markQuestClaimed(player, qName)
			end
		end
	else
		if isQuestCompleted(player, questName) then
			local questType = QuestsData.Quests.Daily[questName] and "Daily" or "Weekly"
			if not profile.Data.QuestCompletion[questType][questName].Claimed then
				local rewards = QuestRewardsDataHandler.GetRewards(questName)
				for rewardType, rewardItems in pairs(rewards) do
					for rewardName, rewardDetails in pairs(rewardItems) do
						if rewardType == "Currencies" and rewardName == "Credits" then
							player.GameStats.Gold.Value += rewardDetails.Amount
							ReplicatedStorage.RemoteEvents.RewardFlyout:FireClient(player, rewardDetails.Amount)
						end
					end
				end
				markQuestClaimed(player, questName)
			else
				NotificationEvent:FireClient(player, {Name = "Failure", Text = "Quest already claimed: " .. questName})
			end
		else
			NotificationEvent:FireClient(player, {Name = "Failure", Text = "Quest not completed: " .. questName})
		end
	end
end)

-- Timer logic
local function checkAndResetQuests(player, questType)
	local profile = getPlayerQuestProfile(player)
	if not profile or not profile:IsActive() then return end
	local lastReset = questType == "Daily" and profile.Data.LastDailyReset or profile.Data.LastWeeklyReset
	local resetInterval = questType == "Daily" and 86400 or 604800 -- 24 hours or 7 days
	local timeSinceLastReset = os.time() - lastReset
	if timeSinceLastReset >= resetInterval then
		profile.Data.QuestProgress[questType] = {}
		profile.Data.QuestCompletion[questType] = {}
		profile.Data[questType .. "Counters"] = {Kills = 0, Wins = 0,TotalSummons = 0}
		if questType == "Daily" then
			profile.Data.LastDailyReset = os.time()
		else
			profile.Data.LastWeeklyReset = os.time()
		end
		QuestTimerEvent:FireClient(player, {Type = questType, Time = os.time()})
	else
		local remainingTime = resetInterval - timeSinceLastReset
		QuestTimerEvent:FireClient(player, {Type = questType, Time = lastReset})
	end
end

-- Player connection and profile management
Players.PlayerAdded:Connect(function(player)
	local profile = ProfileStore:LoadProfileAsync("Player_" .. player.UserId, notReleasedHandler)
	if not profile then
		player:Kick("Failed to load your quest data. Please rejoin.")
		return
	end
	loadedQuestProfiles[player.UserId] = profile
	profile:Reconcile()
	profile:AddUserId(player.UserId)

	-- Check and reset quests if necessary
	checkAndResetQuests(player, "Daily")
	checkAndResetQuests(player, "Weekly")

	player:WaitForChild("GameStats"):WaitForChild("TakeDowns").Changed:Connect(function()
		profile.Data.DailyCounters.Kills = profile.Data.DailyCounters.Kills + 1
		profile.Data.WeeklyCounters.Kills = profile.Data.WeeklyCounters.Kills + 1
		updateQuestProgress(player, "Defeat 1000 Enemies", profile.Data.DailyCounters.Kills)
		updateQuestProgress(player, "Defeat 10000 Enemies", profile.Data.WeeklyCounters.Kills)
		if isQuestCompleted(player, "Defeat 1000 Enemies") and not profile.Data.QuestCompletion.Daily["Defeat 1000 Enemies"] then
			markQuestCompleted(player, "Defeat 1000 Enemies")
		end
		if isQuestCompleted(player, "Defeat 10000 Enemies") and not profile.Data.QuestCompletion.Weekly["Defeat 10000 Enemies"] then
			markQuestCompleted(player, "Defeat 10000 Enemies")
		end
	end)
	player:WaitForChild("GameStats"):WaitForChild("Wins").Changed:Connect(function()
		profile.Data.DailyCounters.Wins = profile.Data.DailyCounters.Wins + 1
		profile.Data.WeeklyCounters.Wins = profile.Data.WeeklyCounters.Wins + 1
		updateQuestProgress(player, "Win 5 Matches", profile.Data.DailyCounters.Wins)
		updateQuestProgress(player, "Win 20 Matches", profile.Data.WeeklyCounters.Wins)
		if isQuestCompleted(player, "Win 5 Matches") and not profile.Data.QuestCompletion.Daily["Win 5 Matches"] then
			markQuestCompleted(player, "Win 5 Matches")
		end
		if isQuestCompleted(player, "Win 20 Matches") and not profile.Data.QuestCompletion.Weekly["Win 20 Matches"] then
			markQuestCompleted(player, "Win 20 Matches")
		end
	end)
	
	player:WaitForChild("GameStats"):WaitForChild("TotalSummons").Changed:Connect(function()
		profile.Data.DailyCounters.TotalSummons = profile.Data.DailyCounters.TotalSummons + 1
		profile.Data.WeeklyCounters.TotalSummons = profile.Data.WeeklyCounters.TotalSummons + 1
		updateQuestProgress(player, "Open 10 Crates", profile.Data.DailyCounters.TotalSummons)
		updateQuestProgress(player, "Open 50 Crates", profile.Data.WeeklyCounters.TotalSummons)
		if isQuestCompleted(player, "Open 10 Crates") and not profile.Data.QuestCompletion.Daily["Open 10 Crates"] then
			markQuestCompleted(player, "Open 10 Crates")
		end
		if isQuestCompleted(player, "Open 50 Crates") and not profile.Data.QuestCompletion.Weekly["Open 50 Crates"] then
			markQuestCompleted(player, "Open 50 Crates")
		end
	end)

	profile:ListenToRelease(function()
		loadedQuestProfiles[player.UserId] = nil
		if player:IsDescendantOf(game) then
			player:Kick("Your quest data was loaded in another session.")
		end
	end)

	player.AncestryChanged:Connect(function()
		if not player:IsDescendantOf(game) then
			local profile = loadedQuestProfiles[player.UserId]
			if profile then
				profile:Release()
				loadedQuestProfiles[player.UserId] = nil
			end
		end
	end)
end)

game:BindToClose(function()
	for _, player in pairs(Players:GetPlayers()) do
		local profile = loadedQuestProfiles[player.UserId]
		if profile then
			profile:Release()
			loadedQuestProfiles[player.UserId] = nil
		end
	end
	task.wait(5)
end)

return QuestsData