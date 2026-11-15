package tools

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
)

const bratUpstreamURL = "https://api.siputzx.my.id/api/m/brat"

func (h *handlers) brat(w http.ResponseWriter, r *http.Request) {
	text := strings.TrimSpace(r.URL.Query().Get("text"))
	if text == "" && r.Method == http.MethodPost {
		if ct := r.Header.Get("Content-Type"); strings.Contains(strings.ToLower(ct), "application/json") {
			if body, ok := decodeBody(w, r); ok {
				if v, ok := stringValue(body, "text"); ok {
					text = strings.TrimSpace(v)
				}
			} else {
				return
			}
		} else {
			_ = r.ParseForm()
			text = strings.TrimSpace(r.FormValue("text"))
		}
	}
	if text == "" {
		httpx.Error(w, http.StatusBadRequest, "Parameter 'text' wajib diisi")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()

	payload, err := json.Marshal(map[string]any{
		"text":       text,
		"isAnimated": false,
		"delay":      500,
	})
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "Gagal menyiapkan permintaan brat")
		return
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, bratUpstreamURL, bytes.NewReader(payload))
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "Gagal membuat permintaan brat")
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36")
	req.Header.Set("Referer", "https://tools.mirai-pedia.com/brat-generator/")

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		httpx.UpstreamError(w, "Gagal menghubungi layanan brat: "+err.Error())
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 20<<20))
	if err != nil {
		httpx.UpstreamError(w, "Gagal membaca respons brat: "+err.Error())
		return
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		msg := strings.TrimSpace(string(body))
		if msg == "" {
			msg = fmt.Sprintf("upstream status %d", resp.StatusCode)
		} else if len(msg) > 300 {
			msg = msg[:300]
		}
		httpx.UpstreamError(w, "Gagal membuat gambar brat: "+msg)
		return
	}

	ct := resp.Header.Get("Content-Type")
	if ct == "" {
		ct = http.DetectContentType(body)
	}
	if !strings.Contains(strings.ToLower(ct), "image/") {
		// Upstream returned non-image; surface as upstream error.
		msg := strings.TrimSpace(string(body))
		if msg == "" {
			msg = "respons upstream bukan gambar"
		} else if len(msg) > 300 {
			msg = msg[:300]
		}
		httpx.UpstreamError(w, "Gagal membuat gambar brat: "+msg)
		return
	}

	w.Header().Set("Content-Type", ct)
	w.Header().Set("Cache-Control", "public, max-age=300, s-maxage=300")
	w.Header().Set("Content-Length", strconv.Itoa(len(body)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}
