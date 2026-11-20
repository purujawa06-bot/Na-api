package purulocal

import (
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/purujawa06-bot/na-api/backend/internal/app"
)

type handlers struct {
	deps *app.Deps
}

func (h *handlers) updateManifest(w http.ResponseWriter, r *http.Request) {
	// Manifest update terbaru (rolling release) - disediakan via backend na-api agar URL built-in stabil.
	// Sumber utama: manifest yang dihasilkan & diupload CI ke GitHub release purulocal-experiment.
	manifestURL := "https://github.com/purujawa06-bot/Na-api/releases/download/purulocal-experiment/update-manifest.json"
	client := &http.Client{Timeout: 15 * time.Second}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, manifestURL, nil)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": err.Error()})
		return
	}
	res, err := client.Do(req)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "gagal mengambil manifest: " + err.Error()})
		return
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 400 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "manifest tidak tersedia"})
		return
	}
	// pastikan valid JSON, lalu teruskan apa adanya
	var j any
	if err := json.Unmarshal(b, &j); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "manifest tidak valid"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(b)
}
