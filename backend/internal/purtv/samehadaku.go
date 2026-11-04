package purtv

import (
	"context"
	"encoding/json"
	"fmt"

	"strings"

	"github.com/purujawa06-bot/na-api/backend/internal/htmlx"
)

// shCard is a samehadaku listing card returned by the scraper-web proxy.
type shCard struct {
	Title     *string `json:"title"`
	Thumbnail *string `json:"thumbnail"`
	URL       *string `json:"url"`
	Type      *string `json:"type"`
	Status    *string `json:"status"`
	Episode   *string `json:"episode"`
}

// shHomepage is one `.post-show ul li` entry.
type shHomepage struct {
	Title     *string `json:"title"`
	URL       *string `json:"url"`
	Thumbnail *string `json:"thumbnail"`
	Episode   *string `json:"episode"`
	Author    *string `json:"author"`
	Released  *string `json:"released"`
}

// shPopularAnime is one `.topten-animesu ul li` entry, passed through as-is.
type shPopularAnime struct {
	Title     *string `json:"title"`
	Thumbnail *string `json:"thumbnail"`
	URL       *string `json:"url"`
	Rating    *string `json:"rating"`
	Rank      *string `json:"rank"`
}

// shHomeResult is the normalised samehadaku home payload.
type shHomeResult struct {
	Homepage     []shHomepage
	PopularAnime []shPopularAnime
	Error        string
}

// shSearchResult is a paginated samehadaku listing result.
type shSearchResult struct {
	Results []shCard
	HasNext bool
	Error   string
}

// shDetailEpisode is one entry of the samehadaku episode list.
type shDetailEpisode struct {
	Title  *string `json:"title"`
	Number *string `json:"number"`
	URL    *string `json:"url"`
}

// shDetailResult is the normalised samehadaku series payload.
type shDetailResult struct {
	Title    *string
	Slug     string
	Poster   *string
	Rating   *string
	Synopsis *string
	Genres   []string
	Info     map[string]string
	Episodes []shDetailEpisode
	Error    string
}

// shServer is one admin-ajax player entry.
type shServer struct {
	Name *string
	Post *string
	Nume *string
	Type *string
}

// shDownloadQuality groups download links by quality.
type shDownloadQuality struct {
	Quality *string
	Links   []downloadLink
}

// shDownloadGroup wraps the quality list exactly like the JS download mapping.
type shDownloadGroup struct {
	Qualities []shDownloadQuality
}

// shEpisodeResult is the normalised samehadaku episode payload.
type shEpisodeResult struct {
	Title         *string
	Thumbnail     *string
	Servers       []shServer
	Downloads     []shDownloadGroup
	PrevURL       *string
	NextURL       *string
	AllEpisodes   *string
	AnimeTitle    *string
	AnimeURL      *string
	AnimePoster   *string
	AnimeSynopsis *string
	Error         string
}

// decodeInto extracts one scraper-web key into T, ignoring missing values.
func decodeInto[T any](raw map[string]json.RawMessage, key string) T {
	value, _ := decodeField[T](raw, key)
	return value
}

// mapSamehadakuCard normalises a raw card and resolves relative URLs.
func mapSamehadakuCard(raw shCard) samehadakuResult {
	return samehadakuResult{
		Title:     raw.Title,
		Thumbnail: absSamehadaku(deref(raw.Thumbnail)),
		URL:       absSamehadaku(deref(raw.URL)),
		Slug:      stringPtrOrNil(slugOf(deref(raw.URL))),
		Type:      raw.Type,
		Status:    raw.Status,
		Episode:   raw.Episode,
	}
}

// deref returns the pointed-to string or "" for nil.
func deref(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

// stringPtrOrNil turns an empty slug into nil so it serialises as null.
func stringPtrOrNil(value string) *string {
	if value == "" {
		return nil
	}
	return stringPtr(value)
}

// slugOf extracts the last path segment of a URL (nil when absent).
func slugOf(rawURL string) string {
	if rawURL == "" {
		return ""
	}
	trimmed := strings.TrimRight(rawURL, "/")
	index := strings.LastIndex(trimmed, "/")
	if index < 0 || index == len(trimmed)-1 {
		return ""
	}
	return trimmed[index+1:]
}

// searchListing fetches a samehadaku listing page via cloudscraper and parses it natively.
func (c *client) searchListing(ctx context.Context, pageURL, _ string) shSearchResult {
	body, err := c.samehadakuHTML(ctx, pageURL)
	if err != nil {
		return shSearchResult{Results: []shCard{}, Error: err.Error()}
	}
	doc, err := htmlx.Parse(body)
	if err != nil {
		return shSearchResult{Results: []shCard{}, Error: "parse: " + err.Error()}
	}
	return shSearchResult{Results: parseSamehadakuCards(doc), HasNext: hasNextSamehadaku(doc)}
}

// fetchSamehadakuSearchPage searches anime by keyword.
func (c *client) fetchSamehadakuSearchPage(ctx context.Context, query string, page int) shSearchResult {
	if query == "" {
		return shSearchResult{Error: "Parameter q wajib diisi"}
	}
	pageURL := samehadakuHost + "/?s=" + encodeURIComponent(query)
	if page > 1 {
		pageURL = fmt.Sprintf("%s/page/%d/?s=%s", samehadakuHost, page, encodeURIComponent(query))
	}
	return c.searchListing(ctx, pageURL, "$('.pagination .next').length > 0")
}

// fetchSamehadakuAnimeList lists all anime (no genre filter).
func (c *client) fetchSamehadakuAnimeList(ctx context.Context, page int) shSearchResult {
	pageURL := samehadakuHost + "/anime/"
	if page > 1 {
		pageURL = fmt.Sprintf("%s/anime/page/%d/", samehadakuHost, page)
	}
	return c.searchListing(ctx, pageURL, "$('.pagination .next').length > 0 || $('.pagination .arrow_pag').length > 0")
}

// fetchSamehadakuGenrePage lists anime filtered by genre slug.
func (c *client) fetchSamehadakuGenrePage(ctx context.Context, slug string, page int) shSearchResult {
	if slug == "" {
		return shSearchResult{Error: "Parameter slug wajib diisi"}
	}
	pageURL := fmt.Sprintf("%s/genre/%s/?order=latest", samehadakuHost, slug)
	if page > 1 {
		pageURL = fmt.Sprintf("%s/genre/%s/page/%d/?order=latest", samehadakuHost, slug, page)
	}
	return c.searchListing(ctx, pageURL, "$('.pagination .arrow_pag').length > 0")
}

// fetchSamehadakuDetail loads a series page (`/anime/<slug>/`).

// decodeIntoStruct decodes selected keys of a scraper-web response into target.
func decodeIntoStruct(raw map[string]json.RawMessage, target any) {
	encoded, err := json.Marshal(raw)
	if err != nil {
		return
	}
	_ = json.Unmarshal(encoded, target)
}
