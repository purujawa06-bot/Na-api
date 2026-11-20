package bot

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"regexp"
	"strings"
	"time"
)

var (
	reTmpfilesHref = regexp.MustCompile(`href=["'](https?://tmpfiles\.org/dl/[^"'\s>]+)`)
	reTmpfilesAbs  = regexp.MustCompile(`https?://tmpfiles\.org/dl/[^\s"'<>)]+`)
)

// uploadToTmpfiles mengunggah data ke tmpfiles.org dan mengembalikan direct download URL.
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
	if m := reTmpfilesHref.FindStringSubmatch(text); len(m) > 1 {
		return strings.TrimSpace(m[1]), nil
	}
	if m := reTmpfilesAbs.FindString(text); m != "" {
		return strings.TrimSpace(m), nil
	}
	// coba parse JSON {"data":{"url":"https://tmpfiles.org/123/file"}}
	// konversi /123/ -> /dl/123/
	if idx := strings.Index(text, "tmpfiles.org/"); idx >= 0 {
		// crude: cari url tmpfiles
		start := strings.LastIndex(text[:idx+20], "http")
		if start >= 0 {
			end := start
			for end < len(text) && text[end] != '"' && text[end] != '\'' && text[end] != '\\' && text[end] > ' ' {
				end++
			}
			u := text[start:end]
			if strings.Contains(u, "tmpfiles.org/") && !strings.Contains(u, "/dl/") {
				u = strings.Replace(u, "tmpfiles.org/", "tmpfiles.org/dl/", 1)
				return u, nil
			}
			if strings.Contains(u, "/dl/") {
				return u, nil
			}
		}
	}
	return "", fmt.Errorf("gagal mendapatkan link tmpfiles")
}
