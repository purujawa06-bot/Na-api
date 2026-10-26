package purtv

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"

	"golang.org/x/net/html"

	"github.com/purujawa06-bot/na-api/backend/internal/htmlx"
)

// thumbRef pairs a title with its poster so ongoing rows can borrow the
// artwork of a matching card.
type thumbRef struct {
	title     string
	thumbnail *string
}

// recommendRanges lists the popular ranking tabs shown on the homepage.
var recommendRanges = []struct {
	id   string
	name string
}{
	{id: "weekly", name: "Weekly"},
	{id: "monthly", name: "Monthly"},
	{id: "alltime", name: "All"},
}

// home builds the merged PurTV homepage. Anichin failures degrade to empty
// donghua sections instead of failing the request.
func (c *client) home(ctx context.Context) (*homeResponse, error) {
	var (
		waitGroup sync.WaitGroup
		doc       *html.Node
		anime     shHomeResult
	)
	waitGroup.Add(2)
	go func() {
		defer waitGroup.Done()
		body, err := c.anichinHTML(ctx, anichinHost+"/")
		if err != nil {
			return
		}
		parsed, parseErr := htmlx.Parse(body)
		if parseErr == nil {
			doc = parsed
		}
	}()
	go func() {
		defer waitGroup.Done()
		anime = c.fetchSamehadakuHome(ctx)
	}()
	waitGroup.Wait()

	hotCards := []card{}
	for _, box := range findClass(doc, "", "bixbox") {
		if len(htmlx.Find(box, "", "releases hothome", "")) == 0 {
			continue
		}
		for _, listupd := range findClass(box, "", "listupd") {
			for _, article := range findClass(listupd, "article", "bs") {
				hotCards = append(hotCards, parseAnichinCard(article))
			}
		}
	}

	latestReleases := []card{}
	for _, listupd := range findClass(doc, "", "listupd normal") {
		for _, article := range findClass(listupd, "article", "bs") {
			latestReleases = append(latestReleases, parseAnichinCard(article))
		}
	}

	featuredSlider := make([]featuredItem, 0, len(hotCards))
	for _, entry := range hotCards {
		featuredSlider = append(featuredSlider, featuredItem{
			Title:       entry.Title,
			Thumbnail:   entry.Thumbnail,
			URL:         entry.URL,
			Description: nil,
		})
	}

	recommend := recommendations{
		Genres: make([]genreRef, 0, len(recommendRanges)),
		Items:  make([]recommendGroup, 0, len(recommendRanges)),
	}
	thumbnailPool := make([]thumbRef, 0, len(hotCards)+len(latestReleases))
	for _, entry := range hotCards {
		thumbnailPool = append(thumbnailPool, thumbRef{title: deref(entry.Title), thumbnail: entry.Thumbnail})
	}
	for _, entry := range latestReleases {
		thumbnailPool = append(thumbnailPool, thumbRef{title: deref(entry.Title), thumbnail: entry.Thumbnail})
	}
	for _, current := range recommendRanges {
		recommend.Genres = append(recommend.Genres, genreRef{ID: current.id, Name: current.name})
		items := []popularItem{}
		for _, list := range findClass(doc, "", "serieslist pop wpop-"+current.id) {
			for _, entry := range findClass(list, "li", "") {
				items = append(items, parsePopular(entry))
			}
		}
		for _, entry := range items {
			thumbnailPool = append(thumbnailPool, thumbRef{title: deref(entry.Title), thumbnail: entry.Thumbnail})
		}
		recommend.Items = append(recommend.Items, recommendGroup{ID: current.id, List: items})
	}

	ongoing := []ongoingItem{}
	for _, container := range findClass(doc, "", "ongoingseries") {
		for _, list := range findClass(container, "ul", "") {
			for _, entry := range findClass(list, "li", "") {
				title := text(firstClass(entry, "", "l"))
				normalised := normaliseTitle(title)
				var thumbnail *string
				if normalised != "" {
					for _, candidate := range thumbnailPool {
						if candidate.thumbnail != nil && strings.Contains(normaliseTitle(candidate.title), normalised) {
							thumbnail = candidate.thumbnail
							break
						}
					}
				}
				ongoing = append(ongoing, ongoingItem{
					Title:     title,
					URL:       absAnichin(htmlx.Attr(firstClass(entry, "a", ""), "href")),
					Episode:   text(firstClass(entry, "", "r")),
					Thumbnail: thumbnail,
					Source:    anichinSource,
				})
			}
		}
	}

	latestAnime := make([]latestAnimeItem, 0, len(anime.Homepage))
	for _, entry := range anime.Homepage {
		var episode *string
		if deref(entry.Episode) != "" {
			episode = stringPtr("Ep " + deref(entry.Episode))
		}
		latestAnime = append(latestAnime, latestAnimeItem{
			Title:     entry.Title,
			Thumbnail: entry.Thumbnail,
			URL:       entry.URL,
			Episode:   episode,
		})
	}

	popularAnime := make([]popularAnimeRaw, 0, len(anime.PopularAnime))
	for _, entry := range anime.PopularAnime {
		popularAnime = append(popularAnime, popularAnimeRaw{
			Title:     entry.Title,
			Thumbnail: entry.Thumbnail,
			URL:       entry.URL,
			Rating:    entry.Rating,
			Rank:      entry.Rank,
		})
	}

	return &homeResponse{
		Source:          purtvSource,
		FeaturedSlider:  featuredSlider,
		PopularToday:    hotCards,
		LatestReleases:  latestReleases,
		Ongoing:         ongoing,
		Recommendations: recommend,
		Anime:           homeAnime{LatestAnime: latestAnime, PopularAnime: popularAnime},
		Pagenation:      newPagenation(1, false),
	}, nil
}

// normaliseTitle lowercases a title and strips punctuation so ongoing rows can
// be matched against the posters collected from the other sections.
func normaliseTitle(value string) string {
	lowered := strings.ToLower(value)
	cleaned := nonTitlePattern.ReplaceAllString(lowered, " ")
	return strings.TrimSpace(whitespacePattern.ReplaceAllString(cleaned, " "))
}

// search merges anichin and samehadaku results for a keyword.
func (c *client) search(ctx context.Context, query string, page int) (*searchResponse, error) {
	pageURL := anichinHost + "/?s=" + encodeURIComponent(query)
	if page > 1 {
		pageURL = fmt.Sprintf("%s/page/%d/?s=%s", anichinHost, page, encodeURIComponent(query))
	}

	var (
		waitGroup  sync.WaitGroup
		donghua    []card
		donghuaHas bool
		donghuaErr error
		anime      shSearchResult
	)
	waitGroup.Add(2)
	go func() {
		defer waitGroup.Done()
		donghua, donghuaHas, donghuaErr = c.listingPage(ctx, pageURL)
	}()
	go func() {
		defer waitGroup.Done()
		anime = c.fetchSamehadakuSearchPage(ctx, query, page)
	}()
	waitGroup.Wait()

	if donghuaErr != nil && !errors.Is(donghuaErr, errAnichinNotFound) {
		return nil, donghuaErr
	}
	if donghuaErr != nil {
		donghua = []card{}
		donghuaHas = false
	}
	if anime.Error != "" {
		anime = shSearchResult{Results: []shCard{}}
	}

	results := make([]any, 0, len(donghua)+len(anime.Results))
	for _, entry := range donghua {
		results = append(results, anichinResult{Source: anichinSource, card: entry})
	}
	for _, entry := range anime.Results {
		mapped := mapSamehadakuCard(entry)
		mapped.Source = samehadakuSource
		results = append(results, mapped)
	}

	hasNext := donghuaHas || anime.HasNext
	return &searchResponse{
		Source:     purtvSource,
		Query:      query,
		Page:       page,
		HasNext:    hasNext,
		Results:    results,
		Pagenation: newPagenation(page, hasNext),
	}, nil
}

// list merges anichin and samehadaku results for a genre (or all anime).
func (c *client) list(ctx context.Context, genre string, page int) (*listResponse, error) {
	parameters := fmt.Sprintf("page=%d", page)
	if genre != "" {
		parameters = "genre%5B%5D=" + encodeURIComponent(genre) + "&" + parameters
	}
	pageURL := anichinHost + "/series/?" + parameters

	var (
		waitGroup  sync.WaitGroup
		donghua    []card
		donghuaHas bool
		donghuaErr error
		anime      shSearchResult
	)
	waitGroup.Add(2)
	go func() {
		defer waitGroup.Done()
		donghua, donghuaHas, donghuaErr = c.listingPage(ctx, pageURL)
	}()
	go func() {
		defer waitGroup.Done()
		if genre != "" {
			anime = c.fetchSamehadakuGenrePage(ctx, genre, page)
			return
		}
		anime = c.fetchSamehadakuAnimeList(ctx, page)
	}()
	waitGroup.Wait()

	if donghuaErr != nil && !errors.Is(donghuaErr, errAnichinNotFound) {
		return nil, donghuaErr
	}
	if donghuaErr != nil {
		donghua = []card{}
		donghuaHas = false
	}
	if anime.Error != "" {
		anime = shSearchResult{Results: []shCard{}}
	}

	results := make([]any, 0, len(donghua)+len(anime.Results))
	for _, entry := range donghua {
		results = append(results, anichinResult{Source: anichinSource, card: entry})
	}
	for _, entry := range anime.Results {
		mapped := mapSamehadakuCard(entry)
		mapped.Source = samehadakuSource
		results = append(results, mapped)
	}

	hasNext := donghuaHas || anime.HasNext
	responseGenre := genre
	if responseGenre == "" {
		responseGenre = "semua"
	}
	return &listResponse{
		Source:     purtvSource,
		Genre:      responseGenre,
		Page:       page,
		HasNext:    hasNext,
		Results:    results,
		Pagenation: newPagenation(page, hasNext),
	}, nil
}

// listingPage parses an anichin search/listing page.
func (c *client) listingPage(ctx context.Context, pageURL string) ([]card, bool, error) {
	body, err := c.anichinHTML(ctx, pageURL)
	if err != nil {
		return nil, false, err
	}
	doc, err := htmlx.Parse(body)
	if err != nil {
		return nil, false, fmt.Errorf("parse anichin page: %w", err)
	}
	entries := []card{}
	for _, list := range findClass(doc, "", "listupd") {
		for _, article := range findClass(list, "article", "bs") {
			entries = append(entries, parseAnichinCard(article))
		}
	}
	return entries, hasNextPage(doc), nil
}

// genres reads the donghua genre dropdown from `/series/`.
func (c *client) genres(ctx context.Context) (*genresResponse, error) {
	body, err := c.anichinHTML(ctx, anichinHost+"/series/")
	if err != nil {
		return nil, err
	}
	doc, err := htmlx.Parse(body)
	if err != nil {
		return nil, fmt.Errorf("parse anichin genres: %w", err)
	}

	entries := []genreItem{}
	dropdown := firstClass(doc, "", "filter dropdown")
	if dropdown != nil {
		if menu := firstClass(dropdown, "", "dropdown-menu"); menu != nil {
			for _, item := range findClass(menu, "li", "") {
				input := firstClass(item, "input", "")
				entries = append(entries, genreItem{
					Name: text(firstClass(item, "label", "")),
					Slug: trimmedPtr(htmlx.Attr(input, "value")),
				})
			}
		}
	}

	return &genresResponse{
		Source:     purtvSource,
		Genres:     entries,
		Pagenation: newPagenation(1, false),
	}, nil
}
