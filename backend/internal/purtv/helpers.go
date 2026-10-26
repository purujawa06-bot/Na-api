package purtv

import (
	"net/url"
	"regexp"
	"strings"

	"golang.org/x/net/html"

	"github.com/purujawa06-bot/na-api/backend/internal/htmlx"
)

// text returns the trimmed raw text of a node, matching cheerio's
// `.text().trim()` (no internal whitespace collapsing).
func text(node *html.Node) string {
	return htmlx.RawText(node)
}

// stringPtr returns a pointer to value, used for JSON fields that must stay
// nullable (null instead of "").
func stringPtr(value string) *string {
	return &value
}

// trimmedPtr returns nil for blank input so the JSON field stays null.
func trimmedPtr(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

// findClass searches descendants of root for an element with the given tag
// (empty = any) and CSS class (space separated = all required).
func findClass(root *html.Node, tag, class string) []*html.Node {
	return htmlx.Find(root, tag, class, "")
}

// firstClass returns the first descendant matching tag/class or nil.
func firstClass(root *html.Node, tag, class string) *html.Node {
	return htmlx.First(root, tag, class, "")
}

// findAttr returns descendants with the given tag whose attribute matches value.
func findAttr(root *html.Node, tag, key, value string) []*html.Node {
	var matches []*html.Node
	htmlx.Walk(root, func(node *html.Node) {
		if node.Type != html.ElementNode {
			return
		}
		if tag != "" && !strings.EqualFold(node.Data, tag) {
			return
		}
		if htmlx.Attr(node, key) == value {
			matches = append(matches, node)
		}
	})
	return matches
}

// hasAncestorClass reports whether any ancestor carries the given class.
func hasAncestorClass(node *html.Node, class string) bool {
	for parent := node.Parent; parent != nil; parent = parent.Parent {
		if htmlx.HasClass(parent, class) {
			return true
		}
	}
	return false
}

// absAnichin resolves a path against the anichin host.
func absAnichin(path string) *string {
	if path == "" {
		return nil
	}
	if strings.HasPrefix(path, "http") {
		return stringPtr(path)
	}
	return stringPtr(anichinHost + path)
}

// absSamehadaku resolves a path against the samehadaku host.
func absSamehadaku(path string) *string {
	if path == "" {
		return nil
	}
	if strings.HasPrefix(path, "http") {
		return stringPtr(path)
	}
	return stringPtr(samehadakuHost + path)
}

// imgSrc returns the real image URL, preferring lazy-load attributes over the
// placeholder `data:` src.
func imgSrc(node *html.Node) *string {
	if node == nil {
		return nil
	}
	for _, attribute := range []string{"data-src", "data-litespeed-src", "src"} {
		value := htmlx.Attr(node, attribute)
		if value != "" && !strings.HasPrefix(value, "data:image") {
			return stringPtr(value)
		}
	}
	return nil
}

// encodeURIComponent mirrors JavaScript's encodeURIComponent closely enough
// for query values (spaces become %20, not '+').
func encodeURIComponent(value string) string {
	return strings.ReplaceAll(url.QueryEscape(value), "+", "%20")
}

// truncateRunes shortens a string to at most limit runes without splitting a
// multi-byte sequence.
func truncateRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}

var (
	// releaseTimePattern matches "HH:MM" / "HH.MM" inside free-form times.
	releaseTimePattern = regexp.MustCompile(`(\d{1,2})[.:](\d{2})`)
	// hourOnlyPattern matches a bare hour such as "23".
	hourOnlyPattern = regexp.MustCompile(`^(\d{1,2})$`)
	// animeEpisodePattern strips the "Ep " prefix samehadaku adds to episodes.
	animeEpisodePattern = regexp.MustCompile(`^Ep\s*(\d+)$`)
	// ratingPrefixPattern strips the "Rating " label from fallback ratings.
	ratingPrefixPattern = regexp.MustCompile(`(?i)^Rating\s*`)
	// iframeOpenPattern locates the start of an iframe tag.
	iframeOpenPattern = regexp.MustCompile(`(?is)<iframe\b[^>]*>`)
	// iframeSrcPattern extracts an iframe src attribute.
	iframeSrcPattern = regexp.MustCompile(`(?is)<iframe\b[^>]*\bsrc=["']([^"']+)["']`)
	// brokenIframePattern repairs an unclosed iframe that is immediately
	// followed by `</div>` (anichin ships `<iframe ...></</div>`).
	brokenIframePattern = regexp.MustCompile(`(?is)(<iframe\b[^>]*>)\s*<\/\s*(\s*<\/div>)`)
	// samehadakuHostPattern detects anime URLs.
	samehadakuHostPattern = regexp.MustCompile(`(?i)samehadaku\.how`)
	// anichinHostPattern matches the anichin donghua host prefix.
	anichinHostPattern = regexp.MustCompile(`(?i)^https?://anichin\.com\.co`)
	// samehadakuSeriesPattern detects samehadaku series URLs.
	samehadakuSeriesPattern = regexp.MustCompile(`(?i)samehadaku\.how/anime/`)
	// dailymotionVideoParamPattern extracts the access ID from geo players.
	dailymotionVideoParamPattern = regexp.MustCompile(`(?i)[?&]video=([^&#]+)`)
	// dailymotionIDPattern extracts a public ID from embed/watch URLs.
	dailymotionIDPattern = regexp.MustCompile(`(?i)dailymotion\.com/(?:embed/video/|video/)([A-Za-z0-9]+)`)
	// nonTitlePattern strips characters that cannot appear in a normalised title.
	nonTitlePattern = regexp.MustCompile(`[^a-z0-9 ]`)
	// whitespacePattern collapses runs of whitespace.
	whitespacePattern = regexp.MustCompile(`\s+`)
)
