package purtv

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"

)

const (
	wibuSupabaseURL = "https://paivcxbhxyytczbpyzla.supabase.co"
	wibuSupabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhaXZjeGJoeHl5dGN6YnB5emxhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1MDM0NjIsImV4cCI6MjEwNTA3OTQ2Mn0.UzXU9_Z8wBj_nE7FVukW1UB64j5mI2CoFKb0dTLssfc"
	wibuSourceName  = "wibutime"
)

type wbAnime struct {
	Slug                  string   `json:"slug"`
	Title                 string   `json:"title"`
	TitleLower            string   `json:"title_lower"`
	Synopsis              *string  `json:"synopsis"`
	PosterURL             *string  `json:"poster_url"`
	Genres                []string `json:"genres"`
	Type                  string   `json:"type"`
	Status                string   `json:"status"`
	Rating                *float64 `json:"rating"`
	Year                  *int     `json:"year"`
	Studio                *string  `json:"studio"`
	TotalEpisodes         *int     `json:"total_episodes"`
	LatestEpisodeNumber   *float64 `json:"latest_episode_number"`
	LatestEpisodeID       *string  `json:"latest_episode_id"`
	LatestEpisodeCreatedAt *string `json:"latest_episode_created_at"`
	CreatedAt             string   `json:"created_at"`
	UpdatedAt             string   `json:"updated_at"`
}

type wbEpisode struct {
	ID                   string            `json:"id"`
	AnimeID              string            `json:"anime_id"`
	EpisodeNumber        int               `json:"episode_number"`
	Title                *string           `json:"title"`
	DurationMinutes      *int              `json:"duration_minutes"`
	ReleasedLabel        *string           `json:"released_label"`
	VideoEmbedURL        *string           `json:"video_embed_url"`
	VideoQualities        map[string]string `json:"video_qualities"`
	VideoQualitiesFallback map[string][]string `json:"video_qualities_fallback"`
	SourceLabel          *string           `json:"source_label"`
	ViewCount            int               `json:"view_count"`
	CreatedAt            string            `json:"created_at"`
}

type wbSchedule struct {
	AnimeID    string `json:"anime_id"`
	DayOfWeek  string `json:"day_of_week"`
	CreatedAt  string `json:"created_at"`
}

// wbFetch uses a straightforward read to avoid the token mistake above.
func (c *client) wbGet(ctx context.Context, path string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, wibuSupabaseURL+path, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("apikey", wibuSupabaseKey)
	req.Header.Set("Authorization", "Bearer "+wibuSupabaseKey)
	req.Header.Set("Accept", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data := make([]byte, 0, 4096)
	tmp := make([]byte, 4096)
	for {
		n, rerr := resp.Body.Read(tmp)
		if n > 0 {
			data = append(data, tmp[:n]...)
		}
		if rerr != nil {
			if rerr.Error() == "EOF" {
				break
			}
			// io.EOF check
			if len(tmp) == 0 {
				break
			}
			// accept any read error as end
			break
		}
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("supabase %s: %s", resp.Status, string(data))
	}
	return data, nil
}

func (c *client) wbAllAnimes(ctx context.Context) ([]wbAnime, error) {
	var all []wbAnime
	for off := 0; ; off += 1000 {
		q := url.Values{}
		q.Set("select", "slug,title,title_lower,synopsis,poster_url,genres,type,status,rating,year,studio,total_episodes,latest_episode_number,latest_episode_id,latest_episode_created_at")
		q.Set("order", "slug.asc")
		q.Set("offset", strconv.Itoa(off))
		q.Set("limit", "1000")
		data, err := c.wbGet(ctx, "/rest/v1/animes?"+q.Encode())
		if err != nil {
			return nil, err
		}
		var rows []wbAnime
		if err := json.Unmarshal(data, &rows); err != nil {
			return nil, err
		}
		all = append(all, rows...)
		if len(rows) < 1000 {
			break
		}
	}
	return all, nil
}

func wibuSource(a wbAnime) string {
	for _, g := range a.Genres {
		if strings.EqualFold(g, "Donghua") {
			return "anichin"
		}
	}
	return "samehadaku"
}

func wibuSeriesURL(a wbAnime) string {
	if wibuSource(a) == "anichin" {
		return "https://wibutime.local/series/" + a.Slug + "/"
	}
	return "https://wibutime.local/anime/" + a.Slug + "/"
}

func wibuEpisodeURL(id string) string {
	return "https://wibutime.local/episode/" + id + "/"
}

func wibuStripSourceMarker() string { return wibuSourceName }

func (c *client) wibuAnimesBySlug(ctx context.Context, slug string) (wbAnime, error) {
	q := url.Values{}
	q.Set("select", "slug,title,title_lower,synopsis,poster_url,genres,type,status,rating,year,studio,total_episodes,latest_episode_number,latest_episode_id,latest_episode_created_at")
	q.Set("slug", "eq."+slug)
	q.Set("limit", "1")
	data, err := c.wbGet(ctx, "/rest/v1/animes?"+q.Encode())
	if err != nil {
		return wbAnime{}, err
	}
	var rows []wbAnime
	if err := json.Unmarshal(data, &rows); err != nil {
		return wbAnime{}, err
	}
	if len(rows) == 0 {
		return wbAnime{}, fmt.Errorf("anime %s tidak ditemukan", slug)
	}
	return rows[0], nil
}

func (c *client) wibuEpisodesByAnime(ctx context.Context, animeID string) ([]wbEpisode, error) {
	q := url.Values{}
	q.Set("select", "*")
	q.Set("anime_id", "eq."+animeID)
	q.Set("order", "episode_number.asc")
	data, err := c.wbGet(ctx, "/rest/v1/episodes?"+q.Encode())
	if err != nil {
		return nil, err
	}
	var rows []wbEpisode
	if err := json.Unmarshal(data, &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

func (c *client) wibuEpisodeByID(ctx context.Context, id string) (wbEpisode, error) {
	q := url.Values{}
	q.Set("select", "*")
	q.Set("id", "eq."+id)
	q.Set("limit", "1")
	data, err := c.wbGet(ctx, "/rest/v1/episodes?"+q.Encode())
	if err != nil {
		return wbEpisode{}, err
	}
	var rows []wbEpisode
	if err := json.Unmarshal(data, &rows); err != nil {
		return wbEpisode{}, err
	}
	if len(rows) == 0 {
		return wbEpisode{}, fmt.Errorf("episode %s tidak ditemukan", id)
	}
	return rows[0], nil
}

func ptrStr(v *string) *string {
	if v == nil {
		return nil
	}
	s := *v
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return &s
}

func strPtr(s string) *string { return &s }

func ptrFloatStr(v *float64) *string {
	if v == nil {
		return nil
	}
	return strPtr(strconv.FormatFloat(*v, 'f', 2, 64))
}

func genresSlice(a wbAnime) []string {
	if a.Genres == nil {
		return []string{}
	}
	return a.Genres
}

func (c *client) genresWibu(ctx context.Context) (*genresResponse, error) {
	all, err := c.wbAllAnimes(ctx)
	if err != nil {
		return nil, err
	}
	set := map[string]bool{}
	for _, a := range all {
		for _, g := range a.Genres {
			if strings.TrimSpace(g) != "" {
				set[g] = true
			}
		}
	}
	var names []string
	for g := range set {
		names = append(names, g)
	}
	sort.Strings(names)
	items := make([]genreItem, 0, len(names))
	for _, g := range names {
		slug := strings.ToLower(strings.ReplaceAll(g, " ", "-"))
		items = append(items, genreItem{Name: g, Slug: strPtr(slug)})
	}
	return &genresResponse{
		Source:     wibuSourceName,
		Genres:     items,
		Pagenation: newPagenation(1, false),
	}, nil
}

func (c *client) listWibu(ctx context.Context, genre string, page int) (*listResponse, error) {
	all, err := c.wbAllAnimes(ctx)
	if err != nil {
		return nil, err
	}
	var filtered []wbAnime
	for _, a := range all {
		if genre == "" {
			filtered = append(filtered, a)
			continue
		}
		for _, g := range a.Genres {
			if strings.EqualFold(g, genre) {
				filtered = append(filtered, a)
				break
			}
		}
	}
	pageSize := 24
	if page < 1 {
		page = 1
	}
	start := (page - 1) * pageSize
	if start > len(filtered) {
		start = len(filtered)
	}
	end := start + pageSize
	if end > len(filtered) {
		end = len(filtered)
	}
	hasNext := end < len(filtered)
	results := make([]any, 0, end-start)
	for _, a := range filtered[start:end] {
		src := wibuSource(a)
		title := a.Title
		results = append(results, anichinResult{
			Source: src,
			card: card{
				Title:     strPtr(title),
				Thumbnail: a.PosterURL,
				URL:       strPtr(wibuSeriesURL(a)),
				Type:      strPtr(a.Type),
				Status:    strPtr(a.Status),
				Episode: func() *string {
					if a.LatestEpisodeNumber != nil {
						s := strconv.Itoa(int(*a.LatestEpisodeNumber))
						return &s
					}
					return nil
				}(),
			},
		})
	}
	return &listResponse{
		Source:     wibuSourceName,
		Genre:      genre,
		Page:       page,
		HasNext:    hasNext,
		Results:    results,
		Pagenation: newPagenation(page, hasNext),
	}, nil
}

func (c *client) searchWibu(ctx context.Context, query string, page int) (*searchResponse, error) {
	all, err := c.wbAllAnimes(ctx)
	if err != nil {
		return nil, err
	}
	qLower := strings.ToLower(strings.TrimSpace(query))
	var filtered []wbAnime
	for _, a := range all {
		if qLower == "" {
			filtered = append(filtered, a)
			continue
		}
		if strings.Contains(strings.ToLower(a.Title), qLower) || strings.Contains(strings.ToLower(a.TitleLower), qLower) || strings.Contains(strings.ToLower(a.Slug), qLower) {
			filtered = append(filtered, a)
		}
	}
	pageSize := 24
	if page < 1 {
		page = 1
	}
	start := (page - 1) * pageSize
	if start > len(filtered) {
		start = len(filtered)
	}
	end := start + pageSize
	if end > len(filtered) {
		end = len(filtered)
	}
	hasNext := end < len(filtered)
	results := make([]any, 0, end-start)
	for _, a := range filtered[start:end] {
		src := wibuSource(a)
		ep := ""
		if a.LatestEpisodeNumber != nil {
			ep = strconv.Itoa(int(*a.LatestEpisodeNumber))
		}
		es := ep
		var epPtr *string
		if ep != "" {
			epPtr = &es
		}
		results = append(results, map[string]any{
			"source":    src,
			"title":     a.Title,
			"thumbnail": a.PosterURL,
			"url":       wibuSeriesURL(a),
			"type":      a.Type,
			"status":    a.Status,
			"episode":   epPtr,
		})
	}
	return &searchResponse{
		Source:     wibuSourceName,
		Query:      query,
		Page:       page,
		HasNext:    hasNext,
		Results:    results,
		Pagenation: newPagenation(page, hasNext),
	}, nil
}

func cardFromAnime(a wbAnime) card {
	ep := ""
	if a.LatestEpisodeNumber != nil {
		ep = strconv.Itoa(int(*a.LatestEpisodeNumber))
	}
	var epPtr *string
	if ep != "" {
		epPtr = &ep
	}
	return card{
		Title:     strPtr(a.Title),
		Thumbnail: a.PosterURL,
		URL:       strPtr(wibuSeriesURL(a)),
		Type:      strPtr(a.Type),
		Status:    strPtr(a.Status),
		Episode:   epPtr,
	}
}

func (c *client) homeWibu(ctx context.Context) (*homeResponse, error) {
	all, err := c.wbAllAnimes(ctx)
	if err != nil {
		return nil, err
	}
	// latest by created_at
	latestAll := append([]wbAnime(nil), all...)
	sort.Slice(latestAll, func(i, j int) bool {
		if latestAll[i].LatestEpisodeCreatedAt == nil || latestAll[j].LatestEpisodeCreatedAt == nil {
			return latestAll[i].CreatedAt > latestAll[j].CreatedAt
		}
		return *latestAll[i].LatestEpisodeCreatedAt > *latestAll[j].LatestEpisodeCreatedAt
	})
	featured := make([]featuredItem, 0, 8)
	latestReleasesCards := make([]card, 0, 8)
	for i, a := range latestAll {
		if i >= 8 {
			break
		}
		fi := featuredItem{
			Title:       strPtr(a.Title),
			Thumbnail:   a.PosterURL,
			URL:         strPtr(wibuSeriesURL(a)),
			Description: a.Synopsis,
		}
		featured = append(featured, fi)
		latestReleasesCards = append(latestReleasesCards, cardFromAnime(a))
	}
	// ongoing
	var ongoing []wbAnime
	for _, a := range all {
		if strings.EqualFold(a.Status, "Ongoing") {
			ongoing = append(ongoing, a)
		}
	}
	if len(ongoing) > 8 {
		ongoing = ongoing[:8]
	}
	ongoingItems := make([]ongoingItem, 0, len(ongoing))
	for _, a := range ongoing {
		src := wibuSource(a)
		ep := ""
		if a.LatestEpisodeNumber != nil {
			ep = strconv.Itoa(int(*a.LatestEpisodeNumber))
		}
		ongoingItems = append(ongoingItems, ongoingItem{
			Title:     a.Title,
			URL:       strPtr(wibuSeriesURL(a)),
			Episode:   ep,
			Thumbnail: a.PosterURL,
			Source:    src,
		})
	}
	// popular today: top rating
	popularAll := append([]wbAnime(nil), all...)
	sort.Slice(popularAll, func(i, j int) bool {
		rI, rJ := 0.0, 0.0
		if popularAll[i].Rating != nil {
			rI = *popularAll[i].Rating
		}
		if popularAll[j].Rating != nil {
			rJ = *popularAll[j].Rating
		}
		return rI > rJ
	})
	popularCards := make([]card, 0, 8)
	for i, a := range popularAll {
		if i >= 8 {
			break
		}
		popularCards = append(popularCards, cardFromAnime(a))
	}

	// anime latest + popular (same as above but keep 6)
	animeLatest := make([]latestAnimeItem, 0, 6)
	for i, a := range latestAll {
		if i >= 6 {
			break
		}
		animeLatest = append(animeLatest, latestAnimeItem{
			Title:     strPtr(a.Title),
			Thumbnail: a.PosterURL,
			URL:       strPtr(wibuSeriesURL(a)),
			Episode: func() *string {
				if a.LatestEpisodeNumber == nil {
					return nil
				}
				s := strconv.Itoa(int(*a.LatestEpisodeNumber))
				return &s
			}(),
		})
	}
	animePopular := make([]popularAnimeRaw, 0, 6)
	for i, a := range popularAll {
		if i >= 6 {
			break
		}
		rank := strconv.Itoa(i + 1)
		rating := ptrFloatStr(a.Rating)
		animePopular = append(animePopular, popularAnimeRaw{
			Title:     strPtr(a.Title),
			Thumbnail: a.PosterURL,
			URL:       strPtr(wibuSeriesURL(a)),
			Rating:    rating,
			Rank:      &rank,
		})
	}

	// recommendations by genre
	genresSet := map[string]bool{}
	for _, a := range all {
		for _, g := range a.Genres {
			if strings.TrimSpace(g) != "" {
				genresSet[g] = true
			}
		}
	}
	var genreNames []string
	for g := range genresSet {
		genreNames = append(genreNames, g)
	}
	sort.Strings(genreNames)
	if len(genreNames) > 8 {
		genreNames = genreNames[:8]
	}
	genreRefs := make([]genreRef, 0, len(genreNames))
	recGroups := make([]recommendGroup, 0, len(genreNames))
	for _, g := range genreNames {
		genreRefs = append(genreRefs, genreRef{ID: g, Name: g})
		var groupItems []popularItem
		count := 0
		for _, a := range popularAll {
			if count >= 4 {
				break
			}
			has := false
			for _, ag := range a.Genres {
				if strings.EqualFold(ag, g) {
					has = true
					break
				}
			}
			if !has {
				continue
			}
			groupItems = append(groupItems, popularItem{
				Title:     strPtr(a.Title),
				URL:       strPtr(wibuSeriesURL(a)),
				Thumbnail: a.PosterURL,
				Genres:    a.Genres,
				Rating:    ptrFloatStr(a.Rating),
			})
			count++
		}
		if groupItems == nil {
			groupItems = []popularItem{}
		}
		recGroups = append(recGroups, recommendGroup{ID: g, List: groupItems})
	}
	if genreRefs == nil {
		genreRefs = []genreRef{}
	}
	if recGroups == nil {
		recGroups = []recommendGroup{}
	}
	return &homeResponse{
		Source:         wibuSourceName,
		FeaturedSlider: featured,
		PopularToday:   popularCards,
		LatestReleases: latestReleasesCards,
		Ongoing:        ongoingItems,
		Recommendations: recommendations{
			Genres: genreRefs,
			Items:  recGroups,
		},
		Anime: homeAnime{
			LatestAnime:  animeLatest,
			PopularAnime: animePopular,
		},
		Pagenation: newPagenation(1, false),
	}, nil
}

func (c *client) seriesWibu(ctx context.Context, rawURL string) (any, error) {
	slug := wibuParseSeriesSlug(rawURL)
	if slug == "" {
		return nil, fmt.Errorf("URL seri wibutime tidak valid")
	}
	a, err := c.wibuAnimesBySlug(ctx, slug)
	if err != nil {
		return nil, err
	}
	eps, err := c.wibuEpisodesByAnime(ctx, a.Slug)
	if err != nil {
		return nil, err
	}
	episodes := make([]seriesEpisode, 0, len(eps))
	for _, e := range eps {
		title := ""
		if e.Title != nil {
			title = *e.Title
		} else if e.EpisodeNumber > 0 {
			title = fmt.Sprintf("Episode %d", e.EpisodeNumber)
		}
		tp := &title
		if title == "" {
			tp = nil
		}
		episodes = append(episodes, seriesEpisode{
			Episode: strPtr(strconv.Itoa(e.EpisodeNumber)),
			Title:   tp,
			URL:     strPtr(wibuEpisodeURL(e.ID)),
		})
	}
	info := map[string]string{}
	if a.Studio != nil {
		info["Studio"] = *a.Studio
	}
	if a.Year != nil {
		info["Year"] = strconv.Itoa(*a.Year)
	}
	if a.Status != "" {
		info["Status"] = a.Status
	}
	if a.Type != "" {
		info["Type"] = a.Type
	}
	if info == nil {
		info = map[string]string{}
	}
	rating := ptrFloatStr(a.Rating)
	if wibuSource(a) == "anichin" {
		return &seriesDonghuaResponse{
			Source:     wibuSourceName,
			Title:      a.Title,
			Poster:     a.PosterURL,
			Rating:     rating,
			Genres:     genresSlice(a),
			Synopsis:   a.Synopsis,
			Info:       info,
			Episodes:   episodes,
			Pagenation: newPagenation(1, false),
		}, nil
	}

	return &seriesAnimeResponse{
		Source:     wibuSourceName,
		Title:      strPtr(a.Title),
		Genres:     genresSlice(a),
		Synopsis:   a.Synopsis,
		Info:       info,
		Episodes:   episodes,
		Poster:     a.PosterURL,
		Rating:     rating,
		Pagenation: newPagenation(1, false),
	}, nil
}

func wibuParseSeriesSlug(rawURL string) string {
	u := strings.TrimSpace(rawURL)
	for _, prefix := range []string{"https://wibutime.local/anime/", "https://wibutime.local/series/", "http://wibutime.local/anime/", "http://wibutime.local/series/"} {
		if strings.HasPrefix(u, prefix) {
			s := strings.TrimPrefix(u, prefix)
			s = strings.Trim(s, "/")
			return s
		}
	}
	parsed, err := url.Parse(u)
	if err != nil {
		return ""
	}
	parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
	if len(parts) >= 2 && (parts[0] == "anime" || parts[0] == "series") {
		return parts[1]
	}
	return ""
}

func wibuParseEpisodeID(rawURL string) string {
	u := strings.TrimSpace(rawURL)
	for _, prefix := range []string{"https://wibutime.local/episode/", "http://wibutime.local/episode/"} {
		if strings.HasPrefix(u, prefix) {
			return strings.Trim(strings.TrimPrefix(u, prefix), "/")
		}
	}
	parsed, err := url.Parse(u)
	if err != nil {
		return ""
	}
	parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
	if len(parts) >= 2 && parts[0] == "episode" {
		return parts[1]
	}
	return ""
}

func (c *client) detailWibu(ctx context.Context, rawURL string) (any, error) {
	id := wibuParseEpisodeID(rawURL)
	if id == "" {
		// maybe series url passed; use first episode
		slug := wibuParseSeriesSlug(rawURL)
		if slug == "" {
			return nil, fmt.Errorf("URL episode wibutime tidak valid")
		}
		a, err := c.wibuAnimesBySlug(ctx, slug)
		if err != nil {
			return nil, err
		}
		eps, err := c.wibuEpisodesByAnime(ctx, a.Slug)
		if err != nil || len(eps) == 0 {
			return nil, fmt.Errorf("episode untuk %s tidak ditemukan", slug)
		}
		id = eps[0].ID
	}
	ep, err := c.wibuEpisodeByID(ctx, id)
	if err != nil {
		return nil, err
	}
	a, err := c.wibuAnimesBySlug(ctx, ep.AnimeID)
	if err != nil {
		return nil, err
	}
	eps, _ := c.wibuEpisodesByAnime(ctx, a.Slug)
	src := wibuSource(a)
	// adjacent
	var prev, next *string
	for i, e := range eps {
		if e.ID != ep.ID {
			continue
		}
		if i > 0 {
			u := wibuEpisodeURL(eps[i-1].ID)
			prev = &u
		}
		if i+1 < len(eps) {
			u := wibuEpisodeURL(eps[i+1].ID)
			next = &u
		}
	}
	allEp := wibuSeriesURL(a)
	nav := detailNav{Prev: prev, Next: next, AllEpisodes: &allEp}
	title := ""
	if ep.Title != nil {
		title = *ep.Title
	}
	if title == "" {
		title = fmt.Sprintf("Episode %d", ep.EpisodeNumber)
	}
	titlePtr := &title
	seriesPtr := strPtr(a.Title)
	seriesURLPtr := strPtr(wibuSeriesURL(a))
	synopsisPtr := a.Synopsis
	thumbPtr := a.PosterURL
	defaultIframe := ep.VideoEmbedURL
	streams := make([]donghuaStreamLink, 0)
	if ep.VideoEmbedURL != nil {
		u := *ep.VideoEmbedURL
		streams = append(streams, donghuaStreamLink{Server: strPtr("Default"), URL: &u})
	}
	for q, u := range ep.VideoQualities {
		uu := u
		qq := q
		streams = append(streams, donghuaStreamLink{Server: strPtr(strings.ToUpper(qq)), URL: &uu})
	}
	// download fallback
	downloads := []downloadGroup{}
	for q, urls := range ep.VideoQualitiesFallback {
		links := make([]downloadLink, 0, len(urls))
		for _, u := range urls {
			uu := u
			links = append(links, downloadLink{Host: strPtr("Mega"), URL: &uu})
		}
		if len(links) > 0 {
			downloads = append(downloads, downloadGroup{Quality: q, Links: links})
		}
	}
	episodeSlug := a.Slug
	if src == "anichin" {
		return &detailDonghuaResponse{
			Source:         wibuSourceName,
			Title:          titlePtr,
			Thumbnail:      thumbPtr,
			Series:         seriesPtr,
			SeriesURL:      seriesURLPtr,
			Synopsis:       synopsisPtr,
			DefaultIframe:  defaultIframe,
			StreamingLinks: streams,
			DownloadLinks:  downloads,
			Navigation:     nav,
			Pagenation:     newPagenation(1, false),
		}, nil
	}
	// anime side uses anime struct with streamingLinks animeStreamLink
	animeStreams := make([]animeStreamLink, 0, len(streams))
	for _, s := range streams {
		if s.URL == nil {
			continue
		}
		u := *s.URL
		srv := "Server"
		if s.Server != nil {
			srv = *s.Server
		}
		animeStreams = append(animeStreams, animeStreamLink{
			Server: strPtr(srv),
			URL:    strPtr(u),
		})
	}
	return &detailAnimeResponse{
		Source:         wibuSourceName,
		Title:          titlePtr,
		Series:         seriesPtr,
		SeriesURL:      seriesURLPtr,
		Synopsis:       synopsisPtr,
		Thumbnail:      thumbPtr,
		DefaultIframe:  defaultIframe,
		EpisodeSlug:    episodeSlug,
		StreamingLinks: animeStreams,
		DownloadLinks:  downloads,
		Navigation:     nav,
		Episode:        strPtr(strconv.Itoa(ep.EpisodeNumber)),
		Pagenation:     newPagenation(1, false),
	}, nil
}

func (c *client) scheduleWibu(ctx context.Context) (*scheduleResponse, error) {
	scheds := []wbSchedule{}
	q := url.Values{}
	q.Set("select", "anime_id,day_of_week,created_at")
	q.Set("order", "day_of_week.asc")
	data, err := c.wbGet(ctx, "/rest/v1/schedules?"+q.Encode())
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(data, &scheds); err != nil {
		return nil, err
	}
	all, _ := c.wbAllAnimes(ctx)
	bySlug := map[string]wbAnime{}
	for _, a := range all {
		bySlug[a.Slug] = a
	}
	dayMap := map[string][]scheduleCard{}
	var daysOrder []string
	for _, s := range scheds {
		a, ok := bySlug[s.AnimeID]
		if !ok {
			continue
		}
		card := scheduleCard{
			Title:       a.Title,
			Thumbnail:   a.PosterURL,
			URL:         wibuSeriesURL(a),
			Slug:        strPtr(a.Slug),
			Type:        strPtr(a.Type),
			Genre:       genresSlice(a),
			Status:      strPtr(a.Status),
			Source:      wibuSource(a),
		}
		if a.Rating != nil {
			r := strconv.FormatFloat(*a.Rating, 'f', 2, 64)
			card.Score = &r
		}
		dayMap[s.DayOfWeek] = append(dayMap[s.DayOfWeek], card)
		if !containsStr(daysOrder, s.DayOfWeek) {
			daysOrder = append(daysOrder, s.DayOfWeek)
		}
	}
	scheduleDays := make([]scheduleDay, 0, len(daysOrder))
	for _, day := range daysOrder {
		scheduleDays = append(scheduleDays, scheduleDay{
			Day:   day,
			DayEn: day,
			List:  dayMap[day],
		})
	}
	if scheduleDays == nil {
		scheduleDays = []scheduleDay{}
	}
	return &scheduleResponse{
		Source:          wibuSourceName,
		Schedule:        scheduleDays,
		DonghuaSchedule: []donghuaScheduleDay{},
		Donghua:         []anichinResult{},
		Pagenation:      newPagenation(1, false),
	}, nil
}

func containsStr(list []string, v string) bool {
	for _, s := range list {
		if s == v {
			return true
		}
	}
	return false
}
