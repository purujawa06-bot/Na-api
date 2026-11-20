package cmd

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

func init() {
	Register(&Feature{
		Meta: Meta{
			ID:          "builtin:tt",
			Name:        "TikTok Downloader",
			Command:     "tt",
			Aliases:     []string{"tiktok"},
			Category:    "Downloader",
			ShowInMenu:  true,
			Description: "Download video TikTok tanpa watermark (.tt/.tiktok <url>)",
		},
		Run: func(req Request, api BotAPI) (Result, bool) {
			rawURL := strings.TrimSpace(req.Args)
			if rawURL == "" {
				return Result{Reply: "Gunakan: .tt <url tiktok> (alias: .tiktok)"}, true
			}
			ctx := req.Ctx
			if ctx == nil {
				ctx = context.Background()
			}
			ctx, cancel := context.WithTimeout(ctx, 120*time.Second)
			defer cancel()

			endpoint := naAPIBase + "/api/downloader/tiktok?url=" + url.QueryEscape(rawURL)
			hreq, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
			if err != nil {
				return Result{Reply: "Gagal mengunduh TikTok: " + err.Error()}, true
			}
			client := &http.Client{Timeout: 120 * time.Second}
			res, err := client.Do(hreq)
			if err != nil {
				return Result{Reply: "Gagal mengunduh TikTok: " + err.Error()}, true
			}
			defer res.Body.Close()
			rb, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))

			var j map[string]any
			if err := json.Unmarshal(rb, &j); err != nil {
				return Result{Reply: "Respons TikTok tidak valid."}, true
			}
			success, _ := j["success"].(bool)
			if !success {
				errMsg, _ := j["error"].(string)
				if strings.TrimSpace(errMsg) == "" {
					errMsg = strings.TrimSpace(string(rb))
				}
				if errMsg == "" {
					errMsg = "gagal memproses permintaan"
				}
				return Result{Reply: "Gagal unduh TikTok: " + errMsg}, true
			}
			getStr := func(k string) string {
				v, _ := j[k].(string)
				return strings.TrimSpace(v)
			}
			author := cleanOneLine(getStr("author"))
			title := cleanOneLine(getStr("caption"))
			videoURL := getStr("video_url")
			if len([]rune(title)) > 200 {
				title = string([]rune(title)[:200]) + "..."
			}
			var lines []string
			if title != "" {
				lines = append(lines, title)
			} else {
				lines = append(lines, "TikTok Video")
			}
			if author != "" {
				lines = append(lines, "Author: "+author)
			}
			caption := strings.TrimSpace(strings.Join(lines, "\n"))
			if videoURL == "" {
				return Result{Reply: caption + "\n(Video tidak tersedia)"}, true
			}
			return Result{VideoURL: videoURL, Caption: caption, Mimetype: "video/mp4"}, true
		},
	})
}

func cleanOneLine(s string) string {
	s = strings.ReplaceAll(s, "\r", " ")
	s = strings.ReplaceAll(s, "\n", " ")
	return strings.Join(strings.Fields(strings.TrimSpace(s)), " ")
}
