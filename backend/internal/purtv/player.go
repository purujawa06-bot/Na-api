package purtv

import (
	"context"
	"errors"
	"net/url"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/purujawa06-bot/na-api/backend/internal/htmlx"
	"github.com/purujawa06-bot/na-api/backend/internal/webclient"
)

// httpSrcPattern is the fallback extraction used when no iframe element exists.
var httpSrcPattern = regexp.MustCompile(`(?i)src=["'](https?://[^"']+)["']`)

// bareURLPattern extracts the first bare URL from a short response.
var bareURLPattern = regexp.MustCompile(`https?://[^\s"'<>]+`)

// player resolves a samehadaku admin-ajax player into its iframe URL.
func (c *client) player(ctx context.Context, post, nume, playerType, slug string) (*playerResponse, error) {
	ajaxURL := samehadakuHost + "/wp-admin/admin-ajax.php"
	form := url.Values{
		"action": {"player_ajax"},
		"post":   {post},
		"nume":   {nume},
		"type":   {playerType},
	}
	referer := samehadakuHost
	if slug != "" {
		referer = samehadakuHost + "/" + slug + "/"
	}
	headers := map[string]string{
		"User-Agent":       webclient.UserAgentChrome,
		"Referer":          referer,
		"Origin":           samehadakuHost,
		"X-Requested-With": "XMLHttpRequest",
		"Accept":           "*/*",
	}

	body := ""
	blocked := true
	if resp, err := webclient.PostForm(ctx, ajaxURL, form, headers); err == nil {
		if text, readErr := webclient.ReadBody(resp); readErr == nil {
			body = text
		}
		blocked = resp.StatusCode == 403 || isPlayerBlocked(body)
	}

	// Cloudflare blocks datacenter IPs, so the same POST is replayed through
	// the fetch proxy, which forwards method, body, and headers.
	if blocked {
		proxyURL := c.cfProxy + "?get=" + encodeURIComponent(ajaxURL)
		if proxyResp, err := webclient.PostForm(ctx, proxyURL, form, headers); err == nil {
			if text, readErr := webclient.ReadBody(proxyResp); readErr == nil {
				if proxyResp.StatusCode >= 200 && proxyResp.StatusCode < 300 && !isPlayerBlocked(text) {
					body = text
				}
			}
		}
	}

	if body != "" && !isPlayerBlocked(body) {
		if iframe := extractPlayerIframe(body); iframe != "" {
			return &playerResponse{Iframe: iframe, Raw: truncateRunes(body, 5000)}, nil
		}
	}

	// Newer samehadaku episode pages embed every server iframe in a
	// `data-embed` attribute, so the episode page is a reliable fallback when
	// admin-ajax is Cloudflare-blocked.
	if iframe := c.animePlayerFromEpisode(ctx, slug, post, nume); iframe != "" {
		return &playerResponse{Iframe: iframe, Raw: truncateRunes(body, 5000)}, nil
	}

	if body == "" || isPlayerBlocked(body) {
		return nil, errors.New("Player diblokir Cloudflare (coba lagi nanti)")
	}
	return nil, errors.New("Iframe tidak ditemukan di respons player")
}

// extractPlayerIframe pulls the first usable iframe URL out of a player
// response body.
func extractPlayerIframe(body string) string {
	if match := iframeSrcPattern.FindStringSubmatch(body); match != nil {
		return normaliseIframeURL(strings.ReplaceAll(match[1], "&amp;", "&"))
	}
	if match := httpSrcPattern.FindStringSubmatch(body); match != nil {
		return match[1]
	}
	if utf8.RuneCountInString(strings.TrimSpace(body)) < 500 && strings.Contains(body, "http") {
		return bareURLPattern.FindString(body)
	}
	return ""
}

// animePlayerFromEpisode resolves a server iframe from the episode page itself.
func (c *client) animePlayerFromEpisode(ctx context.Context, slug, post, nume string) string {
	if slug == "" {
		return ""
	}
	body, err := c.samehadakuHTML(ctx, samehadakuHost+"/"+slug+"/")
	if err != nil {
		return ""
	}
	doc, err := htmlx.Parse(body)
	if err != nil {
		return ""
	}
	for _, option := range findClass(doc, "", "east_player_option") {
		optionPost := htmlx.Attr(option, "data-post")
		optionNume := htmlx.Attr(option, "data-nume")
		if post != "" && optionPost != "" && optionPost != post {
			continue
		}
		if nume != "" && optionNume != "" && optionNume != nume {
			continue
		}
		if source := embedIframeSource(htmlx.Attr(option, "data-embed")); source != nil {
			return *source
		}
	}
	return ""
}

// normaliseIframeURL upgrades protocol-relative iframe sources.
func normaliseIframeURL(source string) string {
	if strings.HasPrefix(source, "//") {
		return "https:" + source
	}
	return source
}

// isPlayerBlocked reports whether the player response is a Cloudflare page.
func isPlayerBlocked(body string) bool {
	return strings.Contains(body, "Just a moment") || strings.Contains(body, "challenge-error-text")
}
