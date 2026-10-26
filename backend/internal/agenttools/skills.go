package agenttools

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
	"github.com/purujawa06-bot/na-api/backend/internal/webclient"
)

const (
	skillsAPIBase = "https://skills.sh"
	githubAPIBase = "https://api.github.com"
	rawGitHubBase = "https://raw.githubusercontent.com"
)

var (
	sourcePattern    = regexp.MustCompile(`^([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)$`)
	ownerPattern     = regexp.MustCompile(`(?i)^[a-z0-9](?:[a-z0-9-]{0,38})$`)
	controlChars     = regexp.MustCompile(`[\x00-\x1f\x7f]`)
	skillFilePattern = regexp.MustCompile(`(?i)(^|/)SKILL\.md$`)
	skillDirPattern  = regexp.MustCompile(`(?i)/SKILL\.md$`)
	frontmatter      = regexp.MustCompile(`(?s)^---\s*\r?\n(.*?)\r?\n---`)
	frontNamePattern = regexp.MustCompile(`(?m)^name[ \t]*:[ \t]*(.+?)[ \t]*$`)
	frontDescPattern = regexp.MustCompile(`(?m)^description[ \t]*:[ \t]*(.+?)[ \t]*$`)
	quoteTrimPattern = regexp.MustCompile(`^['"]|['"]$`)
)

// statusError carries an upstream HTTP status so handlers can mirror the
// original error mapping (404 stays 404, everything else becomes 502).
type statusError struct {
	Status  int
	Message string
}

func (e *statusError) Error() string { return e.Message }

type upstreamSearchSkill struct {
	ID       string `json:"id"`
	Source   string `json:"source"`
	SkillID  string `json:"skillId"`
	Name     string `json:"name"`
	Installs any    `json:"installs"`
}

type upstreamSearch struct {
	Skills []upstreamSearchSkill `json:"skills"`
}

type searchResultItem struct {
	Name           string  `json:"name"`
	Skill          string  `json:"skill"`
	Source         string  `json:"source"`
	Installs       float64 `json:"installs"`
	InstallCommand string  `json:"install_command"`
	URL            string  `json:"url"`
}

type searchResult struct {
	Source      string             `json:"source"`
	Query       string             `json:"query"`
	Limit       int                `json:"limit"`
	ResultCount int                `json:"result_count"`
	Results     []searchResultItem `json:"results"`
}

type treeEntry struct {
	Path string `json:"path"`
	Type string `json:"type"`
}

type gitTree struct {
	Tree []treeEntry `json:"tree"`
}

type repoSkill struct {
	Name        string
	Description *string
	Path        string
}

type repoSkills struct {
	Source    string
	Branch    string
	Truncated bool
	Skills    []repoSkill
}

type skillFile struct {
	Source         string
	Branch         string
	Name           string
	Description    *string
	Path           string
	SkillURL       string
	InstallCommand string
	Markdown       string
}

// skillNotFoundError mirrors the 404 branch that advertises the skills present
// in the repository.
type skillNotFoundError struct {
	Message   string
	Available []string
}

func (e *skillNotFoundError) Error() string { return e.Message }

func (s *server) githubToken() string {
	if s.deps == nil || s.deps.Config == nil {
		return ""
	}
	return s.deps.Config.GithubToken
}

// firstQueryParam returns the first present parameter among keys.
func firstQueryParam(values url.Values, keys ...string) (string, bool) {
	for _, key := range keys {
		if list, ok := values[key]; ok && len(list) > 0 {
			return list[0], true
		}
	}
	return "", false
}

// parseIntLoose mirrors JavaScript's parseInt: optional sign followed by
// leading decimal digits, otherwise zero with ok=false.
func parseIntLoose(raw string) (int, bool) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return 0, false
	}
	index := 0
	if value[0] == '+' || value[0] == '-' {
		index++
	}
	start := index
	for index < len(value) && value[index] >= '0' && value[index] <= '9' {
		index++
	}
	if index == start {
		return 0, false
	}
	parsed, err := strconv.Atoi(value[:index])
	if err != nil {
		return 0, false
	}
	return parsed, true
}

// sanitize strips control characters and caps the value at 200 characters,
// mirroring sanitize() in lib/skills-sh.js.
func sanitize(value string) string {
	cleaned := controlChars.ReplaceAllString(value, "")
	runes := []rune(cleaned)
	if len(runes) > 200 {
		runes = runes[:200]
	}
	return string(runes)
}

func numberValue(value any) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case json.Number:
		parsed, err := typed.Float64()
		if err != nil {
			return 0
		}
		return parsed
	case string:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		if err != nil {
			return 0
		}
		return parsed
	default:
		return 0
	}
}

// fetchJSON performs an upstream JSON GET with the same retry policy as
// lib/skills-sh.js: retry twice on transient failures, never on 404.
func fetchJSON(ctx context.Context, rawURL, token string, target any) error {
	var lastErr error
	for attempt := 0; attempt <= 2; attempt++ {
		err := fetchJSONOnce(ctx, rawURL, token, target)
		if err == nil {
			return nil
		}
		lastErr = err
		var upstreamErr *statusError
		if errors.As(err, &upstreamErr) && upstreamErr.Status == http.StatusNotFound {
			break
		}
		if attempt == 2 {
			break
		}
		timer := time.NewTimer(time.Duration(800*(attempt+1)) * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
	return lastErr
}

func fetchJSONOnce(ctx context.Context, rawURL, token string, target any) error {
	callCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	headers := map[string]string{"accept": "application/json"}
	if token != "" && strings.HasPrefix(rawURL, githubAPIBase) {
		headers["authorization"] = "Bearer " + token
	}

	resp, err := webclient.Get(callCtx, rawURL, headers)
	if err != nil {
		return err
	}
	switch {
	case resp.StatusCode == http.StatusNotFound:
		resp.Body.Close()
		return &statusError{Status: http.StatusNotFound, Message: "Tidak ditemukan (404)"}
	case resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500:
		resp.Body.Close()
		return &statusError{Status: resp.StatusCode, Message: fmt.Sprintf("HTTP %d", resp.StatusCode)}
	case resp.StatusCode < 200 || resp.StatusCode >= 300:
		resp.Body.Close()
		return &statusError{Status: resp.StatusCode, Message: fmt.Sprintf("HTTP %d", resp.StatusCode)}
	}
	if err := webclient.DecodeJSON(resp, target); err != nil {
		return err
	}
	return nil
}

func (s *server) searchSkills(ctx context.Context, query string, limit int, owner string) (*searchResult, error) {
	params := url.Values{}
	params.Set("q", strings.TrimSpace(query))
	params.Set("limit", strconv.Itoa(limit))
	if trimmed := strings.TrimSpace(owner); trimmed != "" && ownerPattern.MatchString(trimmed) {
		params.Set("owner", strings.ToLower(trimmed))
	}

	var payload upstreamSearch
	endpoint := skillsAPIBase + "/api/search?" + params.Encode()
	if err := fetchJSON(ctx, endpoint, s.githubToken(), &payload); err != nil {
		return nil, err
	}

	results := make([]searchResultItem, 0, len(payload.Skills))
	for _, skill := range payload.Skills {
		source := sanitize(skill.Source)
		name := sanitize(skill.Name)
		slug := sanitize(skill.ID)
		skillID := sanitize(skill.SkillID)
		if skillID == "" {
			skillID = name
		}
		pageURL := "https://skills.sh"
		if slug != "" {
			pageURL = "https://skills.sh/" + slug
		}
		results = append(results, searchResultItem{
			Name:           name,
			Skill:          skillID,
			Source:         source,
			Installs:       numberValue(skill.Installs),
			InstallCommand: fmt.Sprintf("npx skills add %s --skill %s", source, name),
			URL:            pageURL,
		})
	}

	return &searchResult{
		Source:      "skills.sh",
		Query:       strings.TrimSpace(query),
		Limit:       limit,
		ResultCount: len(results),
		Results:     results,
	}, nil
}

// parseFrontmatter reads only the name and description fields, which is all the
// install flow needs.
func parseFrontmatter(markdown string) (string, *string) {
	match := frontmatter.FindStringSubmatch(markdown)
	if len(match) != 2 {
		return "", nil
	}
	var name string
	if found := frontNamePattern.FindStringSubmatch(match[1]); len(found) == 2 {
		name = strings.TrimSpace(quoteTrimPattern.ReplaceAllString(found[1], ""))
	}
	var description *string
	if found := frontDescPattern.FindStringSubmatch(match[1]); len(found) == 2 {
		value := strings.TrimSpace(quoteTrimPattern.ReplaceAllString(found[1], ""))
		description = &value
	}
	return name, description
}

func (s *server) getRepoSkills(ctx context.Context, source, matchName string) (*repoSkills, error) {
	match := sourcePattern.FindStringSubmatch(strings.TrimSpace(source))
	if match == nil {
		return nil, errors.New("Parameter 'source' harus format owner/repo (mis. vercel-labs/agent-skills).")
	}
	owner, repo := match[1], match[2]

	var tree gitTree
	branch := ""
	for _, candidate := range []string{"main", "master"} {
		var candidateTree gitTree
		endpoint := fmt.Sprintf("%s/repos/%s/%s/git/trees/%s?recursive=1", githubAPIBase, owner, repo, candidate)
		err := fetchJSON(ctx, endpoint, s.githubToken(), &candidateTree)
		if err == nil {
			tree = candidateTree
			branch = candidate
			break
		}
		var upstreamErr *statusError
		if errors.As(err, &upstreamErr) && upstreamErr.Status == http.StatusNotFound {
			continue
		}
		return nil, err
	}
	if branch == "" {
		return nil, &statusError{
			Status:  http.StatusNotFound,
			Message: fmt.Sprintf("Repo %s/%s tidak ditemukan di GitHub.", owner, repo),
		}
	}

	files := make([]treeEntry, 0, len(tree.Tree))
	for _, entry := range tree.Tree {
		if entry.Type == "blob" && skillFilePattern.MatchString(entry.Path) {
			files = append(files, entry)
		}
	}

	candidates := files
	normalizedMatch := strings.ToLower(strings.TrimSpace(matchName))
	if normalizedMatch != "" {
		exact := make([]treeEntry, 0, 1)
		for _, entry := range files {
			dir := skillDirPattern.ReplaceAllString(entry.Path, "")
			if strings.ToLower(path.Base(dir)) == normalizedMatch {
				exact = append(exact, entry)
			}
		}
		if len(exact) > 0 {
			candidates = exact
		}
	}

	limited := candidates
	if len(limited) > 30 {
		limited = limited[:30]
	}

	skills := make([]repoSkill, 0, len(limited))
	for _, entry := range limited {
		var blob struct {
			Content string `json:"content"`
		}
		endpoint := fmt.Sprintf("%s/repos/%s/%s/contents/%s", githubAPIBase, owner, repo, entry.Path)
		if err := fetchJSON(ctx, endpoint, s.githubToken(), &blob); err != nil {
			continue
		}
		content := ""
		if blob.Content != "" {
			decoded, err := base64.StdEncoding.DecodeString(strings.ReplaceAll(blob.Content, "\n", ""))
			if err != nil {
				continue
			}
			content = string(decoded)
		}
		name, description := parseFrontmatter(content)
		dir := skillDirPattern.ReplaceAllString(entry.Path, "")
		if name == "" {
			name = path.Base(dir)
		}
		skills = append(skills, repoSkill{Name: name, Description: description, Path: entry.Path})
	}

	return &repoSkills{
		Source:    owner + "/" + repo,
		Branch:    branch,
		Truncated: len(files) > len(limited),
		Skills:    skills,
	}, nil
}

func findRepoSkill(skills []repoSkill, name string) *repoSkill {
	for index := range skills {
		if strings.EqualFold(skills[index].Name, name) {
			return &skills[index]
		}
	}
	return nil
}

func buildInstallCommand(source, skill string) string {
	return fmt.Sprintf("npx skills add %s --skill %s", source, skill)
}

func (s *server) getSkillFile(ctx context.Context, source, skill string) (*skillFile, error) {
	name := strings.TrimSpace(skill)
	repo, err := s.getRepoSkills(ctx, source, name)
	if err != nil {
		return nil, err
	}

	found := findRepoSkill(repo.Skills, name)
	if found == nil && len(repo.Skills) > 0 {
		full, fullErr := s.getRepoSkills(ctx, source, "")
		if fullErr == nil {
			if candidate := findRepoSkill(full.Skills, name); candidate != nil {
				repo.Skills = full.Skills
				repo.Branch = full.Branch
				found = candidate
			}
		}
	}
	if found == nil {
		available := make([]string, 0, len(repo.Skills))
		for _, item := range repo.Skills {
			available = append(available, item.Name)
		}
		return nil, &skillNotFoundError{
			Message:   fmt.Sprintf("Skill \"%s\" tidak ditemukan di repo %s", skill, repo.Source),
			Available: available,
		}
	}

	rawURL := fmt.Sprintf("%s/%s/%s/%s", rawGitHubBase, repo.Source, repo.Branch, found.Path)
	callCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	resp, err := webclient.Get(callCtx, rawURL, map[string]string{
		"accept": "text/plain, text/markdown, */*",
	})
	if err != nil {
		return nil, err
	}
	body, err := webclient.ReadBody(resp)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("Gagal mengambil SKILL.md (HTTP %d)", resp.StatusCode)
	}
	if strings.TrimSpace(body) == "" {
		return nil, errors.New("SKILL.md kosong")
	}

	return &skillFile{
		Source:         repo.Source,
		Branch:         repo.Branch,
		Name:           found.Name,
		Description:    found.Description,
		Path:           found.Path,
		SkillURL:       fmt.Sprintf("https://skills.sh/%s/%s", repo.Source, found.Name),
		InstallCommand: buildInstallCommand(repo.Source, found.Name),
		Markdown:       body,
	}, nil
}

func coerceString(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return typed
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(typed)
	default:
		return fmt.Sprint(typed)
	}
}

func (s *server) handleFindSkills(w http.ResponseWriter, r *http.Request) {
	values := r.URL.Query()
	query, _ := firstQueryParam(values, "query", "q")
	query = strings.TrimSpace(query)
	if query == "" {
		httpx.JSON(w, http.StatusBadRequest, map[string]any{
			"success": false,
			"error":   "Parameter query wajib diisi",
		})
		return
	}
	if len([]rune(query)) < 2 {
		httpx.JSON(w, http.StatusBadRequest, map[string]any{
			"success": false,
			"error":   "Query minimal 2 karakter",
		})
		return
	}
	if len([]rune(query)) > 200 {
		httpx.JSON(w, http.StatusBadRequest, map[string]any{
			"success": false,
			"error":   "Query terlalu panjang (maks 200 karakter)",
		})
		return
	}

	limit := 10
	if raw, ok := firstQueryParam(values, "limit", "count"); ok {
		if parsed, parsedOK := parseIntLoose(raw); parsedOK {
			limit = parsed
		}
	}
	if limit < 1 {
		limit = 1
	}
	if limit > 20 {
		limit = 20
	}
	owner := strings.TrimSpace(values.Get("owner"))

	s.respondCached(w, r, agentToolsTTL, agentToolsStale, func() (int, any) {
		result, err := s.searchSkills(r.Context(), query, limit, owner)
		if err != nil {
			status := http.StatusBadGateway
			var upstreamErr *statusError
			if errors.As(err, &upstreamErr) && upstreamErr.Status == http.StatusNotFound {
				status = http.StatusNotFound
			}
			return status, map[string]any{
				"success":    false,
				"status":     "error",
				"error":      err.Error(),
				"httpStatus": status,
			}
		}
		return http.StatusOK, map[string]any{
			"success":      true,
			"status":       "success",
			"source":       result.Source,
			"query":        result.Query,
			"limit":        result.Limit,
			"result_count": result.ResultCount,
			"results":      result.Results,
		}
	})
}

func (s *server) handleInstallSkills(w http.ResponseWriter, r *http.Request) {
	var source, skill string
	if r.Method == http.MethodPost {
		var body map[string]any
		if err := httpx.DecodeJSON(r, &body); err != nil {
			httpx.JSON(w, http.StatusBadRequest, map[string]any{
				"success": false,
				"error":   `Body harus JSON: {"source": "owner/repo", "skill": "..."}`,
			})
			return
		}
		source = coerceString(body["source"])
		skill = coerceString(body["skill"])
	} else {
		source = r.URL.Query().Get("source")
		skill = r.URL.Query().Get("skill")
	}
	source = strings.TrimSpace(source)
	skill = strings.TrimSpace(skill)

	if source == "" {
		httpx.JSON(w, http.StatusBadRequest, map[string]any{
			"success": false,
			"error":   "Parameter source wajib diisi (format owner/repo)",
		})
		return
	}
	if !sourcePattern.MatchString(source) {
		httpx.JSON(w, http.StatusBadRequest, map[string]any{
			"success": false,
			"error":   "Format source tidak valid (gunakan owner/repo, mis. vercel-labs/agent-skills)",
		})
		return
	}
	if skill == "" {
		httpx.JSON(w, http.StatusBadRequest, map[string]any{
			"success": false,
			"error":   "Parameter skill wajib diisi (nama skill)",
		})
		return
	}

	file, err := s.getSkillFile(r.Context(), source, skill)
	if err != nil {
		var missing *skillNotFoundError
		if errors.As(err, &missing) {
			httpx.JSON(w, http.StatusNotFound, map[string]any{
				"success":          false,
				"status":           "not_found",
				"error":            missing.Message,
				"available_skills": missing.Available,
				"hint":             "Pilih salah satu available_skills lalu ulangi request dengan nama yang tepat",
			})
			return
		}
		status := http.StatusBadGateway
		var upstreamErr *statusError
		if errors.As(err, &upstreamErr) && upstreamErr.Status == http.StatusNotFound {
			status = http.StatusNotFound
		}
		httpx.JSON(w, status, map[string]any{
			"success":    false,
			"status":     "error",
			"error":      err.Error(),
			"httpStatus": status,
		})
		return
	}

	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	w.Header().Set("X-Install-Command", file.InstallCommand)
	w.WriteHeader(http.StatusOK)
	_, _ = io.WriteString(w, file.Markdown)
}
