package ai

import (
	"net/http"

	"github.com/purujawa06-bot/na-api/backend/internal/aimodels"
	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
)

// modelsEpoch is the stable creation timestamp reported by /api/models
// (2024-01-01T00:00:00Z), matching the Next.js implementation.
const modelsEpoch int64 = 1704067200

// openAIModel is the OpenAI-compatible model object returned by /api/models.
type openAIModel struct {
	ID          string `json:"id"`
	Object      string `json:"object"`
	Created     int64  `json:"created"`
	OwnedBy     string `json:"owned_by"`
	Thinking    bool   `json:"thinking"`
	Label       string `json:"label"`
	Desc        string `json:"desc"`
	Chainable   bool   `json:"chainable"`
	Available   bool   `json:"available"`
	Description string `json:"description"`
}

// listModels serves GET /api/models, deriving every entry from aimodels.
func (h *handlers) listModels(w http.ResponseWriter, _ *http.Request) {
	data := make([]openAIModel, 0, len(aimodels.Models))
	for _, model := range aimodels.Models {
		data = append(data, openAIModel{
			ID:          model.ID,
			Object:      "model",
			Created:     modelsEpoch,
			OwnedBy:     model.OwnedBy,
			Thinking:    model.Thinking,
			Label:       model.Label,
			Desc:        model.Desc,
			Chainable:   model.Chainable,
			Available:   !isUnavailableModel(model.ID),
			Description: model.Desc,
		})
	}
	httpx.OK(w, map[string]any{
		"object":  "list",
		"data":    data,
		"default": "auto",
	})
}
