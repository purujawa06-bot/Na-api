package purtv

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/net/html"

	"github.com/purujawa06-bot/na-api/backend/internal/htmlx"
	"github.com/purujawa06-bot/na-api/backend/internal/webclient"
)

const (
	anichinHost       = "https://anichin.com.co"
	anichinMoeHost    = "https://anichin.moe"
	anichinLegacyHost = "https://anichin.cafe"
	samehadakuHost    = "https://v2.samehadaku.how"
	purtvSource       = "purtv.vercel.app"
	anichinSource     = "anichin"
	samehadakuSource  = "samehadaku"
)

// errAnichinNotFound marks a 404 from anichin. Search/list turn it into an
// empty page (exactly like the SPA), other routes surface it as a 502.
var errAnichinNotFound = errors.New("anichin.com.co gagal diakses (jaringan/CF)")

// isChallenge reports whether body is missing or a Cloudflare interstitial.
func isChallenge(body string) bool {
	return body == "" ||
		strings.Contains(body, "<title>Just a moment") ||
		strings.Contains(body, "challenge-error-text")
}

// fixIframes inserts the closing tag anichin forgets after `#pembed`, which
// otherwise swallows the rest of the document during parsing.
func fixIframes(body string) string {
	return brokenIframePattern.ReplaceAllString(body, "$1</iframe>$2")
}

// anichinHTML fetches an anichin page, retrying through the Cloudflare proxy
// when the direct request is blocked, and repairs the malformed iframes.
func (c *client) anichinHTML(ctx context.Context, rawURL string) (string, error) {
	body := ""
	resp, err := webclient.Get(ctx, rawURL, map[string]string{
		"User-Agent": webclient.UserAgentChrome,
		"Accept":     "text/html,application/xhtml+xml,*/*",
	})
	if err == nil {
		text, readErr := webclient.ReadBody(resp)
		switch {
		case resp.StatusCode >= 200 && resp.StatusCode < 300 && readErr == nil:
			body = text
		case resp.StatusCode == 404:
			return "", errAnichinNotFound
		default:
			// Any other status (403 included) is retried through the proxy,
			// mirroring the JS implementation.
			body = ""
		}
	}
	if isChallenge(body) {
		if proxied, proxyErr := c.cfFetch(ctx, rawURL); proxyErr == nil {
			body = proxied
		}
	}
	if body == "" {
		return "", errors.New("anichin.com.co gagal diakses (jaringan/CF)")
	}
	if isChallenge(body) {
		return "", errors.New("anichin.com.co menghadap Cloudflare challenge (coba lagi nanti)")
	}
	return fixIframes(body), nil
}

// cfFetch retrieves a URL through the Cloudflare fetch proxy.
func (c *client) cfFetch(ctx context.Context, rawURL string) (string, error) {
	proxyURL := c.cfProxy + "?get=" + encodeURIComponent(rawURL)
	resp, err := webclient.Get(ctx, proxyURL, map[string]string{
		"User-Agent": webclient.UserAgentChrome,
	})
	if err != nil {
		return "", err
	}
	body, err := webclient.ReadBody(resp)
	if err != nil {
		return "", err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("anichin.com.co gagal diakses (HTTP %d)", resp.StatusCode)
	}
	return body, nil
}

// scraperWebPost sends a selector bundle to the scraper-web proxy, which runs
// the jQuery expressions server-side and returns their JSON results.
func (c *client) scraperWebPost(ctx context.Context, pageURL string, output map[string]string, service string) (map[string]json.RawMessage, error) {
	encoded, err := json.Marshal(output)
	if err != nil {
		return nil, fmt.Errorf("%s: encode selectors: %w", service, err)
	}
	payload := map[string]string{"url": pageURL, "output": string(encoded)}
	resp, err := webclient.PostJSON(ctx, c.scraperWeb, payload, map[string]string{
		"Content-Type": "application/json",
	})
	if err != nil {
		return nil, fmt.Errorf("%s: %w", service, err)
	}
	body, err := webclient.ReadBody(resp)
	if err != nil {
		return nil, fmt.Errorf("%s: read response: %w", service, err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		if service == anichinSource {
			return nil, fmt.Errorf("scraper-web gagal (HTTP %d)", resp.StatusCode)
		}
		return nil, fmt.Errorf("scraper-web gagal diakses (HTTP %d)", resp.StatusCode)
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal([]byte(body), &raw); err != nil {
		return nil, fmt.Errorf("%s: invalid JSON: %w", service, err)
	}
	return raw, nil
}

// decodeField decodes one key of a scraper-web response, tolerating missing
// or null values.
func decodeField[T any](raw map[string]json.RawMessage, key string) (T, bool) {
	var zero T
	value, ok := raw[key]
	if !ok {
		return zero, false
	}
	trimmed := strings.TrimSpace(string(value))
	if trimmed == "" || trimmed == "null" {
		return zero, false
	}
	if err := json.Unmarshal(value, &zero); err != nil {
		return zero, false
	}
	return zero, true
}

// normalizeAnichinURL rewrites legacy domains and the old `/seri/` path so old
// links keep working.
func normalizeAnichinURL(rawURL string) string {
	if strings.TrimSpace(rawURL) == "" {
		return anichinHost + "/"
	}
	out := strings.TrimSpace(rawURL)
	out = strings.Replace(out, anichinLegacyHost, anichinHost, 1)
	out = strings.Replace(out, anichinHost+"/seri/", anichinHost+"/series/", 1)
	return out
}

// isAnimeURL reports whether the URL belongs to the samehadaku source.
func isAnimeURL(rawURL string) bool {
	return samehadakuHostPattern.MatchString(rawURL)
}

// animeIsSeriesURL reports whether the URL is a samehadaku series page.
func animeIsSeriesURL(rawURL string) bool {
	return samehadakuSeriesPattern.MatchString(rawURL)
}

// animeSlug extracts the trailing slug from a samehadaku URL.
func animeSlug(rawURL string) string {
	trimmed := strings.TrimRight(rawURL, "/")
	if index := strings.LastIndex(trimmed, "/"); index >= 0 {
		return trimmed[index+1:]
	}
	return trimmed
}

// parseAnichinCard parses a donghua listing card.
func parseAnichinCard(article *html.Node) card {
	var title *string
	if container := firstClass(article, "", "tt"); container != nil {
		title = trimmedPtr(text(firstClass(container, "h2", "")))
	}
	if title == nil {
		title = trimmedPtr(text(firstClass(article, "h2", "")))
	}
	link := firstClass(article, "a", "")
	if title == nil {
		title = trimmedPtr(htmlx.Attr(link, "title"))
	}
	if title == nil {
		title = trimmedPtr(text(link))
	}
	episode := trimmedPtr(text(firstClass(article, "", "epx")))
	if episode == nil {
		episode = trimmedPtr(text(firstClass(article, "", "ep")))
	}
	return card{
		Title:     title,
		Thumbnail: imgSrc(firstClass(article, "img", "")),
		URL:       absAnichin(htmlx.Attr(link, "href")),
		Type:      trimmedPtr(text(firstClass(article, "", "typez"))),
		Status:    trimmedPtr(text(firstClass(article, "", "status"))),
		Episode:   episode,
	}
}

// parsePopular parses one `.serieslist li` ranking entry.
func parsePopular(item *html.Node) popularItem {
	var link *html.Node
	if heading := firstClass(item, "h4", ""); heading != nil {
		link = firstClass(heading, "a", "")
	}
	genres := []string{}
	for _, tag := range findAttr(item, "a", "rel", "tag") {
		if name := text(tag); name != "" {
			genres = append(genres, name)
		}
	}
	var thumbnail *string
	if container := firstClass(item, "", "imgseries"); container != nil {
		thumbnail = imgSrc(firstClass(container, "img", ""))
	}
	return popularItem{
		Title:     trimmedPtr(text(link)),
		URL:       absAnichin(htmlx.Attr(link, "href")),
		Thumbnail: thumbnail,
		Genres:    genres,
		Rating:    trimmedPtr(text(firstClass(item, "", "numscore"))),
	}
}

// hasNextPage reports whether an anichin listing has a following page.
func hasNextPage(doc *html.Node) bool {
	for _, link := range findClass(doc, "a", "next") {
		if hasAncestorClass(link, "pagination") {
			return true
		}
	}
	for _, link := range findClass(doc, "a", "r") {
		if hasAncestorClass(link, "hpage") {
			return true
		}
	}
	return false
}
