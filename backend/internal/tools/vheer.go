package tools

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
	"github.com/purujawa06-bot/na-api/backend/internal/webclient"
)

const (
	vheerBase = "https://vheer.com/app/api/vheer"
	vheerUA   = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36"

	vheerModerationURL = "https://vheer.com/app/api/creem/moderation/prompt"

	// These PBKDF2 parameters are copied from the Vheer frontend bundle.
	vheerPassword   = "vH33r_2025_AES_GCM_S3cur3_K3y_9X7mP4qR8nT2wE5yU1oI6aS3dF7gH0jK9lZ"
	vheerSalt       = "vheer-salt-2024"
	vheerIterations = 10000
	vheerKeyLength  = 32
	vheerIVLength   = 12
)

// vheerImageSizes lists the aspect ratios accepted by the route.
var vheerImageSizes = []string{"1:1", "16:9", "9:16", "auto"}

var (
	vheerKeyOnce  sync.Once
	vheerKeyBytes []byte
)

// vheerKey derives (once) the AES key used for the client payload envelope.
func vheerKey() []byte {
	vheerKeyOnce.Do(func() {
		vheerKeyBytes = pbkdf2SHA256([]byte(vheerPassword), []byte(vheerSalt), vheerIterations, vheerKeyLength)
	})
	return vheerKeyBytes
}

// pbkdf2SHA256 implements PBKDF2 with HMAC-SHA256 using the standard library.
func pbkdf2SHA256(password, salt []byte, iterations, keyLength int) []byte {
	prf := hmac.New(sha256.New, password)
	hashLength := prf.Size()
	blocks := (keyLength + hashLength - 1) / hashLength
	derived := make([]byte, 0, blocks*hashLength)

	for block := 1; block <= blocks; block++ {
		prf.Reset()
		prf.Write(salt)
		var counter [4]byte
		binary.BigEndian.PutUint32(counter[:], uint32(block))
		prf.Write(counter[:])
		previous := prf.Sum(nil)

		accumulator := make([]byte, len(previous))
		copy(accumulator, previous)
		for round := 1; round < iterations; round++ {
			prf.Reset()
			prf.Write(previous)
			previous = prf.Sum(nil)
			for index := range accumulator {
				accumulator[index] ^= previous[index]
			}
		}
		derived = append(derived, accumulator...)
	}
	return derived[:keyLength]
}

// vheerCipher returns the AES-GCM AEAD bound to the derived key.
func vheerCipher() (cipher.AEAD, error) {
	block, err := aes.NewCipher(vheerKey())
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// encryptVheerPayload serialises and encrypts a payload (IV prepended, base64).
func encryptVheerPayload(payload map[string]any) (string, error) {
	aead, err := vheerCipher()
	if err != nil {
		return "", err
	}
	plaintext, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	iv := make([]byte, vheerIVLength)
	if _, err := rand.Read(iv); err != nil {
		return "", err
	}
	sealed := aead.Seal(nil, iv, plaintext, nil)
	envelope := make([]byte, 0, len(iv)+len(sealed))
	envelope = append(envelope, iv...)
	envelope = append(envelope, sealed...)
	return base64.StdEncoding.EncodeToString(envelope), nil
}

// decryptVheerPayload reverses encryptVheerPayload.
func decryptVheerPayload(encoded string) (map[string]any, error) {
	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, fmt.Errorf("payload vheer tidak valid: %w", err)
	}
	if len(raw) < vheerIVLength {
		return nil, fmt.Errorf("payload vheer terlalu pendek")
	}
	aead, err := vheerCipher()
	if err != nil {
		return nil, err
	}
	plaintext, err := aead.Open(nil, raw[:vheerIVLength], raw[vheerIVLength:], nil)
	if err != nil {
		return nil, fmt.Errorf("gagal dekripsi payload vheer: %w", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(plaintext, &decoded); err != nil {
		return nil, err
	}
	return decoded, nil
}

// vheerModeration is the prompt-moderation verdict.
type vheerModeration struct {
	Decision string `json:"decision"`
	Message  string `json:"message"`
	Token    string `json:"token"`
}

// moderateVheerPrompt asks Vheer whether the prompt is allowed. Failures are
// treated as "allow" to match the original client behaviour.
func moderateVheerPrompt(ctx context.Context, prompt string) vheerModeration {
	resp, err := webclient.PostJSON(ctx, vheerModerationURL,
		map[string]any{"prompt": prompt, "type": 1},
		map[string]string{"user-agent": vheerUA})
	if err != nil {
		return vheerModeration{Decision: "allow"}
	}
	defer resp.Body.Close()
	var verdict vheerModeration
	if err := json.NewDecoder(io.LimitReader(resp.Body, webclient.MaxBodyBytes)).Decode(&verdict); err != nil || verdict.Decision == "" {
		return vheerModeration{Decision: "allow"}
	}
	return verdict
}

// vheerUpload submits a generation payload and returns the decrypted response.
func vheerUpload(ctx context.Context, payload map[string]any) (map[string]any, error) {
	params, err := encryptVheerPayload(payload)
	if err != nil {
		return nil, err
	}
	resp, err := postMultipart(ctx, vheerBase+"/upload",
		[][2]string{{"params", params}}, nil,
		map[string]string{"user-agent": vheerUA})
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var envelope struct {
		Code    int    `json:"code"`
		Msg     string `json:"msg"`
		DataEnc string `json:"data_enc"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, webclient.MaxBodyBytes)).Decode(&envelope); err != nil {
		return nil, err
	}
	if envelope.Code != http.StatusOK || envelope.DataEnc == "" {
		message := envelope.Msg
		if message == "" {
			message = "Upload gagal"
		}
		return nil, newToolsError(http.StatusBadGateway, message)
	}
	return decryptVheerPayload(envelope.DataEnc)
}

// vheerStatus is the decoded generation status response.
type vheerStatus struct {
	Status       string   `json:"status"`
	DownloadURLs []string `json:"downloadUrls"`
	Message      string   `json:"message"`
}

// vheerCheckStatus polls the generation status for a submitted payload.
func vheerCheckStatus(ctx context.Context, payload map[string]any) (vheerStatus, error) {
	params, err := encryptVheerPayload(payload)
	if err != nil {
		return vheerStatus{}, err
	}
	resp, err := webclient.PostJSON(ctx, vheerBase+"/status",
		map[string]string{"params": params},
		map[string]string{"user-agent": vheerUA})
	if err != nil {
		return vheerStatus{}, err
	}
	defer resp.Body.Close()
	var envelope struct {
		DataEnc string `json:"data_enc"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, webclient.MaxBodyBytes)).Decode(&envelope); err != nil {
		return vheerStatus{}, err
	}
	if envelope.DataEnc == "" {
		return vheerStatus{}, fmt.Errorf("Status: tidak ada data")
	}
	decoded, err := decryptVheerPayload(envelope.DataEnc)
	if err != nil {
		return vheerStatus{}, err
	}
	raw, err := json.Marshal(decoded)
	if err != nil {
		return vheerStatus{}, err
	}
	var status vheerStatus
	if err := json.Unmarshal(raw, &status); err != nil {
		return vheerStatus{}, err
	}
	return status, nil
}

// text2ImageProgress is one SSE progress event of the Vheer endpoint.
type text2ImageProgress struct {
	Event  string `json:"event"`
	TaskID any    `json:"taskId,omitempty"`
	Model  string `json:"model,omitempty"`
	Status string `json:"status,omitempty"`
}

// text2ImageDone is the terminal SSE "done" event.
type text2ImageDone struct {
	Success bool     `json:"success"`
	Source  string   `json:"source"`
	Model   string   `json:"model"`
	TaskID  any      `json:"taskId"`
	Images  []string `json:"images"`
}

// text2ImageError is the terminal SSE "error" event.
type text2ImageError struct {
	Success bool   `json:"success"`
	Error   string `json:"error"`
	Status  int    `json:"status"`
}

// textToImage handles POST /api/text2image and streams SSE events.
func (h *handlers) textToImage(w http.ResponseWriter, r *http.Request) {
	body, ok := decodeBody(w, r)
	if !ok {
		return
	}
	prompt, valid := stringValue(body, "prompt")
	if !valid || prompt == "" {
		failJSON(w, http.StatusBadRequest, "Parameter prompt wajib diisi")
		return
	}
	size := "1:1"
	if requested, exists := body["size"]; exists {
		if typed, isString := requested.(string); isString {
			size = strings.TrimSpace(typed)
		}
	}
	if !containsString(vheerImageSizes, size) {
		failJSON(w, http.StatusBadRequest, "Parameter size tidak valid. Pilihan: 1:1, 16:9, 9:16, auto")
		return
	}
	numImages := 1.0
	if raw, exists := body["num_images"]; exists {
		if parsed, isNumber := numberOf(raw); isNumber && parsed >= 1 {
			numImages = parsed
		}
	}
	if numImages > 4 {
		numImages = 4
	}

	flusher, ok := httpx.StartSSE(w)
	if !ok {
		return
	}
	ctx, cancel := h.requestContext(r)
	defer cancel()
	emit := func(event string, payload any) {
		httpx.WriteSSE(w, flusher, event, payload)
	}
	failStream := func(message string, status int) {
		emit("error", text2ImageError{Success: false, Error: message, Status: status})
	}

	emit("progress", text2ImageProgress{Event: "moderation"})
	verdict := moderateVheerPrompt(ctx, prompt)
	if verdict.Decision != "allow" {
		message := verdict.Message
		if message == "" {
			message = "Prompt ditolak oleh moderasi konten"
		}
		failStream(message, http.StatusBadRequest)
		return
	}

	uploadPayload := map[string]any{
		"prompt":           prompt,
		"positive_prompts": prompt,
		"type":             1,
		"aspect_ratio":     size,
		"selected_model":   "flux_dev",
		"model_name":       "flux_dev",
		"cost_credit":      0,
		"user_id":          "",
		"num_images":       numImages,
		"lan_code":         "en",
		"member_type":      0,
	}
	if verdict.Token != "" {
		uploadPayload["moderation_token"] = verdict.Token
	}

	emit("progress", text2ImageProgress{Event: "uploading"})
	upload, err := vheerUpload(ctx, uploadPayload)
	if err != nil {
		failStream(errorMessage(err, "Upload gagal"), errorStatus(err))
		return
	}

	model := "flux_dev"
	if value, isString := upload["model"].(string); isString && value != "" {
		model = value
	}
	taskID := upload["code"]
	emit("progress", text2ImageProgress{Event: "processing", TaskID: taskID, Model: model})

	provider := "self_hosted"
	if value, isString := upload["provider"].(string); isString && value != "" {
		provider = value
	}
	statusPayload := map[string]any{
		"type":             1,
		"code":             taskID,
		"user_id":          "",
		"cost_credit":      0,
		"num_images":       numImages,
		"third_party_type": provider,
		"model":            model,
	}

	deadline := time.Now().Add(50 * time.Second)
	for {
		if err := sleepContext(ctx, 2*time.Second); err != nil {
			if ctx.Err() != nil {
				failStream("Generasi gambar kehabisan waktu", http.StatusGatewayTimeout)
			} else {
				failStream(err.Error(), http.StatusInternalServerError)
			}
			return
		}
		status, err := vheerCheckStatus(ctx, statusPayload)
		if err != nil {
			if ctx.Err() != nil {
				failStream("Generasi gambar kehabisan waktu", http.StatusGatewayTimeout)
			} else {
				failStream(errorMessage(err, "Gagal cek status generasi"), errorStatus(err))
			}
			return
		}
		emit("progress", text2ImageProgress{Event: "poll", Status: status.Status})

		if status.Status == "success" {
			images := status.DownloadURLs
			if images == nil {
				images = []string{}
			}
			emit("done", text2ImageDone{
				Success: true,
				Source:  "vheer",
				Model:   model,
				TaskID:  taskID,
				Images:  images,
			})
			return
		}
		if status.Status == "failed" || status.Status == "error" {
			reason := status.Message
			if reason == "" {
				reason = status.Status
			}
			failStream(fmt.Sprintf("Generasi gagal: %s", reason), http.StatusBadGateway)
			return
		}
		if time.Now().After(deadline) {
			failStream("Generasi gambar kehabisan waktu", http.StatusGatewayTimeout)
			return
		}
	}
}

// containsString reports whether values contains target.
func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
