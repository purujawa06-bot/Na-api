package agenttools

import (
	"context"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
	"github.com/purujawa06-bot/na-api/backend/internal/webclient"
)

const diagInstagramURL = "https://www.instagram.com/reel/DVDX96NCdXc/"

var (
	diagSSSAPIHints   = regexp.MustCompile(`(?:fetch\(|axios|action=|["'])[^"']*(?:/api/|ajax)[^"']*`)
	diagSSSTokenHints = regexp.MustCompile(`(?:data-token|_token|name="token")[^>]{0,80}`)
	diagSnapToken     = regexp.MustCompile(`name="token"[^>]*value="([^"]+)"`)
	diagSnapTokenAlt  = regexp.MustCompile(`data-token="([^"]+)"`)
	diagSnapAPIHints  = regexp.MustCompile(`(?:action=|["'])https?://api\.[^"']*`)
	diagIndownCSRF    = regexp.MustCompile(`name="_token"[^>]*value="([^"]+)"`)
	diagCDNLinks      = regexp.MustCompile(`https://[^"' ]*scontent[^"' ]*`)
)

func truncateRunes(value string, limit int) string {
	if utf8.RuneCountInString(value) <= limit {
		return value
	}
	runes := []rune(value)
	return string(runes[:limit])
}

// uniqMatches returns unique regex matches in first-seen order.
func uniqMatches(pattern *regexp.Regexp, text string, limit int) []string {
	matches := make([]string, 0, limit)
	seen := make(map[string]struct{}, limit)
	for _, match := range pattern.FindAllString(text, -1) {
		if _, exists := seen[match]; exists {
			continue
		}
		seen[match] = struct{}{}
		matches = append(matches, match)
		if len(matches) >= limit {
			break
		}
	}
	return matches
}

// probeDiag runs one upstream probe and records its duration. Upstream HTTP
// error statuses are still successful probes, matching the JS behaviour.
func probeDiag(ctx context.Context, name string, fn func(context.Context) (map[string]any, error)) map[string]any {
	started := time.Now()
	output, err := fn(ctx)
	elapsed := time.Since(started).Milliseconds()
	if err != nil {
		return map[string]any{
			"name":  name,
			"ms":    elapsed,
			"ok":    false,
			"error": truncateRunes(err.Error(), 400),
		}
	}
	result := map[string]any{"name": name, "ms": elapsed, "ok": true}
	for key, value := range output {
		result[key] = value
	}
	return result
}

func diagInstasave(ctx context.Context) (map[string]any, error) {
	form := url.Values{}
	form.Set("url", diagInstagramURL)
	form.Set("instaLink", `https://www.instagram.com/graphql/query?query_hash=2b0673e0dc4580674a88d426fe00ea90&variables={"shortcode":"DVDX96NCdXc"}`)

	response, err := webclient.PostForm(ctx, "https://api.instasave.website/media", form, map[string]string{
		"Referer": "https://instasave.website/",
		"Origin":  "https://instasave.website",
	})
	if err != nil {
		return nil, err
	}
	body, err := webclient.ReadBody(response)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"status": response.StatusCode,
		"body":   truncateRunes(body, 250),
	}, nil
}

func diagSSSInstagram(ctx context.Context) (map[string]any, error) {
	response, err := webclient.Get(ctx, "https://sssinstagram.com/id", nil)
	if err != nil {
		return nil, err
	}
	markup, err := webclient.ReadBody(response)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"status":     response.StatusCode,
		"len":        utf8.RuneCountInString(markup),
		"apiHints":   uniqMatches(diagSSSAPIHints, markup, 12),
		"tokenHints": uniqMatches(diagSSSTokenHints, markup, 12),
	}, nil
}

func diagSnapInstaHome(ctx context.Context) (map[string]any, error) {
	response, err := webclient.Get(ctx, "https://snapinsta.app/", nil)
	if err != nil {
		return nil, err
	}
	markup, err := webclient.ReadBody(response)
	if err != nil {
		return nil, err
	}
	var token any
	if match := diagSnapToken.FindStringSubmatch(markup); len(match) == 2 {
		token = match[1]
	} else if match := diagSnapTokenAlt.FindStringSubmatch(markup); len(match) == 2 {
		token = match[1]
	}
	return map[string]any{
		"status":   response.StatusCode,
		"len":      utf8.RuneCountInString(markup),
		"token":    token,
		"apiHints": uniqMatches(diagSnapAPIHints, markup, 12),
	}, nil
}

func diagSnapInstaAJAX(ctx context.Context) (map[string]any, error) {
	form := url.Values{}
	form.Set("url", diagInstagramURL)
	form.Set("lang", "en")

	response, err := webclient.PostForm(ctx, "https://api.snapinsta.app/api/ajax", form, map[string]string{
		"X-Requested-With": "XMLHttpRequest",
		"Referer":          "https://snapinsta.app/",
	})
	if err != nil {
		return nil, err
	}
	body, err := webclient.ReadBody(response)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"status": response.StatusCode,
		"body":   truncateRunes(body, 300),
	}, nil
}

func diagIndownHome(ctx context.Context) (map[string]any, error) {
	response, err := webclient.Get(ctx, "https://indown.io/", nil)
	if err != nil {
		return nil, err
	}
	markup, err := webclient.ReadBody(response)
	if err != nil {
		return nil, err
	}
	match := diagIndownCSRF.FindStringSubmatch(markup)
	return map[string]any{
		"status": response.StatusCode,
		"len":    utf8.RuneCountInString(markup),
		"csrf":   len(match) == 2 && match[1] != "",
	}, nil
}

func diagImginnPost(ctx context.Context) (map[string]any, error) {
	target := "https://imginn.com/p/" + strings.TrimSpace("DVDX96NCdXc") + "/"
	response, err := webclient.Get(ctx, target, nil)
	if err != nil {
		return nil, err
	}
	markup, err := webclient.ReadBody(response)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"status":   response.StatusCode,
		"len":      utf8.RuneCountInString(markup),
		"hasVideo": strings.Contains(markup, "<video"),
		"cdnLinks": uniqMatches(diagCDNLinks, markup, 3),
	}, nil
}

func (s *server) handleUpstreamDiag(w http.ResponseWriter, r *http.Request) {
	probes := []struct {
		name string
		fn   func(context.Context) (map[string]any, error)
	}{
		{"instasave-recheck", diagInstasave},
		{"sssinstagram-home", diagSSSInstagram},
		{"snapinsta-home", diagSnapInstaHome},
		{"snapinsta-ajax", diagSnapInstaAJAX},
		{"indown-home", diagIndownHome},
		{"imginn-post", diagImginnPost},
	}

	results := make([]map[string]any, len(probes))
	var waitGroup sync.WaitGroup
	for index, item := range probes {
		waitGroup.Add(1)
		go func(index int, name string, fn func(context.Context) (map[string]any, error)) {
			defer waitGroup.Done()
			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()
			results[index] = probeDiag(ctx, name, fn)
		}(index, item.name, item.fn)
	}
	waitGroup.Wait()

	httpx.JSON(w, http.StatusOK, map[string]any{
		"probed_at": time.Now().UTC().Format("2006-01-02T15:04:05.000Z"),
		"results":   results,
	})
}
