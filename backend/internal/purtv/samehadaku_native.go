package purtv

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/maarkN/cloudscraper-go/pkg/cloudscraper"
	"golang.org/x/net/html"

	"github.com/purujawa06-bot/na-api/backend/internal/htmlx"
)

var samehadakuScraper *cloudscraper.Client

func newSamehadakuScraper() (*cloudscraper.Client, error) {
	if samehadakuScraper != nil {
		return samehadakuScraper, nil
	}
	client, err := cloudscraper.New(
		cloudscraper.WithProfile("chrome"),
		cloudscraper.WithTimeout(45*time.Second),
	)
	if err != nil {
		return nil, err
	}
	samehadakuScraper = client
	return client, nil
}

func samehadakuHTML(ctx context.Context, rawURL string) (string, error) {
	scraper, err := newSamehadakuScraper()
	if err != nil {
		return "", err
	}
	response, err := scraper.Get(ctx, rawURL)
	if err != nil {
		return "", fmt.Errorf("samehadaku.com.co fetch: %w", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", fmt.Errorf("samehadaku.com.co gagal diakses (HTTP %d)", response.StatusCode)
	}
	body := string(response.Body)
	lower := strings.ToLower(body)
	if strings.Contains(lower, "just a moment") ||
		strings.Contains(body, "challenge-platform") ||
		strings.Contains(body, "cdn-cgi/challenge-platform") {
		return "", errors.New("samehadaku Cloudflare challenge; cloudscraper belum cukup")
	}
	return body, nil
}

func parseSamehadakuCards(doc *html.Node) []shCard {
	cards := []shCard{}
	seen := map[string]bool{}
	for _, article := range findClass(doc, "article", "animepost") {
		link := firstClass(article, "a", "")
		href := htmlx.Attr(link, "href")
		if href == "" {
			links := findClass(article, "a", "")
			if len(links) > 0 {
				href = htmlx.Attr(links[0], "href")
				link = links[0]
			}
		}
		if href == "" || seen[href] {
			continue
		}
		seen[href] = true
		title := htmlx.Attr(link, "title")
		if title == "" {
			title = text(firstClass(article, "h2", ""))
		}
		if title == "" {
			title = htmlx.Attr(firstClass(article, "img", "anmsa"), "title")
		}
		thumb := imgSrc(firstClass(article, "img", "anmsa"))
		score := text(firstClass(article, "div", "score"))
		status := ""
		for _, div := range findClass(article, "div", "type") {
			if strings.Contains(htmlx.Attr(div, "class"), "data") {
				status = text(div)
			}
		}
		cards = append(cards, shCard{
			Title:     stringPtrOrNil(title),
			Thumbnail: thumb,
			URL:       stringPtr(absPath(href)),
				Status:    stringPtrOrNil(status),
			Episode:   stringPtrOrNil(strings.TrimSpace(score)),
		})
	}
	return cards
}

func absPath(raw string) string {
	if raw == "" {
		return ""
	}
	if strings.HasPrefix(raw, "http") {
		return raw
	}
	return samehadakuHost + raw
}

func hasNextSamehadaku(doc *html.Node) bool {
	for _, a := range findClass(doc, "a", "next") {
		if strings.Contains(strings.ToLower(text(a)), "next") {
			return true
		}
	}
	for _, a := range findClass(doc, "a", "page-numbers") {
		if strings.Contains(strings.ToLower(text(a)), "next") {
			return true
		}
	}
	return false
}

// stringPtrPtr works like stringPtr for an existing string, treating empty as nil only when appropriate.
func stringPtrPtr(v string) *string {
	if v == "" {
		return nil
	}
	p := v
	return &p
}

// findFirstUnderClass returns the first element whose class contains class.
func findFirstUnderClass(root *html.Node, class string) *html.Node {
	for _, n := range findClass(root, "", class) {
		_ = n
	}
	return firstClass(root, "", class)
}

// fetchSamehadakuHome fetches via cloudscraper (no proxy) and parses natively.
func (c *client) fetchSamehadakuHome(ctx context.Context) shHomeResult {
	body, err := c.samehadakuHTML(ctx, samehadakuHost+"/")
	if err != nil {
		return shHomeResult{Error: err.Error()}
	}
	doc, err := htmlx.Parse(body)
	if err != nil {
		return shHomeResult{Error: "parse: " + err.Error()}
	}
	result := shHomeResult{}
	// latest episode cards under `.post-show ul li`.
	postShowRoot := firstClass(doc, "div", "post-show")
	if postShowRoot == nil {
		postShowRoot = doc
	}
	for _, li := range findClass(postShowRoot, "li", "") {
		titleLink := firstClass(li, "a", "entry-title")
		if titleLink == nil {
			titleLink = firstClass(firstClass(li, "h2", "entry-title"), "a", "")
		}
		seriesURL := ""
		if titleLink != nil {
			seriesURL = htmlx.Attr(titleLink, "href")
		}
		title := text(titleLink)
		thumbURL := ""
		if img := firstClass(li, "img", ""); img != nil {
			thumbURL = htmlx.Attr(img, "src")
		}
		episodeText := ""
		if dtla := firstClass(li, "div", "dtla"); dtla != nil {
			episodeText = text(dtla)
		}
		episodeNum := ""
		if re := regexp.MustCompile(`(?i)(?:Ep|Episode)\s*(\d+(?:\.\d+)?)`); re.MatchString(episodeText) {
			episodeNum = re.FindStringSubmatch(episodeText)[1]
		}
		result.Homepage = append(result.Homepage, shHomepage{
			Title:     stringPtrOrNil(title),
			URL:       stringPtrPtr(seriesURL),
			Thumbnail: stringPtrOrNil(thumbURL),
			Episode:   stringPtrOrNil(episodeNum),
		})
	}
	// popular list under li containing .judul
	for _, li := range findClass(doc, "li", "") {
		judul := firstClass(li, "", "judul")
		if judul == nil {
			continue
		}
		link := firstClass(li, "a", "")
		thumb := imgSrc(firstClass(li, "img", ""))
		result.PopularAnime = append(result.PopularAnime, shPopularAnime{
			Title:     stringPtrOrNil(text(judul)),
			Thumbnail: thumb,
			URL:       stringPtrPtr(htmlx.Attr(link, "href")),
			Rating:    stringPtrOrNil(strings.TrimSpace(strings.TrimPrefix(text(firstClass(li, "", "rating")), "Rating"))),
			Rank:      stringPtrOrNil(text(firstClass(li, "", "is-topten"))),
		})
	}
	return result
}

// fetchSamehadakuDetail native via cloudscraper.
func (c *client) fetchSamehadakuDetail(ctx context.Context, slug string) shDetailResult {
	if slug == "" {
		return shDetailResult{Error: "Parameter slug wajib diisi"}
	}
	body, err := c.samehadakuHTML(ctx, samehadakuHost+"/anime/"+slug+"/")
	if err != nil {
		return shDetailResult{Error: err.Error()}
	}
	doc, err := htmlx.Parse(body)
	if err != nil {
		return shDetailResult{Error: "parse: " + err.Error()}
	}
	res := shDetailResult{Slug: slug}
	if h1 := firstClass(doc, "h1", ""); h1 != nil {
		res.Title = stringPtrOrNil(strings.TrimSpace(text(h1)))
	}
	for _, img := range findClass(doc, "img", "") {
		src := htmlx.Attr(img, "src")
		if strings.Contains(src, "/wp-content/uploads/") {
			res.Poster = stringPtrPtr(src)
			break
		}
	}
	for _, span := range findClass(doc, "span", "") {
		t := text(span)
		if len(t) >= 3 && t[0] >= '0' && t[0] <= '9' && strings.Contains(htmlx.Attr(span, "class"), "text-base") {
			res.Rating = stringPtrOrNil(strings.TrimSpace(strings.SplitN(t, " ", 2)[0]))
			break
		}
	}
	seenG := map[string]bool{}
	for _, a := range findClass(doc, "a", "") {
		if strings.HasPrefix(htmlx.Attr(a, "href"), samehadakuHost+"/genre/") {
			g := text(a)
			if g != "" && !seenG[g] {
				seenG[g] = true
				res.Genres = append(res.Genres, g)
			}
		}
	}
	if syn := firstClass(doc, "div", "entry-content-single"); syn != nil {
		res.Synopsis = stringPtrOrNil(text(syn))
	} else if syn := firstClass(doc, "div", "entry-content"); syn != nil {
		res.Synopsis = stringPtrOrNil(text(syn))
	}
	res.Info = map[string]string{}
	for _, span := range findClass(doc, "span", "") {
		if strings.Contains(htmlx.Attr(span, "class"), "w-28") {
			label := strings.TrimSpace(text(span))
			if label == "" {
				continue
			}
			for sib := span.NextSibling; sib != nil; sib = sib.NextSibling {
				if sib.Type == html.ElementNode && strings.EqualFold(sib.Data, "span") {
					val := strings.TrimSpace(htmlx.RawText(sib))
					if val != "" {
						res.Info[strings.ToLower(label)] = val
					}
					break
				}
			}
		}
	}
	seenEps := map[string]bool{}
	for _, a := range findClass(doc, "a", "") {
		href := htmlx.Attr(a, "href")
		if !strings.Contains(href, "-episode-") {
			continue
		}
		ttl := text(a)
		if ttl == "" {
			continue
		}
		num := ""
		if m := regexp.MustCompile(`(?i)episode[- ]?(\d+(?:\.\d+)?)`).FindStringSubmatch(href); m != nil {
			num = m[1]
		}
		key := href
		if seenEps[key] {
			continue
		}
		seenEps[key] = true
		res.Episodes = append(res.Episodes, shDetailEpisode{
			Title:  stringPtr(ttl),
			Number: stringPtrOrNil(num),
			URL:    stringPtrPtr(absSamehadakuHref(href)),
		})
	}
	return res
}

func absSamehadakuHref(u string) string {
	if strings.HasPrefix(u, "http") {
		return u
	}
	return samehadakuHost + u
}

// fetchSamehadakuEpisode native.
func (c *client) fetchSamehadakuEpisode(ctx context.Context, slug string) shEpisodeResult {
	if slug == "" {
		return shEpisodeResult{Error: "Parameter slug wajib diisi"}
	}
	body, err := c.samehadakuHTML(ctx, samehadakuHost+"/"+slug+"/")
	if err != nil {
		return shEpisodeResult{Error: err.Error()}
	}
	doc, err := htmlx.Parse(body)
	if err != nil {
		return shEpisodeResult{Error: "parse: " + err.Error()}
	}
	res := shEpisodeResult{}
	if h1 := firstClass(doc, "h1", ""); h1 != nil {
		t := strings.TrimSuffix(strings.TrimSpace(text(h1)), "Sub Indo")
		res.Title = stringPtrOrNil(t)
	}
	for _, img := range findClass(doc, "img", "") {
		src := htmlx.Attr(img, "src")
		if strings.Contains(src, "/wp-content/uploads/") {
			res.Thumbnail = stringPtrPtr(src)
			break
		}
	}
	// series via breadcrumb
	var seriesLinks []*html.Node
	for _, a := range findClass(doc, "a", "") {
		href := htmlx.Attr(a, "href")
		if strings.Contains(href, "/anime/") {
			seriesLinks = append(seriesLinks, a)
		}
	}
	if len(seriesLinks) >= 2 {
		sl := seriesLinks[len(seriesLinks)-2]
		res.AnimeTitle = stringPtrOrNil(text(sl))
		res.AnimeURL = absSamehadakuPtr(htmlx.Attr(sl, "href"))
	}
	for _, n := range findClass(doc, "", "east_player_option") {
		res.Servers = append(res.Servers, shServer{
			Name: stringPtrOrNil(text(n)),
			Post: stringPtrOrNil(htmlx.Attr(n, "data-post")),
			Nume: stringPtrOrNil(htmlx.Attr(n, "data-nume")),
			Type: stringPtrOrNil(htmlx.Attr(n, "data-type")),
		})
	}
	for _, a := range findClass(doc, "a", "") {
		rel := htmlx.Attr(a, "rel")
		href := htmlx.Attr(a, "href")
		if rel == "prev" {
			res.PrevURL = absSamehadakuPtr(href)
		}
		if rel == "next" {
			res.NextURL = absSamehadakuPtr(href)
		}
	}
	return res
}

func absSamehadakuPtr(u string) *string {
	return absSamehadaku(u)
}

func (c *client) samehadakuHTML(ctx context.Context, rawURL string) (string, error) {
	scraper, _ := newSamehadakuScraper()
	if scraper != nil {
		if response, err := scraper.Get(ctx, rawURL); err == nil {
			if response.StatusCode >= 200 && response.StatusCode < 300 {
				body := string(response.Body)
				lower := strings.ToLower(body)
				if !strings.Contains(lower, "just a moment") && !strings.Contains(body, "challenge-platform") {
					return body, nil
				}
			}
		}
	}
	if body, err := c.cfFetch(ctx, rawURL); err == nil {
		return body, nil
	} else {
		return "", err
	}
}
