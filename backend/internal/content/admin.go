package content

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/purujawa06-bot/na-api/backend/internal/aimodels"
	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
)

// adminLogin handles POST /api/admin/login.
func (h *handler) adminLogin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Password *string `json:"password"`
	}
	if err := httpx.DecodeJSON(r, &body); err != nil {
		httpx.JSON(w, http.StatusBadRequest, map[string]any{
			"success": false,
			"error":   "Invalid request body",
		})
		return
	}

	if body.Password != nil && h.matchesAdminKey(*body.Password) {
		httpx.OK(w, map[string]any{
			"success": true,
			"message": "Login successful",
		})
		return
	}
	httpx.JSON(w, http.StatusUnauthorized, map[string]any{
		"success": false,
		"message": "Invalid password",
	})
}

// getAutoChain handles GET /api/admin/aichain. It is public on purpose so the
// admin panel can render the current chain before logging in.
func (h *handler) getAutoChain(w http.ResponseWriter, r *http.Request) {
	chain := append([]string(nil), aimodels.ChainDefault...)
	if h.deps != nil && h.deps.Settings != nil {
		chain = h.deps.Settings.AutoChain(r.Context())
	}
	httpx.OK(w, map[string]any{"chain": chain})
}

// invalidChainMessage mirrors the Indonesian validation message in settings.
func invalidChainMessage() string {
	allowed, err := json.Marshal(aimodels.ChainAllowed())
	if err != nil {
		allowed = []byte("[]")
	}
	return "chain tidak valid; gunakan array ID dari " + string(allowed) + " minimal satu"
}

// setAutoChain handles POST /api/admin/aichain (array or {"chain":[...]}).
func (h *handler) setAutoChain(w http.ResponseWriter, r *http.Request) {
	if !h.adminAuthorized(r) {
		httpx.JSON(w, http.StatusUnauthorized, map[string]any{"error": "Invalid password"})
		return
	}
	if h.deps == nil || h.deps.Settings == nil {
		httpx.JSON(w, http.StatusInternalServerError, map[string]any{
			"error": "Gagal menyimpan urutan fallback",
		})
		return
	}

	var raw json.RawMessage
	if err := httpx.DecodeJSON(r, &raw); err != nil {
		httpx.JSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}

	var chain []string
	if strings.HasPrefix(strings.TrimSpace(string(raw)), "[") {
		if err := json.Unmarshal(raw, &chain); err != nil {
			httpx.JSON(w, http.StatusBadRequest, map[string]any{"error": invalidChainMessage()})
			return
		}
	} else {
		var body struct {
			Chain []string `json:"chain"`
		}
		if err := json.Unmarshal(raw, &body); err != nil {
			httpx.JSON(w, http.StatusBadRequest, map[string]any{"error": invalidChainMessage()})
			return
		}
		chain = body.Chain
	}

	if len(aimodels.NormalizeChain(chain)) == 0 {
		httpx.JSON(w, http.StatusBadRequest, map[string]any{"error": invalidChainMessage()})
		return
	}

	saved, err := h.deps.Settings.SetAutoChain(r.Context(), chain)
	if err != nil {
		httpx.JSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	httpx.OK(w, map[string]any{"chain": saved})
}

// getFeatured handles GET /api/admin/featured.
func (h *handler) getFeatured(w http.ResponseWriter, r *http.Request) {
	if h.deps == nil || h.deps.Settings == nil {
		httpx.JSON(w, http.StatusInternalServerError, map[string]any{
			"error": "Failed to fetch featured endpoint",
		})
		return
	}
	document, err := h.deps.Settings.Featured(r.Context())
	if err != nil {
		httpx.JSON(w, http.StatusInternalServerError, map[string]any{
			"error": "Failed to fetch featured endpoint",
		})
		return
	}
	if document == nil || string(document) == "null" {
		httpx.OK(w, map[string]any{})
		return
	}
	httpx.OK(w, document)
}

// setFeatured handles POST /api/admin/featured.
func (h *handler) setFeatured(w http.ResponseWriter, r *http.Request) {
	if !h.adminAuthorized(r) {
		httpx.JSON(w, http.StatusUnauthorized, map[string]any{"error": "Invalid password"})
		return
	}
	if h.deps == nil || h.deps.Settings == nil {
		httpx.JSON(w, http.StatusInternalServerError, map[string]any{
			"error": "Failed to update featured endpoint",
		})
		return
	}

	var body json.RawMessage
	if err := httpx.DecodeJSON(r, &body); err != nil {
		httpx.JSON(w, http.StatusInternalServerError, map[string]any{
			"error": "Failed to update featured endpoint",
		})
		return
	}

	updated, err := h.deps.Settings.SetFeatured(r.Context(), body)
	if err != nil {
		httpx.JSON(w, http.StatusInternalServerError, map[string]any{
			"error": "Failed to update featured endpoint",
		})
		return
	}
	httpx.OK(w, updated)
}
