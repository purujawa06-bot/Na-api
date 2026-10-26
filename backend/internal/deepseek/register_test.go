package deepseek

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// newTestService wires a service whose client points at the fake upstream.
func newTestService(t *testing.T, completionScript []string) (*fakeDeepSeek, *http.ServeMux) {
	t.Helper()
	fake, deepSeekClient := newFakeDeepSeek(t, completionScript)
	handler := &service{client: deepSeekClient}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/deepseek/instant", handler.handleInstant)
	mux.HandleFunc("POST /api/deepseek/reasoning", handler.handleReasoning)
	mux.HandleFunc("POST /api/deepseek/vision", handler.handleVision)
	return fake, mux
}

// postJSONTo runs a POST against the test mux.
func postJSONTo(mux *http.ServeMux, path, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	mux.ServeHTTP(recorder, request)
	return recorder
}

// errorEnvelope decodes the JS error body.
type errorEnvelope struct {
	Success bool   `json:"success"`
	Error   string `json:"error"`
}

// TestInstantValidation checks the exact Indonesian validation messages.
func TestInstantValidation(t *testing.T) {
	cases := []struct {
		name string
		body string
		code int
		want string
	}{
		{"invalid json", "{", http.StatusBadRequest, "Body JSON tidak valid"},
		{"missing userID", `{"prompt":"halo"}`, http.StatusBadRequest, "Parameter userID wajib diisi"},
		{"missing prompt", `{"userID":"t"}`, http.StatusBadRequest, "Parameter prompt wajib diisi"},
		{"bad stream string", `{"userID":"t","prompt":"x","stream":"yes"}`, http.StatusBadRequest,
			"Parameter stream harus bernilai boolean (true/false)"},
		{"bad stream number", `{"userID":"t","prompt":"x","stream":1}`, http.StatusBadRequest,
			"Parameter stream harus bernilai boolean (true/false)"},
		{"bad stream null", `{"userID":"t","prompt":"x","stream":null}`, http.StatusBadRequest,
			"Parameter stream harus bernilai boolean (true/false)"},
		{"chatID without parentID", `{"userID":"t","prompt":"x","chatID":"c1"}`, http.StatusBadRequest,
			"Untuk melanjutkan chat, kirim chatID + parentID (message_id jawaban terakhir dari respons sebelumnya)"},
	}
	_, mux := newTestService(t, nil)
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			recorder := postJSONTo(mux, "/api/deepseek/instant", testCase.body)
			if recorder.Code != testCase.code {
				t.Fatalf("status = %d, want %d (body %s)", recorder.Code, testCase.code, recorder.Body)
			}
			var envelope errorEnvelope
			if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
				t.Fatalf("decode body: %v (%s)", err, recorder.Body)
			}
			if envelope.Success || envelope.Error != testCase.want {
				t.Fatalf("body = %+v, want error %q", envelope, testCase.want)
			}
		})
	}
}

// TestInstantJSONResponse checks the non-streaming contract, including the
// freshly created session id and the assistant message id.
func TestInstantJSONResponse(t *testing.T) {
	fake, mux := newTestService(t, nil)
	recorder := postJSONTo(mux, "/api/deepseek/instant", `{"userID":"  token-1  ","prompt":"  Apa itu Go?  "}`)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", recorder.Code, recorder.Body)
	}

	var result struct {
		Success  bool   `json:"success"`
		Source   string `json:"source"`
		ChatID   string `json:"chatID"`
		ParentID any    `json:"parentID"`
		Content  string `json:"content"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if !result.Success || result.Source != "deepseek-web" || result.ChatID != "session-1" {
		t.Fatalf("unexpected result: %+v", result)
	}
	if result.ParentID != float64(42) {
		t.Fatalf("parentID = %v, want 42", result.ParentID)
	}
	if result.Content != "Halo dunia!" {
		t.Fatalf("content = %q, want %q", result.Content, "Halo dunia!")
	}
	if strings.Contains(recorder.Body.String(), "reasoning") {
		t.Fatalf("instant response must not include reasoning: %s", recorder.Body)
	}

	payload := fake.completionBodies[0]
	// The JS client disables search on the non-streaming path, so the port does too.
	if payload.Prompt != "Apa itu Go?" || payload.SearchEnabled || payload.ThinkingEnabled {
		t.Fatalf("unexpected payload: %+v", payload)
	}
	if payload.ChatSessionID != "session-1" || payload.ModelType != "default" {
		t.Fatalf("unexpected payload: %+v", payload)
	}
}

// TestInstantStreamResponse checks the SSE event sequence.
func TestInstantStreamResponse(t *testing.T) {
	_, mux := newTestService(t, nil)
	recorder := postJSONTo(mux, "/api/deepseek/instant", `{"userID":"t","prompt":"hi","stream":true}`)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", recorder.Code, recorder.Body)
	}
	if contentType := recorder.Header().Get("Content-Type"); !strings.HasPrefix(contentType, "text/event-stream") {
		t.Fatalf("content type = %q", contentType)
	}

	body := recorder.Body.String()
	wantEvents := []string{
		`data: {"type":"meta","chatID":"session-1","model":"deepseek-chat"}`,
		`data: {"type":"content","text":"Halo"}`,
		`data: {"type":"done","chatID":"session-1","parentID":42}`,
		"data: [DONE]",
	}
	for _, event := range wantEvents {
		if !strings.Contains(body, event) {
			t.Fatalf("stream is missing %q\n%s", event, body)
		}
	}
	if strings.Index(body, wantEvents[0]) > strings.Index(body, wantEvents[len(wantEvents)-1]) {
		t.Fatalf("events are out of order: %s", body)
	}
}

// TestReasoningPreset checks the thinking/model/search options of that route.
func TestReasoningPreset(t *testing.T) {
	fake, mux := newTestService(t, nil)
	recorder := postJSONTo(mux, "/api/deepseek/reasoning", `{"userID":"t","prompt":"hitung","chatID":"c1","parentID":7,"stream":true}`)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", recorder.Code, recorder.Body)
	}
	streamBody := recorder.Body.String()
	for _, event := range []string{
		`data: {"type":"meta","chatID":"c1","model":"deepseek-reasoner"}`,
		`data: {"type":"reasoning","text":"hmm"}`,
	} {
		if !strings.Contains(streamBody, event) {
			t.Fatalf("stream is missing %q\n%s", event, streamBody)
		}
	}
	payload := fake.completionBodies[0]
	if payload.ModelType != "expert" || !payload.ThinkingEnabled || payload.SearchEnabled {
		t.Fatalf("unexpected payload: %+v", payload)
	}
	if payload.ChatSessionID != "c1" || payload.ParentMessageID != float64(7) {
		t.Fatalf("continuation payload is wrong: %+v", payload)
	}
}

// TestVisionRequiresImage mirrors the route's early image check.
func TestVisionRequiresImage(t *testing.T) {
	_, mux := newTestService(t, nil)
	recorder := postJSONTo(mux, "/api/deepseek/vision", `{"userID":"t","prompt":"apa ini?"}`)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body %s", recorder.Code, recorder.Body)
	}
	var envelope errorEnvelope
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if envelope.Error != "Parameter image wajib diisi" {
		t.Fatalf("error = %q", envelope.Error)
	}
}

// TestVisionUploadsAndChats checks the full upload-then-chat flow.
func TestVisionUploadsAndChats(t *testing.T) {
	imageServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "image/jpeg; charset=binary")
		_, _ = w.Write(bytes.Repeat([]byte{0xFF}, 16))
	}))
	defer imageServer.Close()

	fake, mux := newTestService(t, nil)
	body, err := json.Marshal(map[string]any{
		"userID":   "t",
		"prompt":   "apa isi gambar?",
		"image":    imageServer.URL + "/photo",
		"thinking": "true",
	})
	if err != nil {
		t.Fatalf("encode body: %v", err)
	}

	recorder := postJSONTo(mux, "/api/deepseek/vision", string(body))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", recorder.Code, recorder.Body)
	}

	var result struct {
		Source string `json:"source"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if result.Source != "deepseek-web-vision" {
		t.Fatalf("source = %q", result.Source)
	}
	if fake.uploadFileName != "image.jpg" {
		t.Fatalf("upload filename = %q, want image.jpg", fake.uploadFileName)
	}
	payload := fake.completionBodies[0]
	if len(payload.RefFileIDs) != 1 || payload.RefFileIDs[0] != "file-9" {
		t.Fatalf("ref_file_ids = %v", payload.RefFileIDs)
	}
	if payload.ModelType != "vision" || !payload.ThinkingEnabled {
		t.Fatalf("unexpected payload: %+v", payload)
	}
}

// TestUpstreamFailureMapsTo502 checks the 400/502 split.
func TestUpstreamFailureMapsTo502(t *testing.T) {
	handler := &service{client: newClient()}
	handler.client.baseURL = "http://127.0.0.1:1"

	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/deepseek/instant", handler.handleInstant)
	recorder := postJSONTo(mux, "/api/deepseek/instant", `{"userID":"t","prompt":"hi","chatID":"c1","parentID":1}`)
	if recorder.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, body %s", recorder.Code, recorder.Body)
	}
	var envelope errorEnvelope
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if envelope.Success || !strings.Contains(envelope.Error, "pow challenge gagal") {
		t.Fatalf("unexpected error envelope: %+v", envelope)
	}
}

// TestStreamCoercionAcceptsStrings checks the accepted stream spellings.
func TestStreamCoercionAcceptsStrings(t *testing.T) {
	cases := map[string]bool{
		`true`:     true,
		`"true"`:   true,
		`" TRUE "`: true,
		`false`:    false,
		`"false"`:  false,
		`"False "`: false,
		`1`:        false, // rejected, verified via the error flag below
	}
	for raw, want := range cases {
		body := map[string]json.RawMessage{"stream": json.RawMessage(raw)}
		w := httptest.NewRecorder()
		got, ok := parseStreamFlag(w, body)
		if raw == "1" {
			if ok {
				t.Fatalf("stream=1 should be rejected")
			}
			continue
		}
		if !ok || got != want {
			t.Fatalf("stream=%s -> (%v,%v), want (%v,true)", raw, got, ok, want)
		}
	}
}

// TestIsTruthy pins the JS truthiness table used for prompt/parentID.
func TestIsTruthy(t *testing.T) {
	cases := []struct {
		value any
		want  bool
	}{
		{nil, false},
		{"", false},
		{"x", true},
		{float64(0), false},
		{float64(2), true},
		{true, true},
		{false, false},
		{[]any{}, true},
	}
	for _, testCase := range cases {
		if got := isTruthy(testCase.value); got != testCase.want {
			t.Fatalf("isTruthy(%v) = %v, want %v", testCase.value, got, testCase.want)
		}
	}
}
