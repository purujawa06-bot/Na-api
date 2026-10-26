package deepseek

import (
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/purujawa06-bot/na-api/backend/internal/webclient"
)

// fakeDeepSeek is a minimal chat.deepseek.com stand-in for the tests.
type fakeDeepSeek struct {
	server           *httptest.Server
	challengeCalls   atomic.Int32
	completionCalls  atomic.Int32
	completionBodies []completionPayload
	completionPow    []string
	uploadCalls      atomic.Int32
	uploadFileName   string
	uploadModelType  string
	uploadFileSize   string
	completionScript []string
}

// powChallengeHex builds a solvable challenge for the given prefix and nonce.
func powChallengeHex(salt string, expireAt, nonce int64) string {
	digest := deepSeekHashV1([]byte(fmt.Sprintf("%s_%d_%d", salt, expireAt, nonce)))
	return hex.EncodeToString(digest[:])
}

// newFakeDeepSeek starts the fake upstream and returns a client pointed at it.
func newFakeDeepSeek(t *testing.T, completionScript []string) (*fakeDeepSeek, *client) {
	t.Helper()
	const salt = "test-salt"
	expireAt := time.Now().Add(5 * time.Minute).UnixMilli()
	fake := &fakeDeepSeek{completionScript: completionScript}

	mux := http.NewServeMux()
	mux.HandleFunc(powChallengePath, func(w http.ResponseWriter, r *http.Request) {
		fake.challengeCalls.Add(1)
		var body struct {
			TargetPath string `json:"target_path"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		writeJSON(w, map[string]any{
			"code": 0,
			"data": map[string]any{
				"biz_code": 0,
				"biz_data": map[string]any{
					"challenge": map[string]any{
						"algorithm":   "DeepSeekHashV1",
						"challenge":   powChallengeHex(salt, expireAt, 3),
						"salt":        salt,
						"difficulty":  10,
						"expire_at":   expireAt,
						"target_path": body.TargetPath,
						"signature":   "sig",
					},
				},
			},
		})
	})
	mux.HandleFunc(powCompletionPath, func(w http.ResponseWriter, r *http.Request) {
		call := fake.completionCalls.Add(1)
		fake.completionPow = append(fake.completionPow, r.Header.Get("x-ds-pow-response"))
		var payload completionPayload
		_ = json.NewDecoder(r.Body).Decode(&payload)
		fake.completionBodies = append(fake.completionBodies, payload)

		if int(call) <= len(fake.completionScript) {
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprint(w, fake.completionScript[call-1])
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		if payload.ThinkingEnabled {
			fmt.Fprint(w, `data: {"v":{"response":{"message_id":42,"fragments":[{"type":"THINK","content":"hmm"}]}}}`+"\n\n")
		}
		fmt.Fprint(w, `data: {"v":{"response":{"message_id":42,"fragments":[{"type":"RESPONSE","content":"Halo"}]}}}`+"\n\n")
		fmt.Fprint(w, `data: {"p":"response/fragments/-1/content","o":"APPEND","v":" dunia"}`+"\n\n")
		fmt.Fprint(w, "data: {\"v\":\"!\"}\n\n")
	})
	mux.HandleFunc(createSessionPath, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, map[string]any{
			"code": 0,
			"data": map[string]any{
				"biz_code": 0,
				"biz_data": map[string]any{"chat_session": map[string]any{"id": "session-1"}},
			},
		})
	})
	mux.HandleFunc(powUploadPath, func(w http.ResponseWriter, r *http.Request) {
		fake.uploadCalls.Add(1)
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			http.Error(w, "bad multipart", http.StatusBadRequest)
			return
		}
		if _, header, err := r.FormFile("file"); err == nil {
			fake.uploadFileName = header.Filename
		}
		fake.uploadModelType = r.Header.Get("x-model-type")
		fake.uploadFileSize = r.Header.Get("x-file-size")
		writeJSON(w, map[string]any{
			"code": 0,
			"data": map[string]any{
				"biz_code": 0,
				"biz_data": map[string]any{"id": "file-9", "status": "SUCCESS"},
			},
		})
	})

	fake.server = httptest.NewServer(mux)
	t.Cleanup(fake.server.Close)

	client := newClient()
	client.baseURL = fake.server.URL
	return fake, client
}

// writeJSON writes a JSON response in tests.
func writeJSON(w http.ResponseWriter, payload any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(payload)
}

// TestStreamTurnEmitsFragments checks the SSE parser, the payload shape, and
// the solved PoW header.
func TestStreamTurnEmitsFragments(t *testing.T) {
	fake, client := newFakeDeepSeek(t, nil)
	meta := &turnMeta{}
	var kinds []deltaKind
	var texts []string

	err := client.streamTurn(context.Background(), completionOptions{
		Token:           "token-1",
		ChatID:          "session-1",
		ModelType:       "default",
		Prompt:          "Apa itu Go?",
		ThinkingEnabled: true,
		SearchEnabled:   true,
	}, meta, func(part delta) error {
		kinds = append(kinds, part.Kind)
		texts = append(texts, part.Text)
		return nil
	})
	if err != nil {
		t.Fatalf("streamTurn returned error: %v", err)
	}

	wantKinds := []deltaKind{deltaReasoning, deltaContent, deltaContent, deltaContent}
	wantTexts := []string{"hmm", "Halo", " dunia", "!"}
	if fmt.Sprint(kinds) != fmt.Sprint(wantKinds) || fmt.Sprint(texts) != fmt.Sprint(wantTexts) {
		t.Fatalf("deltas = %v %v, want %v %v", kinds, texts, wantKinds, wantTexts)
	}
	if meta.MessageID != float64(42) {
		t.Fatalf("meta.MessageID = %v, want 42", meta.MessageID)
	}

	payload := fake.completionBodies[0]
	if payload.ParentMessageID != nil || payload.Action != nil {
		t.Fatalf("expected null parent_message_id/action, got %v/%v", payload.ParentMessageID, payload.Action)
	}
	if payload.ModelType != "default" || payload.Prompt != "Apa itu Go?" || payload.SearchEnabled != true {
		t.Fatalf("unexpected payload: %+v", payload)
	}
	if payload.RefFileIDs == nil || len(payload.RefFileIDs) != 0 {
		t.Fatalf("ref_file_ids must be an empty array, got %v", payload.RefFileIDs)
	}

	raw, err := base64.StdEncoding.DecodeString(fake.completionPow[0])
	if err != nil {
		t.Fatalf("pow header is not base64: %v", err)
	}
	var pow struct {
		Algorithm  string `json:"algorithm"`
		Answer     int64  `json:"answer"`
		Signature  string `json:"signature"`
		TargetPath string `json:"target_path"`
	}
	if err := json.Unmarshal(raw, &pow); err != nil {
		t.Fatalf("pow header is not JSON: %v", err)
	}
	if pow.Answer != 3 || pow.TargetPath != powCompletionPath || pow.Algorithm != "DeepSeekHashV1" || pow.Signature != "sig" {
		t.Fatalf("unexpected pow header: %+v", pow)
	}
	if fake.challengeCalls.Load() != 1 {
		t.Fatalf("challenge calls = %d, want 1 (cache reuse)", fake.challengeCalls.Load())
	}
}

// TestStreamTurnResolvesPowOnce checks the 40301 retry path.
func TestStreamTurnResolvesPowOnce(t *testing.T) {
	fake, client := newFakeDeepSeek(t, []string{`{"code":40301,"msg":"INVALID_POW_RESPONSE"}`})
	err := client.streamTurn(context.Background(), completionOptions{
		Token:  "token-1",
		ChatID: "session-1",
		Prompt: "hi",
	}, &turnMeta{}, func(delta) error { return nil })
	if err != nil {
		t.Fatalf("streamTurn returned error: %v", err)
	}
	if fake.completionCalls.Load() != 2 {
		t.Fatalf("completion calls = %d, want 2", fake.completionCalls.Load())
	}
	if fake.challengeCalls.Load() != 2 {
		t.Fatalf("challenge calls = %d, want 2 (cache dropped)", fake.challengeCalls.Load())
	}
}

// TestStreamTurnMapsBizError checks that a non-retryable biz error surfaces.
func TestStreamTurnMapsBizError(t *testing.T) {
	_, client := newFakeDeepSeek(t, []string{`{"code":40003,"msg":"bad thing"}`})
	err := client.streamTurn(context.Background(), completionOptions{
		Token:  "token-1",
		ChatID: "session-1",
		Prompt: "hi",
	}, &turnMeta{}, func(delta) error { return nil })
	if err == nil || err.Error() != "completion gagal (biz 40003): bad thing" {
		t.Fatalf("unexpected error: %v", err)
	}
}

// TestUploadFileSendsVisionHeaders checks the multipart upload contract.
func TestUploadFileSendsVisionHeaders(t *testing.T) {
	fake, client := newFakeDeepSeek(t, nil)
	uploaded, err := client.uploadFile(context.Background(), "token-1", []byte("image-bytes"), "photo.png", "image/png")
	if err != nil {
		t.Fatalf("uploadFile returned error: %v", err)
	}
	if uploaded.ID != "file-9" {
		t.Fatalf("uploaded id = %q, want file-9", uploaded.ID)
	}
	if fake.uploadFileName != "photo.png" || fake.uploadModelType != "vision" || fake.uploadFileSize != "11" {
		t.Fatalf("unexpected upload headers: name=%q model=%q size=%q",
			fake.uploadFileName, fake.uploadModelType, fake.uploadFileSize)
	}
}

// TestCreateSessionReadsNestedID checks the session envelope parsing.
func TestCreateSessionReadsNestedID(t *testing.T) {
	_, client := newFakeDeepSeek(t, nil)
	sessionID, err := client.createSession(context.Background(), "token-1")
	if err != nil {
		t.Fatalf("createSession returned error: %v", err)
	}
	if sessionID != "session-1" {
		t.Fatalf("session id = %q, want session-1", sessionID)
	}
}

// TestDownloadImageRejectsHTTPError checks the 400 mapping for image failures.
func TestDownloadImageRejectsHTTPError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	_, _, err := downloadImage(context.Background(), server.URL+"/missing.png")
	var callerErr *apiError
	if err == nil || !errors.As(err, &callerErr) {
		t.Fatalf("expected apiError, got %v", err)
	}
}

// TestImageFilename keeps the extension behaviour of the JS client.
func TestImageFilename(t *testing.T) {
	cases := []struct {
		url         string
		contentType string
		want        string
	}{
		{"https://example.com/pic.jpg", "image/jpeg", "pic.jpg"},
		{"https://example.com/image/png", "image/png", "image.png"},
		{"https://example.com/a", "image/webp", "image.webp"},
		{"https://example.com/pic.png?v=2", "image/png", "pic.png"},
		{"https://example.com/", "image/gif", "image.gif"},
	}
	for _, testCase := range cases {
		if got := imageFilename(testCase.url, testCase.contentType); got != testCase.want {
			t.Fatalf("imageFilename(%q) = %q, want %q", testCase.url, got, testCase.want)
		}
	}
}

// TestUserAgentMatchesJS guards the browser UA the upstream expects.
func TestUserAgentMatchesJS(t *testing.T) {
	if webclient.UserAgentChrome != "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36" {
		t.Fatalf("unexpected Chrome UA: %s", webclient.UserAgentChrome)
	}
}
