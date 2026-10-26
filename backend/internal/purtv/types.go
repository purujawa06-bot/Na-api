package purtv

// envelope adds the success flag shared by every PurTV response. The Next.js
// routes answer {success:true, ...data}, so it is embedded in each payload.
type envelope struct {
	Success bool `json:"success"`
}

// pagenation mirrors the `purtv_pagenation` object the PurTV SPA expects on
// every paginated response.
type pagenation struct {
	CurrentPage int  `json:"currentPage"`
	HasNext     bool `json:"hasNext"`
}

// newPagenation builds the navigation metadata block.
func newPagenation(page int, hasNext bool) pagenation {
	return pagenation{CurrentPage: page, HasNext: hasNext}
}

// card is an anichin listing card (home, search, list, schedule fallback).
type card struct {
	Title     *string `json:"title"`
	Thumbnail *string `json:"thumbnail"`
	URL       *string `json:"url"`
	Type      *string `json:"type"`
	Status    *string `json:"status"`
	Episode   *string `json:"episode"`
}

// anichinResult is an anichin card annotated with its merged source marker.
type anichinResult struct {
	Source string `json:"source"`
	card
}

// samehadakuResult is a samehadaku card annotated with its source marker. It
// also carries `slug`, which the donghua card does not have.
type samehadakuResult struct {
	Source    string  `json:"source"`
	Title     *string `json:"title"`
	Thumbnail *string `json:"thumbnail"`
	URL       *string `json:"url"`
	Slug      *string `json:"slug"`
	Type      *string `json:"type"`
	Status    *string `json:"status"`
	Episode   *string `json:"episode"`
}

type featuredItem struct {
	Title       *string `json:"title"`
	Thumbnail   *string `json:"thumbnail"`
	URL         *string `json:"url"`
	Description *string `json:"description"`
}

type ongoingItem struct {
	Title     string  `json:"title"`
	URL       *string `json:"url"`
	Episode   string  `json:"episode"`
	Thumbnail *string `json:"thumbnail"`
	Source    string  `json:"source"`
}

type genreRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type popularItem struct {
	Title     *string  `json:"title"`
	URL       *string  `json:"url"`
	Thumbnail *string  `json:"thumbnail"`
	Genres    []string `json:"genres"`
	Rating    *string  `json:"rating"`
}

type recommendGroup struct {
	ID   string        `json:"id"`
	List []popularItem `json:"list"`
}

type recommendations struct {
	Genres []genreRef       `json:"genres"`
	Items  []recommendGroup `json:"items"`
}

type latestAnimeItem struct {
	Title     *string `json:"title"`
	Thumbnail *string `json:"thumbnail"`
	URL       *string `json:"url"`
	Episode   *string `json:"episode"`
}

type popularAnimeRaw struct {
	Title     *string `json:"title"`
	Thumbnail *string `json:"thumbnail"`
	URL       *string `json:"url"`
	Rating    *string `json:"rating"`
	Rank      *string `json:"rank"`
}

type homeAnime struct {
	LatestAnime  []latestAnimeItem `json:"latestAnime"`
	PopularAnime []popularAnimeRaw `json:"popularAnime"`
}

type homeResponse struct {
	envelope
	Source          string          `json:"source"`
	FeaturedSlider  []featuredItem  `json:"featuredSlider"`
	PopularToday    []card          `json:"popularToday"`
	LatestReleases  []card          `json:"latestReleases"`
	Ongoing         []ongoingItem   `json:"ongoing"`
	Recommendations recommendations `json:"recommendations"`
	Anime           homeAnime       `json:"anime"`
	Pagenation      pagenation      `json:"purtv_pagenation"`
}

type animeStreamLink struct {
	Server *string `json:"server"`
	Index  *string `json:"index"`
	URL    *string `json:"url"`
	Post   *string `json:"post"`
	Nume   *string `json:"nume"`
	Type   *string `json:"type"`
}

type downloadLink struct {
	Host *string `json:"host"`
	URL  *string `json:"url"`
}

type downloadGroup struct {
	Quality string         `json:"quality"`
	Links   []downloadLink `json:"links"`
}

type detailNav struct {
	Prev        *string `json:"prev"`
	Next        *string `json:"next"`
	AllEpisodes *string `json:"allEpisodes"`
}

type detailAnimeResponse struct {
	envelope
	Source         string            `json:"source"`
	Title          *string           `json:"title"`
	Series         *string           `json:"series"`
	SeriesURL      *string           `json:"seriesUrl"`
	Synopsis       *string           `json:"synopsis"`
	Thumbnail      *string           `json:"thumbnail"`
	DefaultIframe  *string           `json:"defaultIframe"`
	EpisodeSlug    string            `json:"episodeSlug"`
	StreamingLinks []animeStreamLink `json:"streamingLinks"`
	DownloadLinks  []downloadGroup   `json:"downloadLinks"`
	Navigation     detailNav         `json:"navigation"`
	Episode        *string           `json:"episode"`
	Pagenation     pagenation        `json:"purtv_pagenation"`
}

type dailymotionStream struct {
	Quality string  `json:"quality"`
	Type    *string `json:"type"`
	URL     string  `json:"url"`
}

type dailymotionInfo struct {
	AccessID  string              `json:"accessId"`
	PublicID  string              `json:"publicId"`
	Title     *string             `json:"title"`
	Duration  any                 `json:"duration"`
	IsPrivate *bool               `json:"isPrivate"`
	WatchURL  string              `json:"watchUrl"`
	EmbedURL  string              `json:"embedUrl"`
	StreamURL *string             `json:"streamUrl"`
	HLSURL    *string             `json:"hlsUrl"`
	Streams   []dailymotionStream `json:"streams"`
}

type donghuaStreamLink struct {
	Server      *string          `json:"server"`
	Index       *string          `json:"index"`
	URL         *string          `json:"url"`
	Mirror      *string          `json:"mirror"`
	Source      *string          `json:"source,omitempty"`
	Dailymotion *dailymotionInfo `json:"dailymotion,omitempty"`
	StreamURL   *string          `json:"streamUrl,omitempty"`
	HLSURL      *string          `json:"hlsUrl,omitempty"`
}

type detailDonghuaResponse struct {
	envelope
	Source         string              `json:"source"`
	Title          *string             `json:"title"`
	Thumbnail      *string             `json:"thumbnail"`
	Series         *string             `json:"series"`
	SeriesURL      *string             `json:"seriesUrl"`
	Synopsis       *string             `json:"synopsis"`
	DefaultIframe  *string             `json:"defaultIframe"`
	Dailymotion    *dailymotionInfo    `json:"dailymotion"`
	StreamingLinks []donghuaStreamLink `json:"streamingLinks"`
	DownloadLinks  []downloadGroup     `json:"downloadLinks"`
	Navigation     detailNav           `json:"navigation"`
	Pagenation     pagenation          `json:"purtv_pagenation"`
}

type seriesEpisode struct {
	Episode *string `json:"episode"`
	Title   *string `json:"title"`
	URL     *string `json:"url"`
}

type seriesAnimeResponse struct {
	envelope
	Source     string            `json:"source"`
	Title      *string           `json:"title"`
	Genres     []string          `json:"genres"`
	Synopsis   *string           `json:"synopsis"`
	Info       map[string]string `json:"info"`
	Episodes   []seriesEpisode   `json:"episodes"`
	Poster     *string           `json:"poster"`
	Rating     *string           `json:"rating"`
	Pagenation pagenation        `json:"purtv_pagenation"`
}

type seriesDonghuaResponse struct {
	envelope
	Source     string            `json:"source"`
	Title      string            `json:"title"`
	Poster     *string           `json:"poster"`
	Rating     *string           `json:"rating"`
	Genres     []string          `json:"genres"`
	Synopsis   *string           `json:"synopsis"`
	Info       map[string]string `json:"info"`
	Episodes   []seriesEpisode   `json:"episodes"`
	Pagenation pagenation        `json:"purtv_pagenation"`
}

type genreItem struct {
	Name string  `json:"name"`
	Slug *string `json:"slug"`
}

type genresResponse struct {
	envelope
	Source     string      `json:"source"`
	Genres     []genreItem `json:"genres"`
	Pagenation pagenation  `json:"purtv_pagenation"`
}

type searchResponse struct {
	envelope
	Source     string     `json:"source"`
	Query      string     `json:"query"`
	Page       int        `json:"page"`
	HasNext    bool       `json:"hasNext"`
	Results    []any      `json:"results"`
	Pagenation pagenation `json:"purtv_pagenation"`
}

type listResponse struct {
	envelope
	Source     string     `json:"source"`
	Genre      string     `json:"genre"`
	Page       int        `json:"page"`
	HasNext    bool       `json:"hasNext"`
	Results    []any      `json:"results"`
	Pagenation pagenation `json:"purtv_pagenation"`
}

type scheduleCard struct {
	Title       string   `json:"title"`
	Thumbnail   *string  `json:"thumbnail"`
	URL         string   `json:"url"`
	Slug        *string  `json:"slug"`
	ReleaseTime *string  `json:"releaseTime"`
	Type        *string  `json:"type"`
	Genre       []string `json:"genre"`
	Score       *string  `json:"score"`
	Status      *string  `json:"status"`
	Source      string   `json:"source"`
}

type scheduleDay struct {
	Day   string         `json:"day"`
	DayEn string         `json:"dayEn"`
	List  []scheduleCard `json:"list"`
}

type donghuaScheduleDay struct {
	Day   string          `json:"day"`
	DayEn string          `json:"dayEn"`
	List  []anichinResult `json:"list"`
}

type scheduleResponse struct {
	envelope
	Source          string               `json:"source"`
	Schedule        []scheduleDay        `json:"schedule"`
	DonghuaSchedule []donghuaScheduleDay `json:"donghuaSchedule"`
	Donghua         []anichinResult      `json:"donghua"`
	Note            string               `json:"note,omitempty"`
	Pagenation      pagenation           `json:"purtv_pagenation"`
}

type playerResponse struct {
	envelope
	Iframe string `json:"iframe"`
	Raw    string `json:"raw"`
}
