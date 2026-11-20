package bot

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"regexp"
	"strings"
	"time"
)

var (
	reTmpfilesHref = regexp.MustCompile(`href=["'](https?://(?:www\.)?tmpfiles\.org/dl/[^"'\s>]+)`)
	reTmpfilesAbs  = regexp.MustCompile(`https?://(?:www\.)?tmpfiles\.org/dl/[^\s"'<>)]+`)
	reTmpfilesAny  = regexp.MustCompile(`https?://(?:www\.)?tmpfiles\.org/[^\s"'<>)]+`)
)

// normalizeTmpfilesDirectURL mengubah URL halaman tmpfiles ke bentuk /dl/.
// Catatan: bentuk /dl/<id>/<file> sederhana bisa redirect ke halaman HTML;
// direct URL nyata sering bertoken (/dl/<token>/<id>/<file>) yang harus diambil dari halaman.
func normalizeTmpfilesDirectURL(raw string) string {
	raw = strings.TrimSpace(strings.Trim(raw, `"'`))
	if raw == "" {
		return ""
	}
	u, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	host := strings.ToLower(u.Host)
	if host != "tmpfiles.org" && host != "www.tmpfiles.org" {
		return raw
	}
	if strings.HasPrefix(u.Path, "/dl/") {
		return u.String()
	}
	// /12345/file.ext -> /dl/12345/file.ext (mungkin perlu resolusi token dari halaman)
	if strings.Count(strings.Trim(u.Path, "/"), "/") >= 1 {
		u.Path = "/dl/" + strings.TrimPrefix(u.Path, "/")
		return u.String()
	}
	return raw
}

func isTmpfilesURL(raw string) bool {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return false
	}
	host := strings.ToLower(u.Host)
	return host == "tmpfiles.org" || host == "www.tmpfiles.org"
}

// isTokenizedTmpfilesDirectURL mendeteksi direct URL bertoken, mis:
// /dl/<timestamp>.<hash>/<id>/<filename> (lebih andal daripada /dl/<id>/<filename>).
func isTokenizedTmpfilesDirectURL(raw string) bool {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return false
	}
	if !strings.HasPrefix(u.Path, "/dl/") {
		return false
	}
	segs := strings.Split(strings.Trim(strings.TrimPrefix(u.Path, "/dl/"), "/"), "/")
	// token + id + filename => >= 3 segmen
	return len(segs) >= 3
}

func pickBestTmpfilesDirectLink(links []string) string {
	var first string
	for _, l := range links {
		l = normalizeTmpfilesDirectURL(l)
		u, err := url.Parse(l)
		if err != nil || !strings.HasPrefix(u.Path, "/dl/") {
			continue
		}
		if first == "" {
			first = l
		}
		if isTokenizedTmpfilesDirectURL(l) {
			return l
		}
	}
	return first
}

// uploadToTmpfiles mengunggah data ke tmpfiles.org dan mengembalikan direct download URL (/dl/...).
func uploadToTmpfiles(ctx context.Context, data []byte, filename, contentType string) (string, error) {
	if strings.TrimSpace(filename) == "" {
		filename = "file.bin"
	}
	if strings.TrimSpace(contentType) == "" {
		contentType = "application/octet-stream"
	}
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	h := make(textproto.MIMEHeader)
	escaped := strings.ReplaceAll(strings.ReplaceAll(filename, "\\", "_"), "\"", "_")
	h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename="%s"`, escaped))
	h.Set("Content-Type", contentType)
	part, err := w.CreatePart(h)
	if err != nil {
		return "", err
	}
	if _, err := part.Write(data); err != nil {
		return "", err
	}
	if err := w.Close(); err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://tmpfiles.org/api/v1/upload", &body)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", w.FormDataContentType())
	client := &http.Client{Timeout: 90 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	rb, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return "", fmt.Errorf("upload gagal (HTTP %d): %s", resp.StatusCode, strings.TrimSpace(string(rb)))
	}
	text := string(rb)

	// 1) coba JSON API: {"data":{"url":"https://tmpfiles.org/123/file"}} (URL halaman)
	var payload struct {
		Data struct {
			URL string `json:"url"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rb, &payload); err == nil && strings.TrimSpace(payload.Data.URL) != "" {
		pageURL := strings.TrimSpace(payload.Data.URL)
		// Ambil direct link bertoken dari halaman (paling andal). Bentuk /dl/<id>/<file>
		// sederhana saat ini bisa redirect ke HTML, jadi jangan langsung dipercaya.
		if direct, err := fetchTmpfilesDirectLink(ctx, client, pageURL); err == nil && direct != "" {
			return direct, nil
		}
		if direct := normalizeTmpfilesDirectURL(pageURL); isTokenizedTmpfilesDirectURL(direct) {
			return direct, nil
		}
	}

	// 2) cari direct URL bertoken di body (jika ada)
	var links []string
	for _, m := range reTmpfilesHref.FindAllStringSubmatch(text, -1) {
		if len(m) > 1 {
			links = append(links, m[1])
		}
	}
	links = append(links, reTmpfilesAbs.FindAllString(text, -1)...)
	if best := pickBestTmpfilesDirectLink(links); isTokenizedTmpfilesDirectURL(best) {
		return best, nil
	}

	// 3) cari URL tmpfiles apa pun (page/dl) lalu resolve ke direct link bertoken via halaman
	if m := reTmpfilesAny.FindString(text); m != "" {
		if scraped, err := fetchTmpfilesDirectLink(ctx, client, m); err == nil && scraped != "" {
			return scraped, nil
		}
		if best := pickBestTmpfilesDirectLink(links); best != "" {
			return best, nil
		}
	}
	if best := pickBestTmpfilesDirectLink(links); best != "" {
		return best, nil
	}
	return "", fmt.Errorf("gagal mendapatkan direct link tmpfiles")
}

func fetchTmpfilesDirectLink(ctx context.Context, client *http.Client, pageURL string) (string, error) {
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, pageURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	rb, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return "", err
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return "", fmt.Errorf("gagal mengambil halaman tmpfiles (HTTP %d)", resp.StatusCode)
	}
	text := string(rb)
	var links []string
	for _, m := range reTmpfilesHref.FindAllStringSubmatch(text, -1) {
		if len(m) > 1 {
			links = append(links, m[1])
		}
	}
	links = append(links, reTmpfilesAbs.FindAllString(text, -1)...)
	if best := pickBestTmpfilesDirectLink(links); best != "" {
		return best, nil
	}
	// fallback terakhir: normalisasi URL halaman ke /dl/ (bisa saja masih redirect)
	if direct := normalizeTmpfilesDirectURL(pageURL); strings.Contains(direct, "/dl/") {
		return direct, nil
	}
	return "", fmt.Errorf("direct link tmpfiles tidak ditemukan")
}
