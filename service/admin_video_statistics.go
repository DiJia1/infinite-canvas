package service

import (
	"github.com/basketikun/infinite-canvas/model"
	"github.com/shopspring/decimal"
	"sort"
	"strings"
)

type VideoStatisticsTotals struct {
	SuccessfulCalls int                        `json:"successfulCalls"`
	VideoCount      int                        `json:"videoCount"`
	Seconds         int                        `json:"seconds"`
	Amount          decimal.Decimal            `json:"amount"`
	UpstreamCosts   map[string]decimal.Decimal `json:"upstreamCosts"`
}
type VideoStatistics struct {
	VideoStatisticsTotals
	Models []VideoModelStatistics `json:"models"`
	Users  []VideoUserStatistics  `json:"users"`
}
type VideoModelStatistics struct {
	VideoStatisticsTotals
	ProviderID   string                      `json:"providerId"`
	ProviderName string                      `json:"providerName"`
	Resolutions  []VideoResolutionStatistics `json:"resolutions"`
}
type VideoResolutionStatistics struct {
	VideoStatisticsTotals
	Resolution string `json:"resolution"`
}
type VideoUserStatistics struct {
	VideoStatisticsTotals
	UserUID     string                 `json:"userUid"`
	DisplayName string                 `json:"displayName"`
	Models      []VideoModelStatistics `json:"models"`
}

func (total *VideoStatisticsTotals) add(task model.VideoGenerationTask) {
	total.SuccessfulCalls++
	count := imageTaskResultCount(task.ResultMediaIDsJSON)
	total.VideoCount += count
	total.Seconds += videoOperationDetails(task).Seconds
	total.Amount = total.Amount.Add(task.Amount)
	if total.UpstreamCosts == nil {
		total.UpstreamCosts = map[string]decimal.Decimal{}
	}
	currency := strings.ToUpper(strings.TrimSpace(task.UpstreamCurrency))
	if cost, err := decimal.NewFromString(task.UpstreamCost); err == nil && !cost.IsNegative() && currency != "" {
		total.UpstreamCosts[currency] = total.UpstreamCosts[currency].Add(cost)
	}
}
func aggregateVideoTaskStatistics(tasks []model.VideoGenerationTask, names map[string]string) VideoStatistics {
	result := VideoStatistics{VideoStatisticsTotals: VideoStatisticsTotals{Amount: decimal.Zero, UpstreamCosts: map[string]decimal.Decimal{}}, Models: []VideoModelStatistics{}, Users: []VideoUserStatistics{}}
	succeeded := make([]model.VideoGenerationTask, 0, len(tasks))
	users := map[string][]model.VideoGenerationTask{}
	for _, task := range tasks {
		if task.Status != "succeeded" {
			continue
		}
		succeeded = append(succeeded, task)
		result.add(task)
		users[task.OwnerUID] = append(users[task.OwnerUID], task)
	}
	result.Models = aggregateVideoModels(succeeded)
	for uid, userTasks := range users {
		name := strings.TrimSpace(names[uid])
		if name == "" {
			name = uid
		}
		user := VideoUserStatistics{UserUID: uid, DisplayName: name, Models: aggregateVideoModels(userTasks)}
		for _, task := range userTasks {
			user.add(task)
		}
		result.Users = append(result.Users, user)
	}
	sort.Slice(result.Users, func(i, j int) bool {
		a, b := result.Users[i], result.Users[j]
		if !a.Amount.Equal(b.Amount) {
			return a.Amount.GreaterThan(b.Amount)
		}
		return a.UserUID < b.UserUID
	})
	return result
}
func aggregateVideoModels(tasks []model.VideoGenerationTask) []VideoModelStatistics {
	groups := map[string]*VideoModelStatistics{}
	resolutions := map[string]map[string]*VideoResolutionStatistics{}
	for _, task := range tasks {
		key := task.ProviderID + "\x00" + task.ProviderName
		group := groups[key]
		if group == nil {
			name := task.ProviderName
			if name == "" {
				name = task.ProviderID
			}
			group = &VideoModelStatistics{ProviderID: task.ProviderID, ProviderName: name, Resolutions: []VideoResolutionStatistics{}}
			groups[key] = group
			resolutions[key] = map[string]*VideoResolutionStatistics{}
		}
		group.add(task)
		resolution := strings.ToLower(strings.TrimSpace(videoOperationDetails(task).Resolution))
		detail := resolutions[key][resolution]
		if detail == nil {
			detail = &VideoResolutionStatistics{Resolution: resolution}
			resolutions[key][resolution] = detail
		}
		detail.add(task)
	}
	result := make([]VideoModelStatistics, 0, len(groups))
	for key, group := range groups {
		for _, detail := range resolutions[key] {
			group.Resolutions = append(group.Resolutions, *detail)
		}
		sort.Slice(group.Resolutions, func(i, j int) bool { return group.Resolutions[i].Resolution < group.Resolutions[j].Resolution })
		result = append(result, *group)
	}
	sort.Slice(result, func(i, j int) bool {
		a, b := result[i], result[j]
		if !a.Amount.Equal(b.Amount) {
			return a.Amount.GreaterThan(b.Amount)
		}
		if a.ProviderID != b.ProviderID {
			return a.ProviderID < b.ProviderID
		}
		return a.ProviderName < b.ProviderName
	})
	return result
}
