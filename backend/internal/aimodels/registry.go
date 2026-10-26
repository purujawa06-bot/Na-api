// Package aimodels is the single source of truth for the public AI model
// registry. Every other list (models endpoint, docs, admin panel) derives from
// it, mirroring the original Next.js implementation.
package aimodels

import "strings"

// Model describes one public model entry.
type Model struct {
	ID        string `json:"id"`
	Label     string `json:"label"`
	Desc      string `json:"desc"`
	Thinking  bool   `json:"thinking"`
	Chainable bool   `json:"chainable"`
	OwnedBy   string `json:"owned_by"`
}

// Models is the ordered public registry.
var Models = []Model{
	{ID: "gemini-3.6-flash", Label: "Gemini 3.6 Flash", Desc: "Model AI Gemini 3.6 Flash", OwnedBy: "gemini-web", Chainable: true},
	{ID: "gemini", Label: "Gemini", Desc: "Model AI dari Gemini", OwnedBy: "gemini-share", Chainable: true},
	{ID: "gemini-1.5-flash", Label: "Gemini 1.5 Flash", Desc: "Model AI Gemini 1.5 Flash", OwnedBy: "easemate-web", Chainable: true},
	{ID: "gpt-4.1-mini", Label: "GPT-4.1 Mini", Desc: "Model AI chat GPT-4.1 Mini", OwnedBy: "quillbot-web", Chainable: true},
	{ID: "auto", Label: "Auto (Fallback)", Desc: "Otomatis memilih model terbaik", OwnedBy: "auto-web"},
}

// ChainDefault is the default fallback order for the auto model.
var ChainDefault = []string{"gemini-3.6-flash", "gemini-1.5-flash"}

// IDs returns every public model ID in display order.
func IDs() []string {
	ids := make([]string, 0, len(Models))
	for _, model := range Models {
		ids = append(ids, model.ID)
	}
	return ids
}

// ChainAllowed returns IDs eligible for the auto fallback chain.
func ChainAllowed() []string {
	ids := make([]string, 0, len(Models))
	for _, model := range Models {
		if model.Chainable {
			ids = append(ids, model.ID)
		}
	}
	return ids
}

// IsKnown reports whether id is a public model.
func IsKnown(id string) bool {
	for _, model := range Models {
		if model.ID == id {
			return true
		}
	}
	return false
}

// IsChainable reports whether id may appear in the auto fallback chain.
func IsChainable(id string) bool {
	for _, model := range Models {
		if model.ID == id && model.Chainable {
			return true
		}
	}
	return false
}

// NormalizeChain removes unknown or duplicate IDs and restores the default
// order when nothing usable remains.
func NormalizeChain(chain []string) []string {
	seen := make(map[string]bool, len(chain))
	result := make([]string, 0, len(chain))
	for _, id := range chain {
		id = strings.TrimSpace(id)
		if !IsChainable(id) || seen[id] {
			continue
		}
		seen[id] = true
		result = append(result, id)
	}
	if len(result) == 0 {
		return append([]string(nil), ChainDefault...)
	}
	return result
}
