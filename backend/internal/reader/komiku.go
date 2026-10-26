package reader

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"golang.org/x/net/html"

	"github.com/purujawa06-bot/na-api/backend/internal/htmlx"
	"github.com/purujawa06-bot/na-api/backend/internal/webclient"
)

const (
	komikuHost = "https://komiku.org"
	komikuAPI  = "https://api.komiku.org"
)

// komikuTipes lists the comic types accepted by the pustaka filter.
var komikuTipes = []string{"manga", "manhwa", "manhua"}

var (
	mangaSlugRe        = regexp.MustCompile(`/manga/([^/]+)/?$`)
	komikuPageRe       = regexp.MustCompile(`page/(\d+)/`)
	komikuPageQueryRe  = regexp.MustCompile(`page=(\d+)`)
	komikuReadersRe    = regexp.MustCompile(`([0-9.,]+[kjt]*)\s*pembaca`)
	komikuGenreCountRe = regexp.MustCompile(`\s*\(\d+\)\s*$`)
	komikuLabelStripRe = regexp.MustCompile(`[:\s]`)
	mangaDataRe        = regexp.MustCompile(`var mangaData=(\{[\s\S]*?\});`)
	chapterDataRe      = regexp.MustCompile(`var chapterData=(\{[\s\S]*?\});`)
	mangaIDRe          = regexp.MustCompile(`var mangaData=\{(?s:[\s\S]*?)id:['"](\d+)['"]`)
	flatJSObjectRe     = regexp.MustCompile(`([A-Za-z_$][\w$]*)\s*:\s*(?:"([^"]*)"|'([^']*)'|([0-9.]+)|(true|false|null))`)
)

// komikuHomeCard is one card of the home page sections.
type komikuHomeCard struct {
	Rank          any    `json:"rank"`
	Slug          any    `json:"slug"`
	Title         string `json:"title"`
	Cover         any    `json:"cover"`
	Meta          any    `json:"meta"`
	LatestChapter any    `json:"latestChapter"`
	URL           any    `json:"url"`
}

// komikuRanking groups the weekly and daily ranking sections.
type komikuRanking struct {
	Mingguan []komikuHomeCard `json:"mingguan"`
	Harian   []komikuHomeCard `json:"harian"`
}

// komikuHomeResponse is the payload of GET /api/komiku/home.
type komikuHomeResponse struct {
	Success         bool             `json:"success"`
	Source          string           `json:"source"`
	Ranking         komikuRanking    `json:"ranking"`
	Populer         []komikuHomeCard `json:"populer"`
	Terbaru         []komikuHomeCard `json:"terbaru"`
	BaruDitambahkan []komikuHomeCard `json:"baruDitambahkan"`
}

// komikuChapterRef points at the first or latest chapter of a series.
type komikuChapterRef struct {
	Title string `json:"title"`
	URL   any    `json:"url"`
}

// komikuListingChapters holds the chapter shortcuts of a listing card.
type komikuListingChapters struct {
	First  *komikuChapterRef `json:"first,omitempty"`
	Latest *komikuChapterRef `json:"latest,omitempty"`
}

// komikuListing is one `.bge` card (pustaka, genre, search).
type komikuListing struct {
	Slug     any                   `json:"slug"`
	Title    string                `json:"title"`
	Cover    any                   `json:"cover"`
	Type     any                   `json:"type"`
	Theme    any                   `json:"theme"`
	Readers  any                   `json:"readers"`
	Synopsis any                   `json:"synopsis"`
	URL      any                   `json:"url"`
	Chapters komikuListingChapters `json:"chapters"`
}

// komikuPustakaResponse is the payload of GET /api/komiku/pustaka.
type komikuPustakaResponse struct {
	Success bool            `json:"success"`
	Source  string          `json:"source"`
	Tipe    string          `json:"tipe"`
	Page    int             `json:"page"`
	HasNext bool            `json:"hasNext"`
	Results []komikuListing `json:"results"`
}

// komikuGenreResponse is the payload of GET /api/komiku/genre.
type komikuGenreResponse struct {
	Success bool             `json:"success"`
	Source  string           `json:"source"`
	Genre   string           `json:"genre"`
	Page    int              `json:"page"`
	HasNext bool             `json:"hasNext"`
	Genres  []komikuGenreTag `json:"genres"`
	Results []komikuListing  `json:"results"`
}

// komikuSearchResponse is the payload of GET /api/komiku/search.
type komikuSearchResponse struct {
	Success bool            `json:"success"`
	Source  string          `json:"source"`
	Query   string          `json:"query"`
	Page    int             `json:"page"`
	HasNext bool            `json:"hasNext"`
	Results []komikuListing `json:"results"`
}

// komikuGenreTag is a genre chip on the detail page or the genre filter list.
type komikuGenreTag struct {
	Slug any    `json:"slug"`
	Name string `json:"name"`
}

// komikuChapterItem is one row of the chapter table.
type komikuChapterItem struct {
	URL   any    `json:"url"`
	Title string `json:"title"`
	Date  any    `json:"date"`
}

// komikuDetailChapters is the chapter block of the detail payload.
type komikuDetailChapters struct {
	Count  int                 `json:"count"`
	First  *komikuChapterRef   `json:"first"`
	Latest *komikuChapterRef   `json:"latest"`
	List   []komikuChapterItem `json:"list"`
}

// komikuRelated is one related-comic entry.
type komikuRelated struct {
	Slug  any    `json:"slug"`
	Title string `json:"title"`
	URL   any    `json:"url"`
}

// komikuDetailResponse is the payload of GET /api/komiku/detail.
type komikuDetailResponse struct {
	Success          bool                 `json:"success"`
	Source           string               `json:"source"`
	ID               any                  `json:"id"`
	Slug             string               `json:"slug"`
	Title            any                  `json:"title"`
	AlternativeTitle any                  `json:"alternativeTitle"`
	Type             any                  `json:"type"`
	Theme            any                  `json:"theme"`
	Genre            []komikuGenreTag     `json:"genre"`
	Author           any                  `json:"author"`
	Rating           any                  `json:"rating"`
	Readers          any                  `json:"readers"`
	ReadingDirection any                  `json:"readingDirection"`
	Synopsis         any                  `json:"synopsis"`
	Chapters         komikuDetailChapters `json:"chapters"`
	Related          []komikuRelated      `json:"related"`
	URL              string               `json:"url"`
}

// komikuChapterResponse is the payload of GET /api/komiku/chapter.
type komikuChapterResponse struct {
	Success    bool     `json:"success"`
	Source     string   `json:"source"`
	ID         any      `json:"id"`
	SeriesID   any      `json:"seriesId"`
	Series     any      `json:"series"`
	Chapter    any      `json:"chapter"`
	ImageCount any      `json:"imageCount"`
	Thumbnail  any      `json:"thumbnail"`
	HasNext    any      `json:"hasNext"`
	SeriesURL  any      `json:"seriesUrl"`
	Images     []string `json:"images"`
	URL        string   `json:"url"`
}

// komikuGetHTML fetches a Komiku page with the browser headers the site expects.
func komikuGetHTML(ctx context.Context, rawURL string) (string, error) {
	resp, err := webclient.Get(ctx, rawURL, map[string]string{
		"accept": "text/html,*/*",
	})
	if err != nil {
		return "", fmt.Errorf("komiku.org gagal diakses: %w", err)
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		resp.Body.Close()
		return "", fmt.Errorf("komiku.org gagal diakses (HTTP %d)", resp.StatusCode)
	}
	return webclient.ReadBody(resp)
}

// parseFlatJSObject parses a flat JavaScript object literal (plain keys,
// single-quoted strings) into a map. Nested objects are not supported, which is
// enough for the mangaData/chapterData blocks on komiku.org.
func parseFlatJSObject(input string) map[string]any {
	result := make(map[string]any)
	for _, match := range flatJSObjectRe.FindAllStringSubmatchIndex(input, -1) {
		key := input[match[2]:match[3]]
		var value any
		switch {
		case match[4] >= 0:
			raw := input[match[4]:match[5]]
			raw = strings.ReplaceAll(raw, `\/`, "/")
			raw = strings.ReplaceAll(raw, `\"`, `"`)
			raw = strings.ReplaceAll(raw, `\\`, `\`)
			value = raw
		case match[6] >= 0:
			raw := input[match[6]:match[7]]
			raw = strings.ReplaceAll(raw, `\/`, "/")
			raw = strings.ReplaceAll(raw, `\'`, "'")
			value = raw
		case match[8] >= 0:
			number, err := strconv.ParseFloat(input[match[8]:match[9]], 64)
			if err != nil {
				// JavaScript would yield NaN, which serializes to null.
				value = nil
			} else {
				value = number
			}
		default:
			switch input[match[10]:match[11]] {
			case "true":
				value = true
			case "false":
				value = false
			default:
				value = nil
			}
		}
		result[key] = value
	}
	return result
}

// scriptText concatenates the inline script bodies of a page, mirroring the
// cheerio implementation that reads every <script> content.
func scriptText(root *html.Node) string {
	var builder strings.Builder
	for _, script := range htmlx.Find(root, "script", "", "") {
		builder.WriteString(htmlx.RawText(script))
	}
	return builder.String()
}

// getJSONVar extracts and parses a flat `var name={...};` block from the page.
func getJSONVar(root *html.Node, name string) map[string]any {
	pattern := mangaDataRe
	if name == "chapterData" {
		pattern = chapterDataRe
	}
	match := pattern.FindStringSubmatch(scriptText(root))
	if match == nil {
		return nil
	}
	return parseFlatJSObject(match[1])
}

// absURL prefixes root-relative Komiku paths and returns nil for empty input.
func absURL(path string) any {
	if path == "" {
		return nil
	}
	if strings.HasPrefix(path, "http") {
		return path
	}
	return komikuHost + path
}

// slugOf extracts the manga slug from a permalink.
func slugOf(rawURL string) any {
	match := mangaSlugRe.FindStringSubmatch(rawURL)
	if match == nil {
		return nil
	}
	return match[1]
}

// firstNodeByTag returns the first h3 or h4 below root in document order.
func firstNodeByTag(root *html.Node, tags ...string) *html.Node {
	if root == nil {
		return nil
	}
	var found *html.Node
	htmlx.Walk(root, func(node *html.Node) {
		if found != nil || node.Type != html.ElementNode {
			return
		}
		for _, tag := range tags {
			if strings.EqualFold(node.Data, tag) {
				found = node
				return
			}
		}
	})
	return found
}

// firstNodeByClass returns the first node carrying any of the classes.
func firstNodeByClass(root *html.Node, classes ...string) *html.Node {
	if root == nil {
		return nil
	}
	var found *html.Node
	htmlx.Walk(root, func(node *html.Node) {
		if found != nil || node.Type != html.ElementNode {
			return
		}
		for _, class := range classes {
			if htmlx.HasClass(node, class) {
				found = node
				return
			}
		}
	})
	return found
}

// childElements returns the direct element children matching tag ("" = any).
func childElements(node *html.Node, tag string) []*html.Node {
	if node == nil {
		return nil
	}
	var children []*html.Node
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		if child.Type != html.ElementNode {
			continue
		}
		if tag != "" && !strings.EqualFold(child.Data, tag) {
			continue
		}
		children = append(children, child)
	}
	return children
}

// hasNextPage reports whether the listing HTML links to a further page.
func hasNextPage(document string) bool {
	return komikuPageRe.MatchString(document) || komikuPageQueryRe.MatchString(document)
}

// parseBgeList parses the `.bge` listing cards.
func parseBgeList(root *html.Node) []komikuListing {
	items := make([]komikuListing, 0)
	for _, card := range htmlx.Find(root, "div", "bge", "") {
		item := komikuListing{Chapters: komikuListingChapters{}}

		mainHref := ""
		var mainAnchor *html.Node
		for _, kan := range htmlx.Find(card, "", "kan", "") {
			for _, anchor := range childElements(kan, "a") {
				if htmlx.First(anchor, "h3", "", "") == nil {
					continue
				}
				mainHref = htmlx.Attr(anchor, "href")
				mainAnchor = anchor
				break
			}
			if mainAnchor != nil {
				break
			}
		}
		item.Slug = slugOf(mainHref)
		item.URL = absURL(mainHref)
		if mainAnchor != nil {
			item.Title = strings.TrimSpace(htmlx.RawText(htmlx.First(mainAnchor, "h3", "", "")))
		}

		if coverBox := htmlx.First(card, "", "bgei", ""); coverBox != nil {
			if img := htmlx.First(coverBox, "img", "", ""); img != nil {
				item.Cover = firstTruthy(attrValue(img, "src"))
			}
		}

		typeText := ""
		if typeNode := htmlx.First(card, "", "tpe1_inf", ""); typeNode != nil {
			typeText = collapseText(typeNode)
		}
		fields := strings.Fields(typeText)
		if len(fields) > 0 {
			item.Type = fields[0]
			if len(fields) > 1 {
				item.Theme = strings.Join(fields[1:], " ")
			}
		}

		syncText := ""
		for _, kan := range htmlx.Find(card, "", "kan", "") {
			if node := htmlx.First(kan, "", "judul2", ""); node != nil {
				syncText = collapseText(node)
				break
			}
		}
		if match := komikuReadersRe.FindStringSubmatch(syncText); match != nil {
			item.Readers = match[1]
		}

		for _, kan := range htmlx.Find(card, "", "kan", "") {
			for _, paragraph := range childElements(kan, "p") {
				if text := strings.TrimSpace(htmlx.RawText(paragraph)); text != "" {
					item.Synopsis = text
				}
				break
			}
			break
		}

		for _, kan := range htmlx.Find(card, "", "kan", "") {
			for _, chapterNode := range htmlx.Find(kan, "", "new1", "") {
				anchor := htmlx.First(chapterNode, "a", "", "")
				if anchor == nil {
					continue
				}
				spans := htmlx.Find(anchor, "span", "", "")
				if len(spans) == 0 {
					continue
				}
				label := strings.ToLower(komikuLabelStripRe.ReplaceAllString(htmlx.RawText(spans[0]), ""))
				chapterTitle := strings.TrimSpace(htmlx.RawText(spans[len(spans)-1]))
				ref := &komikuChapterRef{Title: chapterTitle, URL: absURL(htmlx.Attr(anchor, "href"))}
				switch label {
				case "awal":
					item.Chapters.First = ref
				case "terbaru":
					item.Chapters.Latest = ref
				}
			}
		}

		items = append(items, item)
	}
	return items
}

// parseLisCards collects the home page cards of one section.
func parseLisCards(root *html.Node, sectionID, articleClass string) []komikuHomeCard {
	cards := make([]komikuHomeCard, 0)
	section := htmlx.First(root, "", "", sectionID)
	if section == nil {
		return cards
	}
	for _, article := range htmlx.Find(section, "article", articleClass, "") {
		card := komikuHomeCard{}
		var href string
		for _, anchor := range htmlx.Find(article, "a", "", "") {
			if candidate := htmlx.Attr(anchor, "href"); strings.HasPrefix(candidate, "/manga/") {
				href = candidate
				break
			}
		}
		card.Slug = slugOf(href)
		card.URL = absURL(href)
		if title := firstNodeByTag(article, "h3", "h4"); title != nil {
			card.Title = strings.TrimSpace(htmlx.RawText(title))
		}
		if img := htmlx.First(article, "img", "", ""); img != nil {
			card.Cover = firstTruthy(attrValue(img, "data-src"), attrValue(img, "src"))
		}
		if meta := firstNodeByClass(article, "ls2t", "ls4s"); meta != nil {
			card.Meta = orNull(collapseText(meta))
		}
		if latest := firstNodeByClass(article, "ls2l", "ls24"); latest != nil {
			card.LatestChapter = orNull(strings.TrimSpace(htmlx.RawText(latest)))
		}
		if rankNode := htmlx.First(article, "", "rank-num", ""); rankNode != nil {
			if text := strings.TrimSpace(htmlx.RawText(rankNode)); text != "" {
				if rank, err := strconv.ParseFloat(text, 64); err == nil {
					card.Rank = rank
				}
			}
		}
		cards = append(cards, card)
	}
	return cards
}

// fetchKomikuHome scrapes the server-rendered home page sections.
func fetchKomikuHome(ctx context.Context) (*komikuHomeResponse, error) {
	document, err := komikuGetHTML(ctx, komikuHost+"/")
	if err != nil {
		return nil, err
	}
	root, err := htmlx.Parse(document)
	if err != nil {
		return nil, fmt.Errorf("gagal memparse halaman komiku.org: %w", err)
	}
	return &komikuHomeResponse{
		Success: true,
		Source:  "komiku.org",
		Ranking: komikuRanking{
			Mingguan: parseLisCards(root, "rank-mingguan", "ls4"),
			Harian:   parseLisCards(root, "rank-harian", "ls4"),
		},
		Populer:         parseLisCards(root, "ls12-populer", "ls2"),
		Terbaru:         parseLisCards(root, "Terbaru", "ls2"),
		BaruDitambahkan: parseLisCards(root, "Baru_Ditambahkan", "ls2"),
	}, nil
}

// komikuPustakaURL builds the internal listing URL with ordered query params.
func komikuPustakaURL(tipe, orderby, genre, genre2, status string, page int) string {
	pairs := make([]string, 0, 5)
	appendPair := func(key, value string) {
		if value == "" {
			return
		}
		pairs = append(pairs, url.QueryEscape(key)+"="+url.QueryEscape(value))
	}
	appendPair("tipe", tipe)
	appendPair("orderby", orderby)
	appendPair("genre", genre)
	appendPair("genre2", genre2)
	appendPair("status", status)

	path := komikuAPI + "/manga"
	if page > 1 {
		path += fmt.Sprintf("/page/%d", page)
	}
	path += "/"
	if len(pairs) > 0 {
		path += "?" + strings.Join(pairs, "&")
	}
	return path
}

// fetchKomikuPustaka scrapes the filtered library listing.
func fetchKomikuPustaka(ctx context.Context, tipe, orderby, genre, genre2, status string, page int) (*komikuPustakaResponse, error) {
	document, err := komikuGetHTML(ctx, komikuPustakaURL(tipe, orderby, genre, genre2, status, page))
	if err != nil {
		return nil, err
	}
	root, err := htmlx.Parse(document)
	if err != nil {
		return nil, fmt.Errorf("gagal memparse halaman komiku.org: %w", err)
	}
	label := tipe
	if label == "" {
		label = "semua"
	}
	return &komikuPustakaResponse{
		Success: true,
		Source:  "komiku.org",
		Tipe:    label,
		Page:    page,
		HasNext: hasNextPage(document),
		Results: parseBgeList(root),
	}, nil
}

// chapterLinkTitle returns the label of the .linkbutt anchor pointing at href.
func chapterLinkTitle(root *html.Node, href string) string {
	for _, container := range htmlx.Find(root, "", "linkbutt", "") {
		for _, anchor := range htmlx.Find(container, "a", "", "") {
			if htmlx.Attr(anchor, "href") != href || !strings.Contains(href, "-chapter-") {
				continue
			}
			spans := htmlx.Find(anchor, "span", "", "")
			if len(spans) == 0 {
				return ""
			}
			return strings.TrimSpace(htmlx.RawText(spans[len(spans)-1]))
		}
	}
	return ""
}

// fetchKomikuDetail scrapes one comic detail page.
func fetchKomikuDetail(ctx context.Context, slug string) (*komikuDetailResponse, error) {
	pageURL := komikuHost + "/manga/" + slug + "/"
	document, err := komikuGetHTML(ctx, pageURL)
	if err != nil {
		return nil, err
	}
	root, err := htmlx.Parse(document)
	if err != nil {
		return nil, fmt.Errorf("gagal memparse halaman komiku.org: %w", err)
	}

	var id any
	if mangaJSON := getJSONVar(root, "mangaData"); mangaJSON != nil {
		id = mangaJSON["id"]
	}
	if id == nil {
		if match := mangaIDRe.FindStringSubmatch(document); match != nil {
			id = match[1]
		}
	}
	if id != nil {
		id = jsString(id)
	}

	info := make(map[string]string)
	if scope := htmlx.First(root, "", "", "Informasi"); scope != nil {
		for _, table := range htmlx.Find(scope, "", "inftable", "") {
			for _, row := range htmlx.Find(table, "tr", "", "") {
				cells := htmlx.Find(row, "td", "", "")
				if len(cells) < 2 {
					continue
				}
				label := strings.TrimSpace(strings.Replace(htmlx.RawText(cells[0]), ":", "", 1))
				if label == "" {
					continue
				}
				info[label] = collapseText(cells[1])
			}
		}
	}

	genre := make([]komikuGenreTag, 0)
	if scope := htmlx.First(root, "", "", "Informasi"); scope != nil {
		for _, item := range htmlx.Find(scope, "li", "genre", "") {
			anchor := htmlx.First(item, "a", "", "")
			if anchor == nil {
				continue
			}
			href := strings.ReplaceAll(htmlx.Attr(anchor, "href"), "/genre/", "")
			genre = append(genre, komikuGenreTag{
				Slug: strings.TrimSuffix(href, "/"),
				Name: strings.TrimSpace(htmlx.RawText(anchor)),
			})
		}
	}

	chapters := make([]komikuChapterItem, 0)
	if scope := htmlx.First(root, "", "", "Daftar_Chapter"); scope != nil {
		for _, body := range htmlx.Find(scope, "tbody", "", "") {
			for _, row := range htmlx.Find(body, "tr", "", "") {
				cell := htmlx.First(row, "td", "judulseries", "")
				anchor := htmlx.First(cell, "a", "", "")
				href := htmlx.Attr(anchor, "href")
				if !strings.Contains(href, "-chapter-") {
					continue
				}
				dateCell := htmlx.First(row, "td", "tanggalseries", "")
				chapters = append(chapters, komikuChapterItem{
					URL:   absURL(href),
					Title: strings.TrimSpace(htmlx.RawText(anchor)),
					Date:  orNull(strings.TrimSpace(htmlx.RawText(dateCell))),
				})
			}
		}
	}

	related := make([]komikuRelated, 0)
	for _, block := range htmlx.Find(root, "", "grd", "") {
		var href string
		for _, anchor := range htmlx.Find(block, "a", "", "") {
			if candidate := htmlx.Attr(anchor, "href"); strings.HasPrefix(candidate, "/manga/") {
				href = candidate
				break
			}
		}
		if href == "" {
			continue
		}
		related = append(related, komikuRelated{
			Slug:  slugOf(href),
			Title: strings.TrimSpace(htmlx.RawText(htmlx.First(block, "", "h4", ""))),
			URL:   absURL(href),
		})
	}

	var firstChapter, latestChapter *komikuChapterRef
	var firstHref, latestHref string
	for _, container := range htmlx.Find(root, "", "linkbutt", "") {
		for _, anchor := range htmlx.Find(container, "a", "", "") {
			href := htmlx.Attr(anchor, "href")
			if !strings.Contains(href, "-chapter-") {
				continue
			}
			text := strings.TrimSpace(htmlx.RawText(anchor))
			if firstHref == "" && strings.Contains(strings.ToLower(text), "awal") {
				firstHref = href
			}
			if latestHref == "" && strings.Contains(strings.ToLower(text), "terbaru") {
				latestHref = href
			}
		}
	}
	if firstHref != "" {
		firstChapter = &komikuChapterRef{Title: chapterLinkTitle(root, firstHref), URL: absURL(firstHref)}
	}
	if latestHref != "" {
		latestChapter = &komikuChapterRef{Title: chapterLinkTitle(root, latestHref), URL: absURL(latestHref)}
	}

	var synopsis any
	if description := htmlx.First(root, "p", "desc", ""); description != nil {
		synopsis = orNull(collapseText(description))
	}

	return &komikuDetailResponse{
		Success:          true,
		Source:           "komiku.org",
		ID:               id,
		Slug:             slug,
		Title:            orNull(info["Judul"]),
		AlternativeTitle: orNull(info["Judul Alternatif"]),
		Type:             orNull(info["Tipe"]),
		Theme:            orNull(info["Tema"]),
		Genre:            genre,
		Author:           orNull(info["Author"]),
		Rating:           orNull(info["Rating"]),
		Readers:          orNull(info["Pembaca"]),
		ReadingDirection: orNull(info["Cara Baca"]),
		Synopsis:         synopsis,
		Chapters: komikuDetailChapters{
			Count:  len(chapters),
			First:  firstChapter,
			Latest: latestChapter,
			List:   chapters,
		},
		Related: related,
		URL:     pageURL,
	}, nil
}

// komikuChapterURL normalises a chapter permalink into an absolute URL.
func komikuChapterURL(permalink string) string {
	path := strings.TrimSpace(permalink)
	if strings.HasPrefix(path, "http") {
		if parsed, err := url.Parse(path); err == nil && parsed.Path != "" {
			path = parsed.Path
		}
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	return komikuHost + path
}

// fetchKomikuChapter scrapes one reader page and its image links.
func fetchKomikuChapter(ctx context.Context, permalink string) (*komikuChapterResponse, error) {
	pageURL := komikuChapterURL(permalink)
	document, err := komikuGetHTML(ctx, pageURL)
	if err != nil {
		return nil, err
	}
	root, err := htmlx.Parse(document)
	if err != nil {
		return nil, fmt.Errorf("gagal memparse halaman komiku.org: %w", err)
	}

	chapterData := getJSONVar(root, "chapterData")
	if chapterData == nil {
		chapterData = map[string]any{}
	}

	images := make([]string, 0)
	if scope := htmlx.First(root, "", "", "Baca_Komik"); scope != nil {
		for _, img := range htmlx.Find(scope, "img", "", "") {
			src := htmlx.Attr(img, "src")
			if src == "" || strings.Contains(strings.ToLower(src), "komiku-promosi") || strings.Contains(strings.ToLower(src), "komikuplus2") {
				continue
			}
			images = append(images, src)
		}
	}

	var seriesURL any
	if link, ok := chapterData["link_series"]; ok && link != nil {
		if text, ok := link.(string); ok && text != "" {
			seriesURL = absURL(text)
		}
	}
	if seriesURL == nil {
		if scope := htmlx.First(root, "", "", "Judul"); scope != nil {
			for _, anchor := range htmlx.Find(scope, "a", "", "") {
				if href := htmlx.Attr(anchor, "href"); strings.HasPrefix(href, "/manga/") {
					seriesURL = absURL(href)
					break
				}
			}
		}
	}

	var imageCount any
	if value, ok := chapterData["jumlahgambar"]; ok {
		if _, isNumber := value.(float64); isNumber {
			imageCount = value
		}
	}

	return &komikuChapterResponse{
		Success:    true,
		Source:     "komiku.org",
		ID:         chapterData["id"],
		SeriesID:   chapterData["idseries"],
		Series:     orNull(chapterData["series"]),
		Chapter:    orNull(chapterData["chapter"]),
		ImageCount: imageCount,
		Thumbnail:  orNull(chapterData["thumbnail"]),
		HasNext:    chapterData["hasNext"],
		SeriesURL:  seriesURL,
		Images:     images,
		URL:        pageURL,
	}, nil
}

// fetchKomikuGenreList reads the genre filter options from the library page.
func fetchKomikuGenreList(ctx context.Context) ([]komikuGenreTag, error) {
	document, err := komikuGetHTML(ctx, komikuHost+"/pustaka/")
	if err != nil {
		return nil, err
	}
	root, err := htmlx.Parse(document)
	if err != nil {
		return nil, fmt.Errorf("gagal memparse halaman komiku.org: %w", err)
	}
	genres := make([]komikuGenreTag, 0)
	for _, selectNode := range htmlx.Find(root, "select", "", "") {
		if htmlx.Attr(selectNode, "name") != "genre" {
			continue
		}
		for _, option := range htmlx.Find(selectNode, "option", "", "") {
			value := htmlx.Attr(option, "value")
			if value == "" {
				continue
			}
			name := komikuGenreCountRe.ReplaceAllString(strings.TrimSpace(htmlx.RawText(option)), "")
			genres = append(genres, komikuGenreTag{Slug: value, Name: name})
		}
	}
	return genres, nil
}

// fetchKomikuGenre scrapes a genre listing (plus the genre list on page 1).
func fetchKomikuGenre(ctx context.Context, slug string, page int) (*komikuGenreResponse, error) {
	pageURL := komikuAPI + "/genre/" + slug
	if page > 1 {
		pageURL += fmt.Sprintf("/page/%d", page)
	}
	pageURL += "/"

	document, err := komikuGetHTML(ctx, pageURL)
	if err != nil {
		return nil, err
	}
	root, err := htmlx.Parse(document)
	if err != nil {
		return nil, fmt.Errorf("gagal memparse halaman komiku.org: %w", err)
	}

	genres := make([]komikuGenreTag, 0)
	if page == 1 {
		genres, err = fetchKomikuGenreList(ctx)
		if err != nil {
			return nil, err
		}
	}

	return &komikuGenreResponse{
		Success: true,
		Source:  "komiku.org",
		Genre:   slug,
		Page:    page,
		HasNext: hasNextPage(document),
		Genres:  genres,
		Results: parseBgeList(root),
	}, nil
}

// fetchKomikuSearch searches the internal WordPress endpoint.
func fetchKomikuSearch(ctx context.Context, query string, page int) (*komikuSearchResponse, error) {
	pairs := []string{
		"post_type=manga",
		"s=" + url.QueryEscape(query),
	}
	if page > 1 {
		pairs = append(pairs, "page="+strconv.Itoa(page))
	}
	document, err := komikuGetHTML(ctx, komikuAPI+"/?"+strings.Join(pairs, "&"))
	if err != nil {
		return nil, err
	}
	root, err := htmlx.Parse(document)
	if err != nil {
		return nil, fmt.Errorf("gagal memparse halaman komiku.org: %w", err)
	}
	return &komikuSearchResponse{
		Success: true,
		Source:  "komiku.org",
		Query:   query,
		Page:    page,
		HasNext: hasNextPage(document),
		Results: parseBgeList(root),
	}, nil
}
