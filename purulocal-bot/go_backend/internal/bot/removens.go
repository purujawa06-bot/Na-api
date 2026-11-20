package bot

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"strings"
	"time"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types/events"
)

const noiseRemoverAPI = "https://na-api-nue-api-e7bfd3f4.koyeb.app/api/tools/noise-remover"

func (m *Manager) handleRemoveNoiseCommand(ctx context.Context, evt *events.Message) error {
	// batas waktu keseluruhan agar tidak menggantung
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()

	audioMsg := m.findAudioForRemoveNoise(evt)
	if audioMsg == nil {
		_ = m.sendReply(ctx, evt, "Reply audio/voice note dengan .removens untuk menghapus noise.")
		return nil
	}

	m.mu.RLock()
	c := m.client
	m.mu.RUnlock()
	if c == nil {
		return errors.New("client not ready")
	}

	if err := m.sendReply(ctx, evt, "Memproses penghapusan noise, mohon tunggu..."); err != nil {
		m.logWarn("removens", "gagal kirim status awal: "+err.Error())
	}

	m.logInfo("removens", "mulai unduh audio dari WhatsApp")
	data, err := c.Download(ctx, audioMsg)
	if err != nil {
		m.logError("removens", "download audio gagal: "+err.Error())
		_ = m.sendReply(ctx, evt, "Gagal mengunduh audio: "+err.Error())
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
	m.logInfo("removens", fmt.Sprintf("audio %d bytes mime=%s -> kirim ke noise-remover", len(data), mime))

	resultURL, err := callNoiseRemoverAPI(ctx, data, filename, mime)
	if err != nil {
		m.logError("removens", "noise-remover gagal: "+err.Error())
		_ = m.sendReply(ctx, evt, "Gagal menghapus noise: "+err.Error())
		return nil
	}
	if strings.TrimSpace(resultURL) == "" {
		m.logError("removens", "URL hasil kosong")
		_ = m.sendReply(ctx, evt, "Gagal menghapus noise: URL hasil tidak ditemukan.")
		return nil
	}
	m.logInfo("removens", "hasil: "+resultURL)

	res := ExecResult{
		AudioURL: resultURL,
		Mimetype: "audio/wav",
		Caption:  "Hasil penghapusan noise",
	}
	if err := m.sendAudioFromURL(ctx, evt, res); err != nil {
		m.logError("removens", "kirim audio gagal: "+err.Error())
		// fallback: kirim link jika gagal kirim audio
		if err2 := m.sendReply(ctx, evt, "Audio bersih: "+resultURL+"\n\n(Gagal mengirim audio: "+err.Error()+")"); err2 != nil {
			m.logError("removens", "kirim fallback link juga gagal: "+err2.Error())
		}
		return nil
	}
	m.logInfo("removens", "audio hasil terkirim")
	return nil
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

func callNoiseRemoverAPI(ctx context.Context, data []byte, filename, mime string) (string, error) {
	// hormati deadline ctx (sudah dibatasi pemanggil), beri batas maksimal total 5 menit
	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, 5*time.Minute)
		defer cancel()
	}

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)

	// file
	h := make(textproto.MIMEHeader)
	escapedName := strings.ReplaceAll(strings.ReplaceAll(filename, "\\", "_"), "\"", "_")
	h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename="%s"`, escapedName))
	ct := strings.TrimSpace(mime)
	if ct == "" {
		ct = "application/octet-stream"
	}
	h.Set("Content-Type", ct)
	part, err := w.CreatePart(h)
	if err != nil {
		return "", err
	}
	if _, err := part.Write(data); err != nil {
		return "", err
	}
	// mode & duration_seconds sesuai permintaan
	_ = w.WriteField("mode", "demo")
	_ = w.WriteField("duration_seconds", "30")
	if err := w.Close(); err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, noiseRemoverAPI, &buf)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set("Accept", "application/x-ndjson")

	client := &http.Client{} // timeout dikendalikan oleh context
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return "", fmt.Errorf("HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	type ndEvent struct {
		Event      string `json:"event"`
		Success    bool   `json:"success"`
		Status     string `json:"status"`
		Error      string `json:"error"`
		URL        string `json:"url"`
		HTTPStatus int    `json:"httpStatus"`
	}

	scanner := bufio.NewScanner(resp.Body)
	lineBuf := make([]byte, 0, 64*1024)
	scanner.Buffer(lineBuf, 2*1024*1024)
	var lastErr string
	var lastURL string
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var ev ndEvent
		if err := json.Unmarshal([]byte(line), &ev); err != nil {
			continue
		}
		if strings.TrimSpace(ev.URL) != "" {
			lastURL = ev.URL
		}
		if ev.Event == "done" {
			if ev.Success && strings.TrimSpace(ev.URL) != "" {
				return ev.URL, nil
			}
			if strings.TrimSpace(ev.Error) != "" {
				lastErr = ev.Error
			} else if !ev.Success {
				lastErr = "proses gagal"
			}
			break
		}
		if !ev.Success && strings.TrimSpace(ev.Error) != "" {
			lastErr = ev.Error
		}
	}
	if err := scanner.Err(); err != nil {
		return "", fmt.Errorf("gagal membaca respons: %w", err)
	}
	if strings.TrimSpace(lastURL) != "" {
		return lastURL, nil
	}
	if strings.TrimSpace(lastErr) != "" {
		return "", fmt.Errorf("%s", lastErr)
	}
	return "", fmt.Errorf("respons tidak valid atau tanpa hasil")
}
