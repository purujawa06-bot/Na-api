package purtv

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
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

// fetchSamehadakuHome loads the samehadaku homepage sections.
func (c *client) fetchSamehadakuHome(ctx context.Context) shHomeResult {
	raw, err := c.scraperWebPost(ctx, samehadakuHost, map[string]string{
		"homepage":     "$('.post-show ul li').map((i, el) => ({ title: $(el).find('.entry-title a').text().trim(), url: $(el).find('.thumb a').attr('href'), thumbnail: $(el).find('.thumb img').attr('src'), episode: 'Ep ' + $(el).find('.dtla span author').first().text().trim(), author: $(el).find('.dtla span[itemprop=author] author').text().trim() || null, released: $(el).find('.dtla').text().replace(/.*released on:\\s*/i, '').trim() || null })).get()",
		"popularAnime": "$('.topten-animesu ul li').map((i, el) => ({ title: $(el).find('.judul').text().trim(), thumbnail: $(el).find('img').attr('src'), url: $(el).find('a').attr('href'), rating: $(el).find('.rating').text().trim(), rank: $(el).find('.is-topten').text().trim() })).get()",
	}, samehadakuSource)
	if err != nil {
		return shHomeResult{Error: err.Error()}
	}

	homepage := decodeInto[[]shHomepage](raw, "homepage")
	normalised := make([]shHomepage, 0, len(homepage))
	for _, entry := range homepage {
		episode := deref(entry.Episode)
		if match := animeEpisodePattern.FindStringSubmatch(episode); match != nil {
			episode = match[1]
		}
		normalised = append(normalised, shHomepage{
			Title:     entry.Title,
			URL:       absSamehadaku(deref(entry.URL)),
			Thumbnail: absSamehadaku(deref(entry.Thumbnail)),
			Episode:   stringPtr(episode),
			Author:    entry.Author,
			Released:  entry.Released,
		})
	}

	return shHomeResult{
		Homepage:     normalised,
		PopularAnime: decodeInto[[]shPopularAnime](raw, "popularAnime"),
	}
}

// searchListing runs the shared `article.animpost` listing selector.
func (c *client) searchListing(ctx context.Context, pageURL, hasNextSelector string) shSearchResult {
	raw, err := c.scraperWebPost(ctx, pageURL, map[string]string{
		"data":        "$('article.animpost').map((i, el) => ({ title: $(el).find('.data .title h2').text().trim(), thumbnail: $(el).find('.content-thumb img').attr('src'), url: $(el).find('a').attr('href'), type: $(el).find('.content-thumb .type').text().trim(), status: $(el).find('.data .type').text().trim(), episode: $(el).find('.score').text().trim() })).get()",
		"hasNextPage": hasNextSelector,
	}, samehadakuSource)
	if err != nil {
		// The JS version swallows scraper failures here and returns an empty page.
		return shSearchResult{Results: []shCard{}}
	}
	cards := decodeInto[[]shCard](raw, "data")
	hasNext := decodeInto[bool](raw, "hasNextPage")
	return shSearchResult{Results: cards, HasNext: hasNext}
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
func (c *client) fetchSamehadakuDetail(ctx context.Context, slug string) shDetailResult {
	if slug == "" {
		return shDetailResult{Error: "Parameter slug wajib diisi"}
	}
	raw, err := c.scraperWebPost(ctx, samehadakuHost+"/anime/"+slug+"/", map[string]string{
		"title":       "$('.entry-header .entry-title').text().replace('Sub Indo', '').trim() || $('.anim-detail').text().replace('Detail Anime ', '').trim()",
		"thumbnail":   "$('.thumb img').attr('src')",
		"rating":      "$('.archiveanime-rating span').first().text().trim() || $('.rating strong').text().replace('Rating', '').trim() || '?'",
		"status":      "$('.spe span:contains(\"Status\")').text().replace('Status', '').trim()",
		"studio":      "$('.spe span:contains(\"Studio\")').text().replace('Studio', '').trim()",
		"updated_on":  "$('.spe span:contains(\"Released\")').text().replace('Released:', '').trim()",
		"type":        "$('.spe span:contains(\"Type\")').text().replace('Type', '').trim()",
		"genres":      "$('.genre-info a').map((i, el) => $(el).text().trim()).get()",
		"synopsis":    "$('.desc .entry-content').text().trim()",
		"episodeList": "$('.lstepsiode.listeps ul li').map((i, el) => ({ title: $(el).find('.lchx a').text().trim(), number: $(el).find('.eps a').text().trim(), url: $(el).find('.lchx a').attr('href') })).get()",
	}, samehadakuSource)
	if err != nil {
		return shDetailResult{Error: err.Error()}
	}

	var detail struct {
		Title       *string           `json:"title"`
		Thumbnail   *string           `json:"thumbnail"`
		Rating      *string           `json:"rating"`
		Status      *string           `json:"status"`
		Studio      *string           `json:"studio"`
		UpdatedOn   *string           `json:"updated_on"`
		Type        *string           `json:"type"`
		Genres      []string          `json:"genres"`
		Synopsis    *string           `json:"synopsis"`
		EpisodeList []shDetailEpisode `json:"episodeList"`
	}
	decodeIntoStruct(raw, &detail)

	info := map[string]string{}
	if detail.Status != nil && *detail.Status != "" {
		info["status"] = *detail.Status
	}
	if detail.Studio != nil && *detail.Studio != "" {
		info["studio"] = *detail.Studio
	}
	if detail.UpdatedOn != nil && *detail.UpdatedOn != "" {
		info["updated_on"] = *detail.UpdatedOn
	}
	if detail.Type != nil && *detail.Type != "" {
		info["type"] = *detail.Type
	}

	episodes := make([]shDetailEpisode, 0, len(detail.EpisodeList))
	for _, episode := range detail.EpisodeList {
		episodes = append(episodes, shDetailEpisode{
			Title:  episode.Title,
			Number: episode.Number,
			URL:    absSamehadaku(deref(episode.URL)),
		})
	}

	return shDetailResult{
		Title:    detail.Title,
		Slug:     slug,
		Poster:   absSamehadaku(deref(detail.Thumbnail)),
		Rating:   detail.Rating,
		Synopsis: detail.Synopsis,
		Genres:   detail.Genres,
		Info:     info,
		Episodes: episodes,
	}
}

// decodeIntoStruct decodes selected keys of a scraper-web response into target.
func decodeIntoStruct(raw map[string]json.RawMessage, target any) {
	encoded, err := json.Marshal(raw)
	if err != nil {
		return
	}
	_ = json.Unmarshal(encoded, target)
}

// fetchSamehadakuEpisode loads an episode page (`/<slug>/`).
func (c *client) fetchSamehadakuEpisode(ctx context.Context, slug string) shEpisodeResult {
	if slug == "" {
		return shEpisodeResult{Error: "Parameter slug wajib diisi"}
	}
	raw, err := c.scraperWebPost(ctx, samehadakuHost+"/"+slug+"/", map[string]string{
		"title":          "$('<div>' + ($('.entry-title').html() || '') + '</div>').text().replace(/\\s*Sub Indo\\s*$/i, '').trim()",
		"thumbnail":      "$('.thumb img').first().attr('src') || $('.infoanime .thumb img').first().attr('src') || null",
		"synopsis":       "$('.desc .entry-content').text().trim() || $('.entry-content').last().text().trim()",
		"series":         "$('#breadcrumbs ol li a span').eq(2).text().trim() || $('.breadcrumb li a span').eq(2).text().trim()",
		"seriesUrl":      "$('#breadcrumbs ol li a').eq(2).attr('href') || $('.breadcrumb li a').eq(2).attr('href')",
		"streamingLinks": "$('#server ul li .east_player_option').map((i, el) => ({ name: $(el).text().trim(), post: $(el).attr('data-post'), nume: $(el).attr('data-nume'), type: $(el).attr('data-type') })).get()",
		"downloadLinks":  "$('.download-eps').map((i, el) => { const cat = $(el).find('p b').text().trim(); return $(el).find('ul li').map((j, li) => ({ quality: (cat + ' ' + $(li).find('strong').text().trim()).trim(), links: $(li).find('span a').map((k, a) => ({ host: $(a).text().trim(), url: $(a).attr('href') })).get() })).get(); }).get().flat()",
		"prevEpisode":    "$('.naveps .nvs a:not(.nonex)').first().attr('href')",
		"allEpisodes":    "$('.naveps .nvsc a').attr('href')",
		"nextEpisode":    "$('.naveps .rght a:not(.nonex)').first().attr('href')",
	}, samehadakuSource)
	if err != nil {
		return shEpisodeResult{Error: err.Error()}
	}

	var episode struct {
		Title          *string `json:"title"`
		Thumbnail      *string `json:"thumbnail"`
		Synopsis       *string `json:"synopsis"`
		Series         *string `json:"series"`
		SeriesURL      *string `json:"seriesUrl"`
		StreamingLinks []struct {
			Name *string `json:"name"`
			Post *string `json:"post"`
			Nume *string `json:"nume"`
			Type *string `json:"type"`
		} `json:"streamingLinks"`
		DownloadLinks []struct {
			Quality *string `json:"quality"`
			Links   []struct {
				Host *string `json:"host"`
				URL  *string `json:"url"`
			} `json:"links"`
		} `json:"downloadLinks"`
		PrevEpisode *string `json:"prevEpisode"`
		AllEpisodes *string `json:"allEpisodes"`
		NextEpisode *string `json:"nextEpisode"`
	}
	decodeIntoStruct(raw, &episode)

	servers := make([]shServer, 0, len(episode.StreamingLinks))
	for _, server := range episode.StreamingLinks {
		servers = append(servers, shServer{
			Name: server.Name,
			Post: server.Post,
			Nume: server.Nume,
			Type: server.Type,
		})
	}

	downloads := []shDownloadGroup{}
	if len(episode.DownloadLinks) > 0 {
		qualities := make([]shDownloadQuality, 0, len(episode.DownloadLinks))
		for _, quality := range episode.DownloadLinks {
			links := make([]downloadLink, 0, len(quality.Links))
			for _, link := range quality.Links {
				links = append(links, downloadLink{Host: link.Host, URL: absSamehadaku(deref(link.URL))})
			}
			qualities = append(qualities, shDownloadQuality{Quality: quality.Quality, Links: links})
		}
		downloads = append(downloads, shDownloadGroup{Qualities: qualities})
	}

	allEpisodes := absSamehadaku(deref(episode.AllEpisodes))
	seriesURL := absSamehadaku(deref(episode.SeriesURL))
	animeURL := seriesURL
	if animeURL == nil {
		animeURL = allEpisodes
	}

	return shEpisodeResult{
		Title:         episode.Title,
		Thumbnail:     absSamehadaku(deref(episode.Thumbnail)),
		Servers:       servers,
		Downloads:     downloads,
		PrevURL:       absSamehadaku(deref(episode.PrevEpisode)),
		NextURL:       absSamehadaku(deref(episode.NextEpisode)),
		AllEpisodes:   allEpisodes,
		AnimeTitle:    episode.Series,
		AnimeURL:      animeURL,
		AnimePoster:   absSamehadaku(deref(episode.Thumbnail)),
		AnimeSynopsis: episode.Synopsis,
	}
}
