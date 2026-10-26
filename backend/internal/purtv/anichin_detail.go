package purtv

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"sync"

	"golang.org/x/net/html"

	"github.com/purujawa06-bot/na-api/backend/internal/htmlx"
	"github.com/purujawa06-bot/na-api/backend/internal/webclient"
)

// mirrorEntry is one `.mirror option`: a server label plus its mirror page.
type mirrorEntry struct {
	server *string
	index  *string
	page   string
}

// animeDetail builds the episode detail for a samehadaku slug.
func (c *client) animeDetail(ctx context.Context, slug string) (*detailAnimeResponse, error) {
	result := c.fetchSamehadakuEpisode(ctx, slug)
	if result.Error != "" {
		return nil, errors.New(result.Error)
	}

	streamingLinks := make([]animeStreamLink, 0, len(result.Servers))
	for _, server := range result.Servers {
		streamingLinks = append(streamingLinks, animeStreamLink{
			Server: server.Name,
			Index:  server.Nume,
			URL:    nil,
			Post:   server.Post,
			Nume:   server.Nume,
			Type:   server.Type,
		})
	}

	downloadLinks := make([]downloadGroup, 0, len(result.Downloads))
	for _, group := range result.Downloads {
		qualities := make([]string, 0, len(group.Qualities))
		links := []downloadLink{}
		for _, quality := range group.Qualities {
			if quality.Quality != nil && *quality.Quality != "" {
				qualities = append(qualities, *quality.Quality)
			}
			links = append(links, quality.Links...)
		}
		downloadLinks = append(downloadLinks, downloadGroup{
			Quality: strings.Join(qualities, " "),
			Links:   links,
		})
	}

	thumbnail := result.Thumbnail
	if thumbnail == nil {
		thumbnail = result.AnimePoster
	}

	return &detailAnimeResponse{
		Source:         purtvSource,
		Title:          result.Title,
		Series:         result.AnimeTitle,
		SeriesURL:      result.AnimeURL,
		Synopsis:       result.AnimeSynopsis,
		Thumbnail:      thumbnail,
		DefaultIframe:  nil,
		EpisodeSlug:    slug,
		StreamingLinks: streamingLinks,
		DownloadLinks:  downloadLinks,
		Navigation: detailNav{
			Prev:        result.PrevURL,
			Next:        result.NextURL,
			AllEpisodes: result.AnimeURL,
		},
		Episode:    nil,
		Pagenation: newPagenation(1, false),
	}, nil
}

// donghuaDetail builds the episode detail for an anichin page.
func (c *client) donghuaDetail(ctx context.Context, rawURL string) (*detailDonghuaResponse, error) {
	body, err := c.anichinHTML(ctx, normalizeAnichinURL(rawURL))
	if err != nil {
		return nil, err
	}
	doc, err := htmlx.Parse(body)
	if err != nil {
		return nil, fmt.Errorf("parse anichin episode: %w", err)
	}

	seriesNode := findSeriesNode(doc)
	series := text(seriesNode)
	seriesURL := absAnichin(htmlx.Attr(seriesNode, "href"))

	mirrors := findMirrors(doc)
	streamingLinks := make([]donghuaStreamLink, len(mirrors))
	var waitGroup sync.WaitGroup
	for index, entry := range mirrors {
		waitGroup.Add(1)
		go func(index int, entry mirrorEntry) {
			defer waitGroup.Done()
			iframe := c.resolveMirror(ctx, entry.page)
			var dailymotion *dailymotionInfo
			if iframe != "" && strings.Contains(strings.ToLower(iframe), "dailymotion.com") {
				if info := c.resolveDailymotion(ctx, iframe); info != nil {
					dailymotion = info
					if info.EmbedURL != "" {
						iframe = info.EmbedURL
					}
				}
			}
			linkURL := iframe
			if linkURL == "" {
				linkURL = entry.page
			}
			link := donghuaStreamLink{
				Server: entry.server,
				Index:  entry.index,
				URL:    stringPtr(linkURL),
				Mirror: stringPtr(entry.page),
			}
			if dailymotion != nil {
				link.Dailymotion = dailymotion
				link.StreamURL = dailymotion.StreamURL
				link.HLSURL = dailymotion.HLSURL
			}
			streamingLinks[index] = link
		}(index, entry)
	}
	waitGroup.Wait()

	moeLinks := c.moeMirrorLinks(ctx, rawURL)
	existing := map[string]struct{}{}
	for _, link := range streamingLinks {
		if link.URL != nil {
			existing[strings.TrimRight(*link.URL, "/")] = struct{}{}
		}
	}
	for _, moeLink := range moeLinks {
		if moeLink.URL == nil {
			continue
		}
		key := strings.TrimRight(*moeLink.URL, "/")
		if _, found := existing[key]; found {
			continue
		}
		streamingLinks = append(streamingLinks, moeLink)
	}

	frameSrc := ""
	if pembed := htmlx.First(doc, "", "", "pembed"); pembed != nil {
		frame := firstClass(pembed, "iframe", "")
		frameSrc = htmlx.Attr(frame, "data-litespeed-src")
		if frameSrc == "" {
			frameSrc = htmlx.Attr(frame, "src")
		}
	}
	var defaultIframe *string
	if frameSrc != "" && frameSrc != "about:blank" {
		resolved := c.resolveAnichinPlayer(ctx, frameSrc)
		defaultIframe = stringPtr(resolved)
	}

	var dailymotion *dailymotionInfo
	if defaultIframe != nil && strings.Contains(strings.ToLower(*defaultIframe), "dailymotion.com") {
		dailymotion = c.resolveDailymotion(ctx, *defaultIframe)
	}
	if dailymotion != nil && dailymotion.EmbedURL != "" {
		defaultIframe = stringPtr(dailymotion.EmbedURL)
	}
	if dailymotion != nil && dailymotion.IsPrivate != nil && *dailymotion.IsPrivate {
		for _, alternative := range moeLinks {
			if alternative.URL == nil {
				continue
			}
			lowered := strings.ToLower(*alternative.URL)
			if !strings.Contains(lowered, "dailymotion.com") && !strings.Contains(lowered, "anichin-player.web.id") {
				defaultIframe = alternative.URL
				break
			}
		}
	}

	navigation := detailNav{
		Prev:        absAnichin(htmlx.Attr(neighbourEpisodeLink(doc, "prev"), "href")),
		Next:        absAnichin(htmlx.Attr(neighbourEpisodeLink(doc, "next"), "href")),
		AllEpisodes: absAnichin(htmlx.Attr(allEpisodesLink(doc), "href")),
	}

	title := text(firstClass(doc, "", "entry-title"))
	thumbnail := imgSrc(firstClass(firstClass(firstClass(doc, "", "headlist"), "", "thumb"), "img", ""))
	if thumbnail == nil {
		thumbnail = metaContent(doc, "property", "og:image")
	}
	if thumbnail == nil {
		content := firstClass(doc, "", "entry-content")
		thumbnail = trimmedPtr(htmlx.Attr(firstClass(content, "img", ""), "src"))
	}

	synopsis := metaContent(doc, "name", "description")
	if synopsis == nil {
		synopsis = metaContent(doc, "property", "og:description")
	}

	return &detailDonghuaResponse{
		Source:         purtvSource,
		Title:          stringPtr(title),
		Thumbnail:      thumbnail,
		Series:         trimmedPtr(series),
		SeriesURL:      seriesURL,
		Synopsis:       synopsis,
		DefaultIframe:  defaultIframe,
		Dailymotion:    dailymotion,
		StreamingLinks: streamingLinks,
		DownloadLinks:  []downloadGroup{},
		Navigation:     navigation,
		Pagenation:     newPagenation(1, false),
	}, nil
}

// findSeriesNode locates the parent series link (headlist first, then nav).
func findSeriesNode(doc *html.Node) *html.Node {
	if heading := firstClass(firstClass(firstClass(doc, "", "headlist"), "", "det"), "h2", ""); heading != nil {
		if link := firstClass(heading, "a", ""); link != nil {
			return link
		}
	}
	return firstClass(firstClass(firstClass(doc, "", "naveps"), "", "nvsc"), "a", "")
}

// findMirrors collects every `.mirror option` of an episode page.
func findMirrors(doc *html.Node) []mirrorEntry {
	entries := []mirrorEntry{}
	for _, mirror := range findClass(doc, "", "mirror") {
		for _, option := range findClass(mirror, "option", "") {
			page := strings.TrimSpace(htmlx.Attr(option, "value"))
			if page == "" {
				continue
			}
			entries = append(entries, mirrorEntry{
				server: trimmedPtr(text(option)),
				index:  trimmedPtr(htmlx.Attr(option, "data-index")),
				page:   page,
			})
		}
	}
	return entries
}

// neighbourEpisodeLink returns the prev/next anchor inside the episode nav.
func neighbourEpisodeLink(doc *html.Node, rel string) *html.Node {
	for _, naveps := range findClass(doc, "", "naveps") {
		for _, nav := range findClass(naveps, "", "nvs") {
			for _, link := range findClass(nav, "a", "") {
				if strings.EqualFold(htmlx.Attr(link, "rel"), rel) {
					return link
				}
			}
		}
	}
	return nil
}

// allEpisodesLink returns the `.naveps .nvsc a` anchor of an episode page.
func allEpisodesLink(doc *html.Node) *html.Node {
	for _, naveps := range findClass(doc, "", "naveps") {
		if anchor := firstClass(naveps, "", "nvsc"); anchor != nil {
			return firstClass(anchor, "a", "")
		}
	}
	return nil
}

// metaContent returns the content attribute of a matching meta tag.
func metaContent(doc *html.Node, key, value string) *string {
	for _, tag := range findAttr(doc, "meta", key, value) {
		if content := strings.TrimSpace(htmlx.Attr(tag, "content")); content != "" {
			return stringPtr(content)
		}
	}
	return nil
}

// resolveMirror resolves a `/v/<n>/` mirror page to the real embed iframe.
func (c *client) resolveMirror(ctx context.Context, pageURL string) string {
	iframeURL := pageURL
	if !strings.HasPrefix(pageURL, "http") {
		iframeURL = anichinHost + pageURL
	}
	body, err := c.anichinHTML(ctx, iframeURL)
	if err != nil {
		return ""
	}
	doc, err := htmlx.Parse(body)
	if err != nil {
		return ""
	}

	found := ""
	for _, frame := range findClass(doc, "iframe", "") {
		src := htmlx.Attr(frame, "data-litespeed-src")
		if src == "" {
			src = htmlx.Attr(frame, "src")
		}
		if src == "" || src == "about:blank" || strings.HasPrefix(strings.ToLower(src), "data:") {
			continue
		}
		if strings.Contains(strings.ToLower(src), "fakewatches") {
			continue
		}
		if found == "" || strings.Contains(strings.ToLower(src), "anichin.stream") {
			found = src
		}
	}
	if found == "" {
		return ""
	}
	return c.resolveAnichinPlayer(ctx, found)
}

// resolveAnichinPlayer fetches an anichin player page server-side (with the
// referer the player whitelists) and returns its real iframe.
func (c *client) resolveAnichinPlayer(ctx context.Context, rawURL string) string {
	if rawURL == "" || !strings.Contains(strings.ToLower(rawURL), "anichin-player.web.id") {
		return rawURL
	}
	headers := map[string]string{
		"User-Agent": webclient.UserAgentChrome,
		"Referer":    "https://anichin.care/",
		"Accept":     "text/html,application/xhtml+xml,*/*",
	}
	if resp, err := webclient.Get(ctx, rawURL, headers); err == nil {
		if body, readErr := webclient.ReadBody(resp); readErr == nil && resp.StatusCode >= 200 && resp.StatusCode < 300 {
			if extracted := extractIframeSource(body); extracted != "" {
				return extracted
			}
		}
	}
	if resp, err := webclient.Get(ctx, c.cfProxy+"?get="+encodeURIComponent(rawURL), headers); err == nil {
		if body, readErr := webclient.ReadBody(resp); readErr == nil && resp.StatusCode >= 200 && resp.StatusCode < 300 {
			if extracted := extractIframeSource(body); extracted != "" {
				return extracted
			}
		}
	}
	return rawURL
}

// extractIframeSource returns the first usable iframe src in an HTML snippet.
func extractIframeSource(body string) string {
	if body == "" || strings.Contains(body, "Domain Tidak Diizinkan") || strings.Contains(body, "Just a moment") {
		return ""
	}
	match := iframeSrcPattern.FindStringSubmatch(body)
	if match == nil {
		return ""
	}
	src := strings.ReplaceAll(match[1], "&amp;", "&")
	if strings.HasPrefix(src, "//") {
		src = "https:" + src
	}
	if src == "" || src == "about:blank" {
		return ""
	}
	return src
}

// moeMirrorLinks collects the extra servers only anichin.moe exposes.
func (c *client) moeMirrorLinks(ctx context.Context, rawURL string) []donghuaStreamLink {
	moeURL := strings.Replace(rawURL, anichinLegacyHost, anichinMoeHost, 1)
	moeURL = anichinHostPattern.ReplaceAllString(moeURL, anichinMoeHost)
	moeURL = strings.Replace(moeURL, anichinMoeHost+"/seri/", anichinMoeHost+"/series/", 1)

	body, err := c.anichinHTML(ctx, moeURL)
	if err != nil {
		return []donghuaStreamLink{}
	}
	doc, err := htmlx.Parse(body)
	if err != nil {
		return []donghuaStreamLink{}
	}

	links := []donghuaStreamLink{}
	for _, mirror := range findClass(doc, "", "mirror") {
		for _, option := range findClass(mirror, "option", "") {
			decoded := decodeBase64HTML(strings.TrimSpace(htmlx.Attr(option, "value")))
			if decoded == "" {
				continue
			}
			match := iframeSrcPattern.FindStringSubmatch(decoded)
			if match == nil {
				continue
			}
			src := strings.ReplaceAll(match[1], "&amp;", "&")
			if strings.HasPrefix(src, "//") {
				src = "https:" + src
			}
			if src == "" {
				continue
			}
			links = append(links, donghuaStreamLink{
				Server: trimmedPtr(text(option)),
				Index:  trimmedPtr(htmlx.Attr(option, "data-index")),
				URL:    stringPtr(src),
				Mirror: stringPtr(src),
				Source: stringPtr("anichin.moe"),
			})
		}
	}
	return links
}

// decodeBase64HTML decodes the base64 payload stored in mirror options.
func decodeBase64HTML(value string) string {
	if value == "" {
		return ""
	}
	cleaned := strings.Map(func(character rune) rune {
		switch {
		case character >= 'A' && character <= 'Z':
			return character
		case character >= 'a' && character <= 'z':
			return character
		case character >= '0' && character <= '9':
			return character
		case character == '+' || character == '/':
			return character
		default:
			return -1
		}
	}, value)
	if remainder := len(cleaned) % 4; remainder != 0 {
		cleaned += strings.Repeat("=", 4-remainder)
	}
	decoded, err := base64.StdEncoding.DecodeString(cleaned)
	if err != nil {
		return ""
	}
	return string(decoded)
}
