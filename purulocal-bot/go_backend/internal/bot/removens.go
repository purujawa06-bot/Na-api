package bot

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types/events"
)

const nirkyyBaseURL = "https://nirkyy-a.hf.space"

func (m *Manager) handleRemoveNoiseCommand(ctx context.Context, evt *events.Message) error {
	// Proses denoise (nirkyy SSE) bisa lama; lepas dari timeout singkat context dispatch command.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Minute)
	defer cancel()

	m.logInfo("removens", "command diterima")

	audioMsg := m.findAudioForRemoveNoise(evt)
	if audioMsg == nil {
		_ = m.sendReply(ctx, evt, "Reply audio/voice note dengan .removens untuk menghapus noise.")
		return nil
	}

	m.mu.RLock()
	c := m.client
	m.mu.RUnlock()
	if c == nil {
		m.logError("removens", "client tidak siap")
		_ = m.sendReply(ctx, evt, "Bot belum siap, coba lagi.")
		return nil
	}

	if err := m.sendReply(ctx, evt, "Memproses penghapusan noise, mohon tunggu..."); err != nil {
		m.logWarn("removens", "gagal kirim status awal: "+err.Error())
	}

	m.logInfo("removens", "mulai unduh audio dari WhatsApp")
	type dlRes struct {
		data []byte
		err  error
	}
	dlCh := make(chan dlRes, 1)
	go func() {
		d, e := c.Download(ctx, audioMsg)
		dlCh <- dlRes{data: d, err: e}
	}()
	var data []byte
	var dlErr error
	select {
	case r := <-dlCh:
		data, dlErr = r.data, r.err
	case <-ctx.Done():
		dlErr = fmt.Errorf("timeout mengunduh audio: %w", ctx.Err())
	}
	if dlErr != nil {
		m.logError("removens", "download audio gagal: "+dlErr.Error())
		_ = m.sendReply(ctx, evt, "Gagal mengunduh audio: "+dlErr.Error())
		return nil
	}
	if len(data) == 0 {
		m.logError("removens", "audio kosong")
		_ = m.sendReply(ctx, evt, "Audio kosong atau tidak dapat diunduh.")
		return nil
	}

	mime := strings.TrimSpace(strings.ToLower(audioMsg.GetMimetype()))
	if i := strings.Index(mime, ";"); i >= 0 {
		mime = strings.TrimSpace(mime[:i])
	}
	filename := audioFilenameFromMime(mime)
	m.logInfo("removens", fmt.Sprintf("audio %d bytes mime=%s -> denoise nirkyy (HTTP)", len(data), mime))

	cleanWav, err := nirkyyDenoiseHTTP(ctx, data, filename, mime)
	if err != nil {
		m.logError("removens", "denoise gagal: "+err.Error())
		_ = m.sendReply(ctx, evt, "Gagal menghapus noise: "+err.Error())
		return nil
	}
	m.logInfo("removens", fmt.Sprintf("hasil denoise %d bytes, konversi ke format playable", len(cleanWav)))

	outData, outMime, outName, outPTT := preparePlayableAudio(ctx, m, cleanWav)

	// unggah hasil ke tmpfiles untuk dikirim sebagai audio URL
	resultURL, err := uploadToTmpfiles(ctx, outData, outName, outMime)
	if err != nil {
		m.logError("removens", "unggah hasil gagal: "+err.Error())
		_ = m.sendReply(ctx, evt, "Gagal mengunggah hasil: "+err.Error())
		return nil
	}
	m.logInfo("removens", "hasil: "+resultURL+" mime="+outMime+" ptt="+fmt.Sprint(outPTT))

	res := ExecResult{
		AudioURL: resultURL,
		Mimetype: outMime,
		Caption:  "Hasil penghapusan noise",
		PTT:      outPTT,
	}
	if err := m.sendAudioFromURL(ctx, evt, res); err != nil {
		m.logError("removens", "kirim audio gagal: "+err.Error())
		if err2 := m.sendReply(ctx, evt, "Audio bersih: "+resultURL+"\n\n(Gagal mengirim audio: "+err.Error()+")"); err2 != nil {
			m.logError("removens", "kirim fallback link juga gagal: "+err2.Error())
		}
		return nil
	}
	m.logInfo("removens", "audio hasil terkirim")
	return nil
}

// nirkyyDenoiseHTTP: reverse-engineering nirkyy-a.hf.space (Gradio 6.32.0, /gradio_api, fn denoise)
// via HTTP langsung: upload -> /call/denoise -> SSE complete -> download hasil.
func nirkyyDenoiseHTTP(ctx context.Context, audio []byte, filename, contentType string) ([]byte, error) {
	client := &http.Client{Timeout: 5 * time.Minute}
	base := strings.TrimRight(nirkyyBaseURL, "/")

	// 1) upload ke gradio
	fpath, err := nirkyyUpload(ctx, client, base, audio, filename, contentType)
	if err != nil {
		return nil, err
	}

	// 2) call denoise
	fileURL := base + "/gradio_api/file=" + fpath
	payload := map[string]any{
		"data": []any{
			map[string]any{
				"path":      fileURL,
				"url":       fileURL,
				"orig_name": filename,
				"meta":      map[string]any{"_type": "gradio.FileData"},
			},
		},
	}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/gradio_api/call/denoise", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("gagal membuat request denoise: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("gagal memanggil denoise: %w", err)
	}
	rb, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, fmt.Errorf("gagal memanggil denoise (HTTP %d): %s", resp.StatusCode, strings.TrimSpace(string(rb)))
	}
	var callRes struct {
		EventID string `json:"event_id"`
	}
	if err := json.Unmarshal(rb, &callRes); err != nil || strings.TrimSpace(callRes.EventID) == "" {
		return nil, fmt.Errorf("event_id denoise tidak ditemukan: %s", strings.TrimSpace(string(rb)))
	}

	// 3) baca SSE hasil
	outURL, err := nirkyyWaitResult(ctx, client, base, callRes.EventID)
	if err != nil {
		return nil, err
	}

	// 4) download hasil
	return nirkyyDownload(ctx, client, base, outURL)
}

func nirkyyUpload(ctx context.Context, client *http.Client, base string, audio []byte, filename, contentType string) (string, error) {
	if strings.TrimSpace(filename) == "" {
		filename = "audio.wav"
	}
	if strings.TrimSpace(contentType) == "" {
		contentType = "application/octet-stream"
	}
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	h := make(textproto.MIMEHeader)
	escaped := strings.ReplaceAll(strings.ReplaceAll(filename, "\\", "_"), "\"", "_")
	h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="files"; filename="%s"`, escaped))
	h.Set("Content-Type", contentType)
	part, err := w.CreatePart(h)
	if err != nil {
		return "", fmt.Errorf("gagal membuat upload form: %w", err)
	}
	if _, err := part.Write(audio); err != nil {
		return "", fmt.Errorf("gagal menulis upload form: %w", err)
	}
	if err := w.Close(); err != nil {
		return "", fmt.Errorf("gagal menutup upload form: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/gradio_api/upload", &buf)
	if err != nil {
		return "", fmt.Errorf("gagal membuat request upload: %w", err)
	}
	req.Header.Set("Content-Type", w.FormDataContentType())

	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("gagal upload audio: %w", err)
	}
	rb, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return "", fmt.Errorf("gagal upload audio (HTTP %d): %s", resp.StatusCode, strings.TrimSpace(string(rb)))
	}

	// respons biasanya: ["<path>"] atau [{"path":"...","url":"..."}]
	var arr []any
	if err := json.Unmarshal(rb, &arr); err != nil {
		// coba string tunggal
		var s string
		if err2 := json.Unmarshal(rb, &s); err2 == nil && strings.TrimSpace(s) != "" {
			return strings.TrimSpace(s), nil
		}
		return "", fmt.Errorf("respons upload tidak valid: %s", strings.TrimSpace(string(rb)))
	}
	if len(arr) == 0 {
		return "", fmt.Errorf("respons upload kosong")
	}
	switch v := arr[0].(type) {
	case string:
		if strings.TrimSpace(v) == "" {
			return "", fmt.Errorf("path upload kosong")
		}
		return strings.TrimSpace(v), nil
	case map[string]any:
		for _, k := range []string{"path", "name", "url"} {
			if s, ok := v[k].(string); ok && strings.TrimSpace(s) != "" {
				// jika "url" berupa file=... atau path absolut URL, tetap bisa dipakai sebagai path? prefer path/name
				if k == "url" {
					// coba ambil path dari url /gradio_api/file=<path>
					if idx := strings.Index(s, "/gradio_api/file="); idx >= 0 {
						return strings.TrimSpace(s[idx+len("/gradio_api/file="):]), nil
					}
					if _, okp := v["path"].(string); okp {
						continue
					}
				}
				return strings.TrimSpace(s), nil
			}
		}
	}
	return "", fmt.Errorf("path upload tidak ditemukan: %s", strings.TrimSpace(string(rb)))
}

func nirkyyWaitResult(ctx context.Context, client *http.Client, base, eventID string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/gradio_api/call/denoise/"+eventID, nil)
	if err != nil {
		return "", fmt.Errorf("gagal membuat request hasil: %w", err)
	}
	req.Header.Set("Accept", "text/event-stream")
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("gagal membaca hasil denoise: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		rb, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return "", fmt.Errorf("gagal membaca hasil denoise (HTTP %d): %s", resp.StatusCode, strings.TrimSpace(string(rb)))
	}

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 64*1024), 4*1024*1024)
	var curEvent string
	var dataLines []string
	flush := func() (string, string, bool) {
		if curEvent == "" && len(dataLines) == 0 {
			return "", "", false
		}
		data := strings.Join(dataLines, "\n")
		ev := curEvent
		curEvent = ""
		dataLines = nil
		return ev, data, true
	}

	for scanner.Scan() {
		line := scanner.Text()
		if strings.TrimSpace(line) == "" {
			ev, data, ok := flush()
			if !ok {
				continue
			}
			switch ev {
			case "complete":
				url, perr := nirkyyExtractOutputURL(base, data)
				if perr != nil {
					return "", perr
				}
				return url, nil
			case "error":
				msg := strings.TrimSpace(data)
				if msg == "" || msg == "null" {
					msg = "proses denoise gagal"
				}
				return "", fmt.Errorf("%s", msg)
			}
			continue
		}
		if strings.HasPrefix(line, "event:") {
			curEvent = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
		} else if strings.HasPrefix(line, "data:") {
			dataLines = append(dataLines, strings.TrimSpace(strings.TrimPrefix(line, "data:")))
		}
	}
	if err := scanner.Err(); err != nil {
		return "", fmt.Errorf("gagal membaca stream hasil: %w", err)
	}
	// flush sisa (jika stream berakhir tanpa newline kosong)
	if ev, data, ok := flush(); ok {
		if ev == "complete" {
			return nirkyyExtractOutputURL(base, data)
		}
		if ev == "error" {
			msg := strings.TrimSpace(data)
			if msg == "" || msg == "null" {
				msg = "proses denoise gagal"
			}
			return "", fmt.Errorf("%s", msg)
		}
	}
	return "", fmt.Errorf("hasil denoise tidak ditemukan (event complete tidak diterima)")
}

func nirkyyExtractOutputURL(base, data string) (string, error) {
	data = strings.TrimSpace(data)
	if data == "" || data == "null" {
		return "", fmt.Errorf("data hasil denoise kosong")
	}
	var arr []any
	if err := json.Unmarshal([]byte(data), &arr); err != nil {
		return "", fmt.Errorf("format hasil denoise tidak valid: %w", err)
	}
	if len(arr) == 0 {
		return "", fmt.Errorf("hasil denoise kosong")
	}
	switch v := arr[0].(type) {
	case string:
		return nirkyyNormalizeFileURL(base, v)
	case map[string]any:
		if u, ok := v["url"].(string); ok && strings.TrimSpace(u) != "" {
			return nirkyyNormalizeFileURL(base, u)
		}
		if p, ok := v["path"].(string); ok && strings.TrimSpace(p) != "" {
			return nirkyyNormalizeFileURL(base, p)
		}
	}
	return "", fmt.Errorf("URL hasil denoise tidak ditemukan")
}

func nirkyyNormalizeFileURL(base, u string) (string, error) {
	u = strings.TrimSpace(u)
	if u == "" {
		return "", fmt.Errorf("URL hasil denoise kosong")
	}
	if strings.HasPrefix(u, "http://") || strings.HasPrefix(u, "https://") {
		return u, nil
	}
	// path server -> /gradio_api/file=<path>
	u = strings.TrimLeft(u, "/")
	if strings.HasPrefix(u, "gradio_api/file=") {
		return base + "/" + u, nil
	}
	return base + "/gradio_api/file=" + u, nil
}

func nirkyyDownload(ctx context.Context, client *http.Client, base, url string) ([]byte, error) {
	url, err := nirkyyNormalizeFileURL(base, url)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("gagal membuat request download hasil: %w", err)
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("gagal mengunduh hasil denoise: %w", err)
	}
	defer resp.Body.Close()
	out, err := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
	if err != nil {
		return nil, fmt.Errorf("gagal membaca hasil denoise: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, fmt.Errorf("gagal mengunduh hasil denoise (HTTP %d): %s", resp.StatusCode, strings.TrimSpace(string(out)))
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("hasil denoise kosong")
	}
	return out, nil
}

func preparePlayableAudio(ctx context.Context, m *Manager, wav []byte) ([]byte, string, string, bool) {
	// Prioritas: MP3 (paling kompatibel untuk audio biasa, seperti .play), lalu M4A, lalu OGG/Opus sebagai PTT.
	type attempt struct {
		format string
		mime   string
		name   string
		ptt    bool
	}
	attempts := []attempt{
		{format: "mp3", mime: "audio/mpeg", name: "cleaned.mp3", ptt: false},
		{format: "m4a", mime: "audio/mp4", name: "cleaned.m4a", ptt: false},
		{format: "opus", mime: "audio/ogg; codecs=opus", name: "cleaned.ogg", ptt: true},
		{format: "ogg", mime: "audio/ogg", name: "cleaned.ogg", ptt: true},
	}
	for _, a := range attempts {
		if out, err := convertAudioLocal(ctx, wav, a.format); err == nil && len(out) > 0 && looksLikeAudio(out, a.format) {
			if m != nil {
				m.logInfo("removens", "konversi lokal berhasil: "+a.format)
			}
			return out, a.mime, a.name, a.ptt
		}
		if out, err := convertAudioViaAPI(ctx, wav, "cleaned.wav", a.format); err == nil && len(out) > 0 && looksLikeAudio(out, a.format) {
			if m != nil {
				m.logInfo("removens", "konversi via API berhasil: "+a.format)
			}
			return out, a.mime, a.name, a.ptt
		}
	}
	if m != nil {
		m.logWarn("removens", "semua konversi gagal, kirim WAV (mungkin tidak dapat diputar)")
	}
	return wav, "audio/wav", "cleaned.wav", false
}

func convertAudioLocal(ctx context.Context, wav []byte, format string) ([]byte, error) {
	dir, err := os.MkdirTemp("", "nr-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	inPath := filepath.Join(dir, "in.wav")
	ext := format
	if format == "opus" {
		ext = "ogg"
	}
	outPath := filepath.Join(dir, "out."+ext)
	if err := os.WriteFile(inPath, wav, 0o600); err != nil {
		return nil, err
	}

	var cmds [][]string
	switch format {
	case "mp3":
		cmds = [][]string{
			{"-y", "-hide_banner", "-loglevel", "error", "-i", inPath, "-vn", "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "128k", outPath},
			{"-y", "-hide_banner", "-loglevel", "error", "-i", inPath, "-vn", "-ar", "44100", "-ac", "2", "-b:a", "128k", outPath},
		}
	case "m4a":
		cmds = [][]string{
			{"-y", "-hide_banner", "-loglevel", "error", "-i", inPath, "-vn", "-ar", "44100", "-ac", "2", "-c:a", "aac", "-b:a", "128k", outPath},
		}
	case "opus":
		cmds = [][]string{
			{"-y", "-hide_banner", "-loglevel", "error", "-i", inPath, "-vn", "-ar", "48000", "-ac", "1", "-c:a", "libopus", "-b:a", "64k", outPath},
		}
	case "ogg":
		cmds = [][]string{
			{"-y", "-hide_banner", "-loglevel", "error", "-i", inPath, "-vn", "-ar", "48000", "-ac", "1", "-c:a", "libopus", "-b:a", "64k", outPath},
			{"-y", "-hide_banner", "-loglevel", "error", "-i", inPath, "-vn", "-ar", "44100", "-ac", "2", "-c:a", "libvorbis", "-q:a", "4", outPath},
		}
	default:
		return nil, fmt.Errorf("format tidak didukung: %s", format)
	}

	var lastErr error
	for _, args := range cmds {
		_ = os.Remove(outPath)
		cmd := exec.CommandContext(ctx, "ffmpeg", args...)
		out, err := cmd.CombinedOutput()
		if err != nil {
			msg := strings.TrimSpace(string(out))
			if msg != "" {
				lastErr = fmt.Errorf("ffmpeg: %w: %s", err, msg)
			} else {
				lastErr = err
			}
			continue
		}
		b, err := os.ReadFile(outPath)
		if err != nil {
			lastErr = err
			continue
		}
		if len(b) == 0 {
			lastErr = fmt.Errorf("hasil konversi kosong")
			continue
		}
		return b, nil
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("konversi gagal")
	}
	return nil, lastErr
}

// convertAudioViaAPI mencoba konversi via endpoint na-api /api/tools/ffmpeg (NDJSON) sebagai fallback.
func convertAudioViaAPI(ctx context.Context, data []byte, filename, format string) ([]byte, error) {
	const api = "https://na-api-nue-api-e7bfd3f4.koyeb.app/api/tools/ffmpeg"
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	h := make(textproto.MIMEHeader)
	escaped := strings.ReplaceAll(strings.ReplaceAll(filename, "\\", "_"), "\"", "_")
	h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename="%s"`, escaped))
	h.Set("Content-Type", "audio/wav")
	part, err := w.CreatePart(h)
	if err != nil {
		return nil, err
	}
	if _, err := part.Write(data); err != nil {
		return nil, err
	}
	_ = w.WriteField("format", format)
	if err := w.Close(); err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, api, &buf)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", w.FormDataContentType())
	client := &http.Client{Timeout: 5 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		rb, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(rb)))
	}
	rb, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return nil, err
	}
	// parse NDJSON, ambil URL dari event done sukses
	var resultURL string
	for _, line := range strings.Split(string(rb), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var ev struct {
			Event   string `json:"event"`
			Success bool   `json:"success"`
			URL     string `json:"url"`
			Error   string `json:"error"`
		}
		if json.Unmarshal([]byte(line), &ev) == nil {
			if ev.Event == "done" && ev.Success && strings.TrimSpace(ev.URL) != "" {
				resultURL = ev.URL
			} else if ev.Event == "done" && !ev.Success && ev.Error != "" {
				return nil, fmt.Errorf("%s", ev.Error)
			}
		}
	}
	if resultURL == "" {
		return nil, fmt.Errorf("URL hasil konversi tidak ditemukan")
	}
	// normalisasi URL tmpfiles ke direct /dl/ (hindari halaman HTML tombol unduh)
	if d := normalizeTmpfilesDirectURL(resultURL); d != "" {
		resultURL = d
	}
	// download hasil (butuh header agar tidak dapat HTML/interstitial dari host)
	out, err := downloadFileBytes(ctx, client, resultURL, 32<<20)
	if err != nil {
		return nil, err
	}
	if !looksLikeAudio(out, format) {
		return nil, fmt.Errorf("hasil konversi tidak valid (bukan audio %s)", format)
	}
	return out, nil
}

func (m *Manager) findAudioForRemoveNoise(evt *events.Message) *waE2E.AudioMessage {
	if evt == nil || evt.Message == nil {
		return nil
	}
	msg := evt.Message
	// 1) audio langsung (jika command dikirim sebagai caption audio - jarang, tapi didukung)
	if a := msg.GetAudioMessage(); a != nil {
		return a
	}
	// 2) reply/quote ke audio atau voice note
	if ci := extractIncomingContextInfo(msg); ci != nil {
		if q := ci.GetQuotedMessage(); q != nil {
			if a := q.GetAudioMessage(); a != nil {
				return a
			}
		}
	}
	return nil
}

func audioFilenameFromMime(mime string) string {
	switch {
	case strings.Contains(mime, "ogg"), strings.Contains(mime, "opus"):
		return "audio.ogg"
	case strings.Contains(mime, "mpeg"), strings.Contains(mime, "mp3"):
		return "audio.mp3"
	case strings.Contains(mime, "mp4"), strings.Contains(mime, "m4a"), strings.Contains(mime, "aac"):
		return "audio.m4a"
	case strings.Contains(mime, "wav"):
		return "audio.wav"
	case strings.Contains(mime, "amr"):
		return "audio.amr"
	default:
		return "audio.bin"
	}
}

func downloadFileBytes(ctx context.Context, client *http.Client, rawURL string, limit int64) ([]byte, error) {
	if client == nil {
		client = &http.Client{Timeout: 90 * time.Second}
	}
	tryURL := normalizeTmpfilesDirectURL(rawURL)
	for attempt := 0; attempt < 2; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, tryURL, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
		req.Header.Set("Accept", "*/*")
		req.Header.Set("Accept-Language", "en-US,en;q=0.9,id;q=0.8")
		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		body, err := io.ReadAll(io.LimitReader(resp.Body, limit))
		resp.Body.Close()
		if err != nil {
			return nil, err
		}
		if resp.StatusCode < 200 || resp.StatusCode > 299 {
			return nil, fmt.Errorf("gagal unduh file (HTTP %d): %s", resp.StatusCode, strings.TrimSpace(string(bodySnippet(body, 200))))
		}
		if len(body) == 0 {
			return nil, fmt.Errorf("file kosong")
		}
		ct := strings.ToLower(strings.TrimSpace(resp.Header.Get("Content-Type")))
		if strings.Contains(ct, "text/html") || looksLikeHTML(body) {
			// tmpfiles /dl/ sederhana bisa redirect ke halaman HTML; ambil direct link bertoken dari halaman
			if attempt == 0 && isTmpfilesURL(rawURL) {
				if direct, err := fetchTmpfilesDirectLink(ctx, client, resp.Request.URL.String()); err == nil && direct != "" && direct != tryURL {
					tryURL = direct
					continue
				}
				if direct, err := fetchTmpfilesDirectLink(ctx, client, tryURL); err == nil && direct != "" && direct != tryURL {
					tryURL = direct
					continue
				}
			}
			return nil, fmt.Errorf("unduhan mengembalikan HTML, bukan file audio")
		}
		return body, nil
	}
	return nil, fmt.Errorf("gagal mengunduh file audio")
}

func bodySnippet(b []byte, n int) []byte {
	if len(b) <= n {
		return b
	}
	return b[:n]
}

func looksLikeHTML(b []byte) bool {
	s := strings.ToLower(strings.TrimSpace(string(bodySnippet(b, 256))))
	return strings.HasPrefix(s, "<!doctype html") || strings.HasPrefix(s, "<html") || strings.Contains(s, "<html")
}

func looksLikeAudio(b []byte, format string) bool {
	if len(b) < 4 || looksLikeHTML(b) {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(format)) {
	case "mp3":
		return (len(b) > 3 && string(b[:3]) == "ID3") || (b[0] == 0xFF && (b[1]&0xE0) == 0xE0)
	case "m4a", "mp4", "aac":
		return len(b) > 8 && string(b[4:8]) == "ftyp"
	case "ogg", "opus":
		return string(b[:4]) == "OggS"
	case "wav":
		return len(b) > 12 && string(b[:4]) == "RIFF" && string(b[8:12]) == "WAVE"
	default:
		// longgarkan: asalkan bukan HTML/kosong
		return true
	}
}
