package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const naAPIBase = "https://na-api-nue-api-e7bfd3f4.koyeb.app"

func init() {
	Register(&Feature{
		Meta: Meta{
			ID:          "builtin:play",
			Name:        "Play Music",
			Command:     "play",
			Category:    "Downloader",
			ShowInMenu:  true,
			Description: "Cari & putar musik dari SoundCloud (.play <judul>)",
		},
		Run: func(req Request, api BotAPI) (Result, bool) {
			query := strings.TrimSpace(req.Args)
			if query == "" {
				return Result{Reply: "Gunakan: .play <judul lagu>"}, true
			}
			ctx := req.Ctx
			if ctx == nil {
				ctx = context.Background()
			}
			ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
			defer cancel()

			endpoint := naAPIBase + "/api/play/soundcloud?q=" + url.QueryEscape(query)
			hreq, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
			if err != nil {
				return Result{Reply: "Gagal mencari musik: " + err.Error()}, true
			}
			client := &http.Client{Timeout: 30 * time.Second}
			res, err := client.Do(hreq)
			if err != nil {
				return Result{Reply: "Gagal mencari musik: " + err.Error()}, true
			}
			defer res.Body.Close()
			rb, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
			if res.StatusCode >= 400 {
				return Result{Reply: "Gagal mencari musik: " + strings.TrimSpace(string(rb))}, true
			}
			var j struct {
				Success bool   `json:"success"`
				Track   struct {
					Title        string `json:"title"`
					Author       string `json:"author"`
					DurationMs   int64  `json:"duration_ms"`
					PermalinkURL string `json:"permalink_url"`
					StreamURL    string `json:"stream_url"`
				} `json:"track"`
				Error string `json:"error"`
			}
			if err := json.Unmarshal(rb, &j); err != nil {
				return Result{Reply: "Hasil musik tidak dapat dibaca."}, true
			}
			if !j.Success || strings.TrimSpace(j.Track.Title) == "" {
				if strings.TrimSpace(j.Error) != "" {
					return Result{Reply: "Gagal: " + j.Error}, true
				}
				return Result{Reply: "Lagu tidak ditemukan."}, true
			}
			title := strings.TrimSpace(j.Track.Title)
			link := strings.TrimSpace(j.Track.PermalinkURL)
			author := strings.TrimSpace(j.Track.Author)
			durSec := uint32(0)
			if j.Track.DurationMs > 0 {
				durSec = uint32((j.Track.DurationMs + 500) / 1000)
			}
			lines := []string{"\U0001F3B5 *" + title + "*"}
			if author != "" {
				lines = append(lines, "\U0001F464 "+author)
			}
			if link != "" {
				lines = append(lines, "\U0001F517 "+link)
			}
			out := Result{Reply: strings.Join(lines, "\n"), Title: title, PermalinkURL: link}
			if durSec > 0 {
				out.DurationSec = durSec
			}
			if link != "" {
				out.AudioURL = naAPIBase + "/api/play/soundcloud/audio?url=" + url.QueryEscape(link)
				out.Mimetype = "audio/mpeg"
			} else if strings.TrimSpace(j.Track.StreamURL) != "" {
				out.AudioURL = naAPIBase + "/api/play/soundcloud/audio?q=" + url.QueryEscape(query)
				out.Mimetype = "audio/mpeg"
			}
			_ = fmt.Sprint()
			return out, true
		},
	})
}
