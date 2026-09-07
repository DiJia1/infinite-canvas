package service

import (
	"encoding/json"
	"testing"

	"github.com/basketikun/infinite-canvas/ai"
	"github.com/basketikun/infinite-canvas/model"
	"github.com/shopspring/decimal"
)

func TestActiveImageProviderSchemaReturnsOnlyTheSelectedProviderSchema(t *testing.T) {
	const registeredType = "service-public-settings-test"
	_ = ai.Register(ai.ProviderType{
		ID:           registeredType,
		Name:         "Test provider",
		Capabilities: []ai.Capability{ai.CapabilityImageGenerate},
		ImageRequestSchema: &ai.ImageRequestSchema{
			Version: "v1", MaxReferenceImages: 10,
		},
	})
	settings := model.AISettings{
		ImageProviderID: "seedream",
		Providers:       []model.AIProvider{{ID: "seedream", Type: registeredType, Enabled: true, ImagePrices: []model.ImageResolutionPrice{{Resolution: "1k"}}}},
	}
	providerType, schema := activeImageProviderSchema(settings)
	if providerType != "service-public-settings-test" || schema == nil || schema.MaxReferenceImages != 10 {
		t.Fatalf("activeImageProviderSchema() = %q, %#v", providerType, schema)
	}
	providerType, schema = activeImageProviderSchema(model.AISettings{ImageProviderID: "missing", Providers: settings.Providers})
	if providerType != "" || schema != nil {
		t.Fatalf("activeImageProviderSchema() exposed unavailable provider = %q, %#v", providerType, schema)
	}
}

func TestPublicAIModelChoicesExposeOnlyEnabledInstancesWithoutConfig(t *testing.T) {
	const providerType = "service-public-model-choice-test"
	_ = ai.Register(ai.ProviderType{
		ID:           providerType,
		Name:         "Test image provider",
		Capabilities: []ai.Capability{ai.CapabilityImageGenerate, ai.CapabilityImageEdit},
		ImageRequestSchema: &ai.ImageRequestSchema{
			Version: "v1", MaxReferenceImages: 3,
		},
	})
	settings := model.AISettings{Providers: []model.AIProvider{
		{ID: "enabled", Name: "可选模型", Type: providerType, Enabled: true, ImagePrices: []model.ImageResolutionPrice{{Resolution: "1k"}}, Config: []byte(`{"apiKey":"secret","model":"internal-model"}`)},
		{ID: "disabled", Name: "不可选模型", Type: providerType, Enabled: false, Config: []byte(`{"apiKey":"secret"}`)},
	}}
	choices := publicAIModelChoices(settings, ai.CapabilityImageGenerate)
	if len(choices) != 1 || choices[0].ID != "enabled" || choices[0].Name != "可选模型" || choices[0].ImageRequestSchema == nil {
		t.Fatalf("publicAIModelChoices() = %#v", choices)
	}
}

func TestPublicAIModelChoicesExposeOnlyConfiguredResolutionPrices(t *testing.T) {
	const providerType = "service-public-model-prices-test"
	_ = ai.Register(ai.ProviderType{
		ID:           providerType,
		Name:         "Test priced image provider",
		Capabilities: []ai.Capability{ai.CapabilityImageGenerate},
		ImageRequestSchema: &ai.ImageRequestSchema{Version: "v1", Fields: []ai.ImageRequestField{{
			Key: "resolution", Label: "尺寸", Type: ai.ImageRequestFieldSelect,
			Default: json.RawMessage(`"1k"`),
			Options: []ai.ImageRequestFieldOption{{Value: "1k", Label: "1K"}, {Value: "2k", Label: "2K"}, {Value: "4k", Label: "4K"}},
		}}},
	})
	choices := publicAIModelChoices(model.AISettings{Providers: []model.AIProvider{{
		ID: "priced", Name: "定价模型", Type: providerType, Enabled: true,
		ImagePrices: []model.ImageResolutionPrice{{Resolution: "1k", Amount: decimal.RequireFromString("0.1200")}, {Resolution: "2k", Amount: decimal.RequireFromString("0.2400")}},
	}}}, ai.CapabilityImageGenerate)
	if len(choices) != 1 || choices[0].ImageRequestSchema == nil {
		t.Fatalf("choices = %#v", choices)
	}
	options := choices[0].ImageRequestSchema.Fields[0].Options
	if len(options) != 2 || options[0].Value != "1k" || options[0].Price != "0.12" || options[1].Value != "2k" || options[1].Price != "0.24" {
		t.Fatalf("resolution options = %#v", options)
	}
}

func TestPublicAIModelChoicesUseAdministratorResolutionParameters(t *testing.T) {
	const providerType = "service-custom-resolution-prices-test"
	_ = ai.Register(ai.ProviderType{
		ID: providerType, Name: "Custom resolution provider", Capabilities: []ai.Capability{ai.CapabilityImageGenerate},
		ImageRequestSchema: &ai.ImageRequestSchema{Version: "v1", Fields: []ai.ImageRequestField{{Key: "resolution", Label: "尺寸", Type: ai.ImageRequestFieldText, Required: true}}},
	})
	choices := publicAIModelChoices(model.AISettings{Providers: []model.AIProvider{{
		ID: "priced", Name: "定价模型", Type: providerType, Enabled: true,
		ImagePrices: []model.ImageResolutionPrice{{Resolution: "2K", Amount: decimal.RequireFromString("0.1200")}, {Resolution: "2048x1152", Amount: decimal.RequireFromString("0.2400")}},
	}}}, ai.CapabilityImageGenerate)
	if len(choices) != 1 || choices[0].ImageRequestSchema == nil {
		t.Fatalf("choices = %#v", choices)
	}
	field := choices[0].ImageRequestSchema.Fields[0]
	if field.Type != ai.ImageRequestFieldSelect || len(field.Options) != 2 || field.Options[0].Value != "2K" || field.Options[0].Label != "2K" || field.Options[1].Value != "2048x1152" {
		t.Fatalf("resolution field = %#v", field)
	}
}

func TestNormalizeSettingsDoesNotExpandLegacyImagePrice(t *testing.T) {
	const providerType = "service-legacy-image-prices-test"
	_ = ai.Register(ai.ProviderType{
		ID: providerType, Name: "Legacy pricing provider", Capabilities: []ai.Capability{ai.CapabilityImageGenerate},
		ImageRequestSchema: &ai.ImageRequestSchema{Fields: []ai.ImageRequestField{{Key: "resolution", Type: ai.ImageRequestFieldSelect, Options: []ai.ImageRequestFieldOption{{Value: "1k"}, {Value: "2k"}}}}},
	})
	settings := normalizeSettings(model.Settings{AI: model.AISettings{Providers: []model.AIProvider{{
		ID: "legacy", Name: "旧模型", Type: providerType, ImageCallAmount: decimal.RequireFromString("0.1234"), ImagePrices: nil,
	}}}})
	if prices := settings.AI.Providers[0].ImagePrices; prices != nil {
		t.Fatalf("legacy prices = %#v, want nil", prices)
	}
}

func TestValidateSettingsAllowsCustomResolutionPricesAndRejectsUnsafeRules(t *testing.T) {
	const providerType = "service-image-price-validation-test"
	_ = ai.Register(ai.ProviderType{
		ID: providerType, Name: "Validation provider", Capabilities: []ai.Capability{ai.CapabilityImageGenerate},
		ImageRequestSchema: &ai.ImageRequestSchema{Fields: []ai.ImageRequestField{{Key: "resolution", Type: ai.ImageRequestFieldSelect, Options: []ai.ImageRequestFieldOption{{Value: "1k"}, {Value: "2k"}}}}},
	})
	if err := validateSettings(model.AISettings{Providers: []model.AIProvider{{
		ID: "model", Name: "模型", Type: providerType,
		ImagePrices: []model.ImageResolutionPrice{{Resolution: "1536x1024", Amount: decimal.Zero}}, Config: []byte(`{}`),
	}}}); err != nil {
		t.Fatalf("validateSettings() rejected a custom price rule: %v", err)
	}
	for _, prices := range [][]model.ImageResolutionPrice{
		{{Resolution: "2K", Amount: decimal.Zero}, {Resolution: "2k", Amount: decimal.Zero}},
		{{Resolution: "", Amount: decimal.Zero}},
		{{Resolution: "2K\ninvalid", Amount: decimal.Zero}},
		{{Resolution: "2k", Amount: decimal.RequireFromString("0.00001")}},
	} {
		if err := validateSettings(model.AISettings{Providers: []model.AIProvider{{ID: "model", Name: "模型", Type: providerType, ImagePrices: prices, Config: []byte(`{}`)}}}); err == nil {
			t.Fatalf("validateSettings() accepted prices %#v", prices)
		}
	}
}
