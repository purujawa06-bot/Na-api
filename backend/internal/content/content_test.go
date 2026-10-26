package content

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/purujawa06-bot/na-api/backend/internal/app"
)

func TestHelpers(t *testing.T) {
	excerpt := createExcerpt("# Hello **World** and `code`\n\n![img](x) [link](y) _em_", 120)
	if excerpt != "Hello World and code   link em" {
		t.Fatalf("excerpt = %q", excerpt)
	}
	if got := extractBlogTitle("intro\n#  My Title \nbody"); got != "My Title" {
		t.Fatalf("title = %q", got)
	}
	if got := isoTime(time.Unix(0, 0)); got != "1970-01-01T00:00:00.000Z" {
		t.Fatalf("isoTime = %q", got)
	}
	id, err := newUUID()
	if err != nil || !validUUID(id) {
		t.Fatalf("uuid = %q err=%v", id, err)
	}
	if validUUID("nope") {
		t.Fatal("validUUID accepted invalid input")
	}
	if got := chatSignature("dev", "123"); got != "921e13f77d88da83a873f49d1fe7329b06b96ebbcd146f0c065aca8f0dbf029e" {
		t.Fatalf("chatSignature = %s", got)
	}
}

func TestParseUserScriptMeta(t *testing.T) {
	content := "// ==UserScript==\n// @name Demo\n// @description Desc\n// @version 1.2.3\n// @author Me\n// @match https://x/*\n// ==/UserScript==\nbody"
	meta := parseUserScriptMeta(content)
	if meta.Name != "Demo" || meta.Version != "1.2.3" || meta.Author != "Me" || meta.Description != "Desc" {
		t.Fatalf("meta = %+v", meta)
	}
	fallback := parseUserScriptMeta("plain")
	if fallback.Name != "Untitled" || fallback.Version != "0.0.0" || fallback.Author != "-" {
		t.Fatalf("fallback = %+v", fallback)
	}
}

func TestHandlersWithoutDatabase(t *testing.T) {
	h := &handler{deps: &app.Deps{}}

	rec := httptest.NewRecorder()
	h.listBlogs(rec, httptest.NewRequest(http.MethodGet, "/api/blogs?page=2", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("blogs status = %d", rec.Code)
	}
	var page blogPage
	if err := json.Unmarshal(rec.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Posts) != 0 || page.TotalPosts != 0 || page.TotalPages != 1 || page.CurrentPage != 1 {
		t.Fatalf("blogs page = %+v", page)
	}

	rec = httptest.NewRecorder()
	h.postChat(rec, httptest.NewRequest(http.MethodPost, "/api/chat", nil))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("chat status = %d", rec.Code)
	}

	rec = httptest.NewRecorder()
	h.getTemp(rec, reqWithPath("/api/temp/not-a-uuid", "id", "not-a-uuid"))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("temp status = %d", rec.Code)
	}

	rec = httptest.NewRecorder()
	h.getAutoChain(rec, httptest.NewRequest(http.MethodGet, "/api/admin/aichain", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("aichain status = %d", rec.Code)
	}

	rec = httptest.NewRecorder()
	h.adminLogin(rec, httptest.NewRequest(http.MethodPost, "/api/admin/login",
		strings.NewReader(`{"password":"wrong"}`)))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("login status = %d", rec.Code)
	}
}

// reqWithPath builds a request whose PathValue resolves as Go 1.22 mux would.
func reqWithPath(target, key, value string) *http.Request {
	req := httptest.NewRequest(http.MethodGet, target, nil)
	req.SetPathValue(key, value)
	return req
}
