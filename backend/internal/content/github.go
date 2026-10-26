package content

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
	"github.com/purujawa06-bot/na-api/backend/internal/webclient"
)

const (
	githubRepo        = "purujawa06-bot/pageku"
	githubContentsAPI = "https://api.github.com/repos/" + githubRepo + "/contents/"
	githubRawBase     = "https://raw.githubusercontent.com/" + githubRepo + "/main/"
	githubCacheTTL    = 60 * time.Second
	catalogPageLimit  = 10
	pageDir           = "page"
	userScriptDir     = "userscripts"
)

// ghFile is the subset of a GitHub contents entry the catalogs need.
type ghFile struct {
	Name        string `json:"name"`
	Path        string `json:"path"`
	Type        string `json:"type"`
	DownloadURL string `json:"download_url"`
}

// githubHeaders builds the optional authenticated header set.
func (h *handler) githubHeaders() map[string]string {
	headers := map[string]string{"Accept": "application/vnd.github+json"}
	if h == nil || h.deps == nil || h.deps.Config == nil {
		return headers
	}
	if token := h.deps.Config.GithubToken; token != "" {
		headers["Authorization"] = "token " + token
	}
	return headers
}

// fetchGitHubContents lists a repository directory, caching the result for the
// same 60 second revalidation window the JS fetch used.
func (h *handler) fetchGitHubContents(ctx context.Context, dir string) ([]ghFile, error) {
	cacheKey := "github:contents:" + dir
	if h != nil && h.deps != nil && h.deps.Cache != nil {
		if cached, ok := h.deps.Cache.Get(cacheKey); ok {
			if files, ok := cached.([]ghFile); ok {
				return files, nil
			}
		}
	}

	resp, err := webclient.Get(ctx, githubContentsAPI+dir, h.githubHeaders())
	if err != nil {
		return nil, fmt.Errorf("fetch github contents %s: %w", dir, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("github contents %s responded with HTTP %d", dir, resp.StatusCode)
	}

	var files []ghFile
	if err := webclient.DecodeJSON(resp, &files); err != nil {
		return nil, fmt.Errorf("decode github contents %s: %w", dir, err)
	}
	if h != nil && h.deps != nil && h.deps.Cache != nil {
		h.deps.Cache.Set(cacheKey, files, githubCacheTTL)
	}
	return files, nil
}

// fetchRawText downloads a raw repository file.
func fetchRawText(ctx context.Context, rawURL string) (string, error) {
	resp, err := webclient.Get(ctx, rawURL, nil)
	if err != nil {
		return "", fmt.Errorf("fetch raw file: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		_ = resp.Body.Close()
		return "", fmt.Errorf("raw file responded with HTTP %d", resp.StatusCode)
	}
	return webclient.ReadBody(resp)
}

// rawFileURL builds the raw.githubusercontent.com URL for a repository file.
func rawFileURL(dir, name string) string {
	return githubRawBase + dir + "/" + url.PathEscape(name)
}

var (
	pageNamePattern = regexp.MustCompile(`^PuruPage\[(.*?)\]\.html$`)
	pageSlugPattern = regexp.MustCompile(`PuruPage\[(.*?)\]\.html`)
	pageMetaPattern = regexp.MustCompile(`<!-- META (.*?) -->`)
)

// pageEntry is one custom page in the catalog response.
type pageEntry struct {
	Slug        string `json:"slug"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Date        string `json:"date"`
}

// pageCatalog is the GET /api/pages payload.
type pageCatalog struct {
	Pages       []pageEntry `json:"pages"`
	TotalPages  int         `json:"totalPages"`
	CurrentPage int         `json:"currentPage"`
}

// pageMetadata is the JSON document embedded in a page's META comment.
type pageMetadata struct {
	Title string `json:"title"`
	Desc  string `json:"desc"`
	Date  string `json:"date"`
}

// listPageEntries builds one page of the custom page catalog.
func (h *handler) listPageEntries(ctx context.Context, page int, search string) (pageCatalog, error) {
	empty := pageCatalog{Pages: []pageEntry{}, TotalPages: 0, CurrentPage: page}

	files, err := h.fetchGitHubContents(ctx, pageDir)
	if err != nil {
		// The JS route degrades to an empty catalog on upstream failure.
		return empty, nil
	}

	htmlFiles := make([]ghFile, 0, len(files))
	for _, file := range files {
		if pageNamePattern.MatchString(file.Name) {
			htmlFiles = append(htmlFiles, file)
		}
	}
	sort.SliceStable(htmlFiles, func(i, j int) bool {
		return htmlFiles[i].Name > htmlFiles[j].Name
	})

	start := (page - 1) * catalogPageLimit
	if start > len(htmlFiles) {
		start = len(htmlFiles)
	}
	end := start + catalogPageLimit
	if end > len(htmlFiles) {
		end = len(htmlFiles)
	}

	entries := make([]pageEntry, 0, end-start)
	for _, file := range htmlFiles[start:end] {
		content, err := fetchRawText(ctx, file.DownloadURL)
		if err != nil {
			continue
		}

		var meta pageMetadata
		if match := pageMetaPattern.FindStringSubmatch(content); match != nil {
			_ = json.Unmarshal([]byte(match[1]), &meta)
		}

		slug := file.Name
		if match := pageSlugPattern.FindStringSubmatch(file.Name); match != nil {
			slug = match[1]
		}

		if search != "" {
			needle := strings.ToLower(search)
			if !strings.Contains(strings.ToLower(meta.Title), needle) &&
				!strings.Contains(strings.ToLower(meta.Desc), needle) &&
				!strings.Contains(strings.ToLower(slug), needle) {
				continue
			}
		}

		title := meta.Title
		if title == "" {
			title = slug
		}
		date := meta.Date
		if date == "" {
			date = isoTime(time.Unix(0, 0))
		}
		entries = append(entries, pageEntry{
			Slug:        slug,
			Title:       title,
			Description: meta.Desc,
			Date:        date,
		})
	}

	totalPages := (len(htmlFiles) + catalogPageLimit - 1) / catalogPageLimit
	return pageCatalog{Pages: entries, TotalPages: totalPages, CurrentPage: page}, nil
}

// listPages handles GET /api/pages?page=&search=.
func (h *handler) listPages(w http.ResponseWriter, r *http.Request) {
	page := httpx.QueryInt(r, "page", 1, 1, 100000)
	search := httpx.QueryStr(r, "search", "")

	catalog, err := h.listPageEntries(r.Context(), page, search)
	if err != nil {
		httpx.JSON(w, http.StatusInternalServerError, map[string]any{
			"error": err.Error(),
			"pages": []pageEntry{},
		})
		return
	}
	httpx.OK(w, catalog)
}

var (
	userScriptMetaBlock = regexp.MustCompile(`(?s)// ==UserScript==(.*?)// ==/UserScript==`)
	userScriptIDPattern = regexp.MustCompile(`(?i)\.user\.js$`)
)

// userScriptEntry is one script in the catalog response.
type userScriptEntry struct {
	ID          string `json:"id"`
	File        string `json:"file"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Version     string `json:"version"`
	Author      string `json:"author"`
	Match       string `json:"match"`
	Icon        string `json:"icon"`
}

// userScriptCatalog is the GET /api/user-scripts payload.
type userScriptCatalog struct {
	Scripts     []userScriptEntry `json:"scripts"`
	TotalPages  int               `json:"totalPages"`
	CurrentPage int               `json:"currentPage"`
}

// userScriptMetadata is the subset of the ==UserScript== header we surface.
type userScriptMetadata struct {
	Name        string
	Description string
	Version     string
	Author      string
	Match       string
	Icon        string
}

// metaValue extracts "// @label value" from a UserScript metadata block.
func metaValue(block, label string) string {
	pattern := regexp.MustCompile(`(?m)//\s*@` + regexp.QuoteMeta(label) + `[ \t]+(.+)$`)
	match := pattern.FindStringSubmatch(block)
	if match == nil {
		return ""
	}
	return strings.TrimSpace(match[1])
}

// parseUserScriptMeta parses the ==UserScript== header, with the same defaults
// as lib/userscripts-github.js.
func parseUserScriptMeta(content string) userScriptMetadata {
	match := userScriptMetaBlock.FindStringSubmatch(content)
	if match == nil {
		return userScriptMetadata{Name: "Untitled", Version: "0.0.0", Author: "-"}
	}
	block := match[1]

	meta := userScriptMetadata{
		Name:        metaValue(block, "name"),
		Description: metaValue(block, "description"),
		Version:     metaValue(block, "version"),
		Author:      metaValue(block, "author"),
		Match:       metaValue(block, "match"),
		Icon:        metaValue(block, "icon"),
	}
	if meta.Name == "" {
		meta.Name = "Untitled"
	}
	if meta.Version == "" {
		meta.Version = "0.0.0"
	}
	if meta.Author == "" {
		meta.Author = "-"
	}
	return meta
}

// listUserScriptEntries builds one page of the userScript catalog.
func (h *handler) listUserScriptEntries(ctx context.Context, page int, search string) (userScriptCatalog, error) {
	empty := userScriptCatalog{Scripts: []userScriptEntry{}, TotalPages: 0, CurrentPage: page}

	files, err := h.fetchGitHubContents(ctx, userScriptDir)
	if err != nil {
		return empty, nil
	}

	scriptFiles := make([]ghFile, 0, len(files))
	for _, file := range files {
		if strings.HasSuffix(file.Name, ".user.js") {
			scriptFiles = append(scriptFiles, file)
		}
	}
	sort.SliceStable(scriptFiles, func(i, j int) bool {
		return scriptFiles[i].Name > scriptFiles[j].Name
	})
	if len(scriptFiles) == 0 {
		return empty, nil
	}

	start := (page - 1) * catalogPageLimit
	if start > len(scriptFiles) {
		start = len(scriptFiles)
	}
	end := start + catalogPageLimit
	if end > len(scriptFiles) {
		end = len(scriptFiles)
	}

	entries := make([]userScriptEntry, 0, end-start)
	for _, file := range scriptFiles[start:end] {
		content, err := fetchRawText(ctx, rawFileURL(userScriptDir, file.Name))
		if err != nil {
			continue
		}
		meta := parseUserScriptMeta(content)
		id := userScriptIDPattern.ReplaceAllString(file.Name, "")

		if search != "" {
			haystack := strings.ToLower(meta.Name + " " + meta.Description + " " + id)
			if !strings.Contains(haystack, strings.ToLower(search)) {
				continue
			}
		}

		entries = append(entries, userScriptEntry{
			ID:          id,
			File:        file.Name,
			Name:        meta.Name,
			Description: meta.Description,
			Version:     meta.Version,
			Author:      meta.Author,
			Match:       meta.Match,
			Icon:        meta.Icon,
		})
	}

	totalPages := (len(scriptFiles) + catalogPageLimit - 1) / catalogPageLimit
	return userScriptCatalog{Scripts: entries, TotalPages: totalPages, CurrentPage: page}, nil
}

// listUserScripts handles GET /api/user-scripts?page=&search=.
func (h *handler) listUserScripts(w http.ResponseWriter, r *http.Request) {
	page := httpx.QueryInt(r, "page", 1, 1, 100000)
	search := httpx.QueryStr(r, "search", "")

	catalog, err := h.listUserScriptEntries(r.Context(), page, search)
	if err != nil {
		httpx.JSON(w, http.StatusInternalServerError, map[string]any{
			"error":   err.Error(),
			"scripts": []userScriptEntry{},
		})
		return
	}
	httpx.OK(w, catalog)
}

var userScriptUpdateURL = regexp.MustCompile(`(?i)//\s*@(downloadURL|updateURL)\s+\S+`)

// serveUserScript handles GET /api/user-scripts/{id} (and /userscripts/{id}):
// it serves the raw script with its download/update URLs rewritten to this
// backend so installed copies keep updating themselves.
func (h *handler) serveUserScript(w http.ResponseWriter, r *http.Request) {
	id := userScriptIDPattern.ReplaceAllString(r.PathValue("id"), "")
	if id == "" {
		httpx.JSON(w, http.StatusNotFound, map[string]any{
			"success": false,
			"error":   "UserScript tidak ditemukan.",
		})
		return
	}

	file := id + ".user.js"
	content, err := fetchRawText(r.Context(), rawFileURL(userScriptDir, file))
	if err != nil {
		httpx.JSON(w, http.StatusNotFound, map[string]any{
			"success": false,
			"error":   "UserScript tidak ditemukan.",
		})
		return
	}

	origin := requestOrigin(r)
	scriptURL := origin + r.URL.Path
	body := userScriptUpdateURL.ReplaceAllString(content, "")
	replacement := fmt.Sprintf(
		"// @downloadURL  %s\n// @updateURL    %s\n// ==/UserScript==",
		scriptURL, scriptURL)
	body = replaceFirstUserScriptEnd(body, replacement)

	w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=300")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(body))
}

var userScriptEndMarker = regexp.MustCompile(`//\s*==/UserScript==`)

// replaceFirstUserScriptEnd swaps the first closing marker with replacement.
func replaceFirstUserScriptEnd(body, replacement string) string {
	location := userScriptEndMarker.FindStringIndex(body)
	if location == nil {
		return body
	}
	return body[:location[0]] + replacement + body[location[1]:]
}

// requestOrigin reconstructs the public origin from proxy headers.
func requestOrigin(r *http.Request) string {
	scheme := "https"
	if forwarded := r.Header.Get("X-Forwarded-Proto"); forwarded != "" {
		scheme = forwarded
	} else if r.TLS == nil && httpx.IsLocalHost(hostOnly(r.Host)) {
		scheme = "http"
	}
	return scheme + "://" + r.Host
}

// hostOnly strips the port from a host header.
func hostOnly(host string) string {
	if name, _, err := net.SplitHostPort(host); err == nil {
		return name
	}
	return host
}
