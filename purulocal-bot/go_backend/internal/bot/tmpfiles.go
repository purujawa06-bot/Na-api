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
	reTmpfilesHref = regexp.MustCompile(`href=["'](https?://tmpfiles\.org/dl/[^"'\s>]+)`)
	reTmpfilesAbs  = regexp.MustCompile(`https?://tmpfiles\.org/dl/[^\s"'<>)]+`)
	reTmpfilesAny  = regexp.MustCompile(`https?://(?:www\.)?tmpfiles\.org/[^\s"'<>)]+`)
)

// normalizeTmpfilesDirectURL memastikan URL tmpfiles adalah direct download (/dl/...),
// bukan halaman HTML dengan tombol unduh.
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
	// /12345/file.ext -> /dl/12345/file.ext
	if strings.Count(strings.Trim(u.Path, "/"), "/") >= 1 {
		u.Path = "/dl/" + strings.TrimPrefix(u.Path, "/")
		return u.String()
	}
	return raw
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

	// 1) coba JSON API: {"data":{"url":"https://tmpfiles.org/123/file"}}
	var payload struct {
		Data struct {
			URL string `json:"url"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rb, &payload); err == nil && strings.TrimSpace(payload.Data.URL) != "" {
		if direct := normalizeTmpfilesDirectURL(payload.Data.URL); strings.Contains(direct, "/dl/") {
			return direct, nil
		}
		// fallback: ambil direct link dari halaman HTML
		if direct, err := fetchTmpfilesDirectLink(ctx, client, payload.Data.URL); err == nil && direct != "" {
			return direct, nil
		}
	}

	// 2) cari pola direct URL di body
	if m := reTmpfilesHref.FindStringSubmatch(text); len(m) > 1 {
		if direct := normalizeTmpfilesDirectURL(m[1]); strings.Contains(direct, "/dl/") {
			return direct, nil
		}
	}
	if m := reTmpfilesAbs.FindString(text); m != "" {
		if direct := normalizeTmpfilesDirectURL(m); strings.Contains(direct, "/dl/") {
			return direct, nil
		}
	}

	// 3) cari URL tmpfiles apa pun lalu normalisasi ke /dl/ (atau scrape halaman)
	if m := reTmpfilesAny.FindString(text); m != "" {
		direct := normalizeTmpfilesDirectURL(m)
		if strings.Contains(direct, "/dl/") {
			return direct, nil
		}
		if scraped, err := fetchTmpfilesDirectLink(ctx, client, m); err == nil && scraped != "" {
			return scraped, nil
		}
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
	if m := reTmpfilesHref.FindStringSubmatch(text); len(m) > 1 {
		return normalizeTmpfilesDirectURL(m[1]), nil
	}
	if m := reTmpfilesAbs.FindString(text); m != "" {
		return normalizeTmpfilesDirectURL(m), nil
	}
	// fallback: normalisasi URL halaman ke /dl/
	if direct := normalizeTmpfilesDirectURL(pageURL); strings.Contains(direct, "/dl/") {
		return direct, nil
	}
	return "", fmt.Errorf("direct link tmpfiles tidak ditemukan")
}
