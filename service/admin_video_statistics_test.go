package service

import (
	"encoding/json"
	"github.com/basketikun/infinite-canvas/model"
	"github.com/shopspring/decimal"
	"strings"
	"testing"
)

func TestVideoStatisticsUsesSuccessfulSnapshotsAndSeparateCurrencies(t *testing.T) {
	tasks := []model.VideoGenerationTask{
		{ID: "one", Status: "succeeded", OwnerUID: "alice", ProviderID: "provider", ProviderName: "历史模型", RequestJSON: `{"seconds":5,"resolution":"720P"}`, ResultMediaIDsJSON: `["one","two"]`, Amount: decimal.RequireFromString("0.1234"), UpstreamCost: "1.5", UpstreamCurrency: "USD"},
		{ID: "two", Status: "succeeded", OwnerUID: "bob", ProviderID: "provider", ProviderName: "历史模型", RequestJSON: `{"seconds":10,"resolution":"720p"}`, ResultMediaIDsJSON: `["three"]`, Amount: decimal.RequireFromString("0.0001"), UpstreamCost: "3", UpstreamCurrency: "CNY"},
		{ID: "failed", Status: "failed", OwnerUID: "alice", Amount: decimal.NewFromInt(99), ResultMediaIDsJSON: `["bad"]`},
		{ID: "paused", Status: "paused", OwnerUID: "alice", Amount: decimal.NewFromInt(99)},
		{ID: "uncertain", Status: "uncertain", OwnerUID: "alice", Amount: decimal.NewFromInt(99)},
	}
	got := aggregateVideoTaskStatistics(tasks, map[string]string{"alice": "张三"})
	if got.SuccessfulCalls != 2 || got.VideoCount != 3 || got.Seconds != 15 || got.Amount.String() != "0.1235" {
		t.Fatalf("totals=%+v", got)
	}
	if got.UpstreamCosts["USD"].String() != "1.5" || got.UpstreamCosts["CNY"].String() != "3" {
		t.Fatalf("currencies=%v", got.UpstreamCosts)
	}
	if len(got.Models) != 1 || len(got.Models[0].Resolutions) != 1 || got.Models[0].Resolutions[0].Seconds != 15 {
		t.Fatalf("models=%+v", got.Models)
	}
	if len(got.Users) != 2 || got.Users[0].DisplayName != "张三" || got.Users[1].DisplayName != "bob" {
		t.Fatalf("users=%+v", got.Users)
	}
	baseline, _ := json.Marshal(got)
	tasks[0], tasks[1] = tasks[1], tasks[0]
	reordered, _ := json.Marshal(aggregateVideoTaskStatistics(tasks, map[string]string{"alice": "张三"}))
	if string(baseline) != string(reordered) {
		t.Fatal("unstable aggregation")
	}
}

func TestVideoOperationDetailsOnlyExposeAllowlistedSnapshot(t *testing.T) {
	task := model.VideoGenerationTask{ID: "local", Status: "running", ProviderID: "provider", ProviderName: "模型", ProviderTaskID: "upstream", Amount: decimal.RequireFromString("1.25"), ProviderConfig: `{"apiKey":"secret"}`, ResultURLsJSON: `["https://private.example/signed"]`, RequestJSON: `{"seconds":5,"resolution":"720p","size":"16:9","generateAudio":true,"apiKey":"secret","url":"https://private.example/signed"}`}
	got := videoOperationDetails(task)
	if got.Status != "running" || got.ProviderTaskID != "upstream" || got.Seconds != 5 || !got.GenerateAudio || got.Amount.String() != "1.25" {
		t.Fatalf("details=%+v", got)
	}
	encoded, _ := json.Marshal(got)
	for _, secret := range []string{"secret", "apiKey", "https://", "ProviderConfig", "resultURLs"} {
		if strings.Contains(string(encoded), secret) {
			t.Fatalf("exposed %s: %s", secret, encoded)
		}
	}
}
