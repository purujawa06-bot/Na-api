package tools

import (
	"context"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
)

const (
	ffmpegMaxFileBytes = 64 << 20 // 64 MiB
	ffmpegTimeout      = 5 * time.Minute
)

var reFFmpegFormat = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,9}$`)

//book_tools_ffmpeg
func (h *handlers) ffmpegConvert(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		failJSON(w, http.StatusBadRequest, "Form multipart tidak valid, gunakan field file dan format")
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		failJSON(w, http.StatusBadRequest, `Parameter "file" wajib diisi`)
		return
	}
	defer file.Close()

	format := strings.ToLower(strings.TrimSpace(r.FormValue("format")))
	if format == "" {
		format = strings.ToLower(strings.TrimSpace(r.FormValue("to")))
	}
	format = strings.TrimPrefix(format, ".")
	if format == "" {
		failJSON(w, http.StatusBadRequest, `Parameter "format" (target konversi, mis. mp3/wav/mp4/ogg) wajib diisi`)
		return
	}
	if !reFFmpegFormat.MatchString(format) {
		failJSON(w, http.StatusBadRequest, "Format target tidak valid")
		return
	}

	flusher, ok := httpx.StartNDJSON(w)
	if !ok {
		return
	}
	emitter := newNDJSONEmitter(w, flusher)
	defer emitter.close()

	ctx, cancel := context.WithTimeout(r.Context(), ffmpegTimeout)
	defer cancel()

	emitter.emit(streamEvent{Event: "processing", Status: "running", Message: "Membaca file..."})
	data, err := io.ReadAll(io.LimitReader(file, ffmpegMaxFileBytes+1))
	if err != nil {
		emitter.stopHeartbeat()
		emitter.emit(map[string]any{"event": "done", "success": false, "status": "error", "error": "Gagal membaca file", "httpStatus": 400})
		return
	}
	if len(data) == 0 {
		emitter.stopHeartbeat()
		emitter.emit(map[string]any{"event": "done", "success": false, "status": "error", "error": "File kosong", "httpStatus": 400})
		return
	}
	if len(data) > ffmpegMaxFileBytes {
		emitter.stopHeartbeat()
		emitter.emit(map[string]any{"event": "done", "success": false, "status": "error", "error": fmt.Sprintf("File melebihi batas %d MB", ffmpegMaxFileBytes/(1<<20)), "httpStatus": 400})
		return
	}

	inName := strings.TrimSpace(header.Filename)
	if inName == "" {
		inName = "input"
	}
	inExt := strings.ToLower(path.Ext(inName))
	if inExt == "" || len(inExt) > 10 || !reFFmpegFormat.MatchString(strings.TrimPrefix(inExt, ".")) {
		inExt = ".bin"
	}

	emitter.emit(streamEvent{Event: "processing", Status: "running", Message: "Mengonversi media..."})
	outData, outMime, outName, err := runFFmpegConvert(ctx, data, inExt, format)
	if err != nil {
		emitter.stopHeartbeat()
		emitter.emit(map[string]any{"event": "done", "success": false, "status": "error", "error": err.Error(), "httpStatus": 502})
		return
	}

	emitter.emit(streamEvent{Event: "processing", Status: "running", Message: "Mengunggah hasil..."})
	hostedURL, err := uploadToTmpfiles(ctx, outData, outName, outMime)
	emitter.stopHeartbeat()
	if err != nil {
		emitter.emit(map[string]any{"event": "done", "success": false, "status": "error", "error": "Gagal unggah hasil: " + err.Error(), "httpStatus": 502})
		return
	}

	emitter.emit(map[string]any{
		"event":    "done",
		"success":  true,
		"status":   "success",
		"source":   "ffmpeg",
		"url":      hostedURL,
		"size":     len(outData),
		"mimetype": outMime,
		"filename": outName,
		"format":   format,
	})
}

func runFFmpegConvert(ctx context.Context, input []byte, inExt, format string) ([]byte, string, string, error) {
	dir, err := os.MkdirTemp("", "ffmpeg-*")
	if err != nil {
		return nil, "", "", err
	}
	defer os.RemoveAll(dir)

	inPath := filepath.Join(dir, "input"+inExt)
	outName := "output." + format
	outPath := filepath.Join(dir, outName)
	if err := os.WriteFile(inPath, input, 0o600); err != nil {
		return nil, "", "", err
	}

	argSets := [][]string{ffmpegArgs(inPath, outPath, format)}
	// fallback mp3 jika libmp3lame tidak tersedia
	if format == "mp3" {
		argSets = append(argSets, []string{"-y", "-hide_banner", "-loglevel", "error", "-i", inPath, "-vn", "-ar", "44100", "-ac", "2", "-b:a", "128k", outPath})
	}
	var lastErr error
	for i, args := range argSets {
		if i > 0 {
			_ = os.Remove(outPath)
		}
		cmd := exec.CommandContext(ctx, "ffmpeg", args...)
		if out, err := cmd.CombinedOutput(); err != nil {
			msg := strings.TrimSpace(string(out))
			if len(msg) > 500 {
				msg = msg[len(msg)-500:]
			}
			if msg != "" {
				lastErr = fmt.Errorf("konversi gagal: %s", msg)
			} else {
				lastErr = fmt.Errorf("konversi gagal: %w", err)
			}
			continue
		}
		lastErr = nil
		break
	}
	if lastErr != nil {
		return nil, "", "", lastErr
	}

	outData, err := os.ReadFile(outPath)
	if err != nil {
		return nil, "", "", fmt.Errorf("gagal membaca hasil konversi: %w", err)
	}
	if len(outData) == 0 {
		return nil, "", "", fmt.Errorf("hasil konversi kosong")
	}

	outMime := mime.TypeByExtension("." + format)
	if i := strings.Index(outMime, ";"); i >= 0 {
		outMime = strings.TrimSpace(outMime[:i])
	}
	if outMime == "" {
		switch format {
		case "mp3":
			outMime = "audio/mpeg"
		case "mp4", "m4a":
			outMime = "audio/mp4"
			if format == "mp4" {
				outMime = "video/mp4"
			}
		case "wav":
			outMime = "audio/wav"
		case "ogg", "opus":
			outMime = "audio/ogg"
		case "webm":
			outMime = "video/webm"
		case "gif":
			outMime = "image/gif"
		default:
			outMime = "application/octet-stream"
		}
	}
	return outData, outMime, outName, nil
}

func ffmpegArgs(inPath, outPath, format string) []string {
	args := []string{"-y", "-hide_banner", "-loglevel", "error", "-i", inPath}
	switch format {
	case "mp3":
		args = append(args, "-vn", "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "128k")
	case "m4a", "aac":
		args = append(args, "-vn", "-c:a", "aac", "-b:a", "128k")
	case "ogg":
		args = append(args, "-vn", "-c:a", "libvorbis", "-q:a", "4")
	case "opus":
		args = append(args, "-vn", "-c:a", "libopus", "-b:a", "96k")
	case "wav":
		args = append(args, "-vn", "-ar", "44100", "-ac", "2")
	case "mp4":
		args = append(args, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart")
	case "webm":
		args = append(args, "-c:v", "libvpx-vp9", "-crf", "33", "-b:v", "0", "-c:a", "libopus", "-b:a", "96k")
	case "gif":
		args = append(args, "-vf", "fps=12,scale=480:-1:flags=lanczos")
	}
	args = append(args, outPath)
	return args
}
