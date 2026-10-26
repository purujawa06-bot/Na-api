package downloader

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
	"github.com/purujawa06-bot/na-api/backend/internal/webclient"
)

const (
	soundcloudAPI         = "https://api-v2.soundcloud.com"
	soundcloudHome        = "https://soundcloud.com/"
	soundcloudUA          = webclient.UserAgentChrome
	soundcloudExpiresNote = "Link stream kedaluwarsa ±1 jam"
	soundcloudSource      = "api-v2.soundcloud.com"
)

var (
	soundcloudAssetPattern    = regexp.MustCompile(`https://a-v2\.sndcdn\.com/assets/[A-Za-z0-9_-]+\.js`)
	soundcloudClientIDPattern = regexp.MustCompile(`client_id["':=\s]+([A-Za-z0-9]{32})`)
	soundcloudSpacePattern    = regexp.MustCompile(`\s+`)
	soundcloudEscapeReplacer  = strings.NewReplacer(
		`\u002f`, "/",
		`\u002F`, "/",
		`\/`, "/",
	)
)

// soundcloudClient caches the scraped client_id for the lifetime of the process
// and refreshes it once when the API answers 401.
type soundcloudClient struct {
	mu       sync.Mutex
	clientID string
}

// soundcloudStatusError carries the upstream HTTP status so callers can map 404.
type soundcloudStatusError struct {
	path   string
	status int
}

func (e *soundcloudStatusError) Error() string {
	return fmt.Sprintf("SoundCloud API %s HTTP %d", e.path, e.status)
}

// soundcloudUser is the author block shared by tracks and search results.
type soundcloudUser struct {
	Username     string  `json:"username"`
	PermalinkURL string  `json:"permalink_url"`
	AvatarURL    *string `json:"avatar_url"`
}

type soundcloudFormat struct {
	Protocol string `json:"protocol"`
}

type soundcloudTranscoding struct {
	URL    string           `json:"url"`
	Preset string           `json:"preset"`
	Format soundcloudFormat `json:"format"`
}

type soundcloudMedia struct {
	Transcodings []soundcloudTranscoding `json:"transcodings"`
}

// soundcloudItem covers the superset of fields returned for tracks, playlists
// and users by /resolve and /search. Numbers stay as json.Number so IDs are
// rendered exactly like String(id) in JS.
type soundcloudItem struct {
	Kind               string          `json:"kind"`
	ID                 json.Number     `json:"id"`
	Title              string          `json:"title"`
	PermalinkURL       string          `json:"permalink_url"`
	Duration           *int64          `json:"duration"`
	FullDuration       *int64          `json:"full_duration"`
	ArtworkURL         *string         `json:"artwork_url"`
	Genre              string          `json:"genre"`
	PlaybackCount      *int64          `json:"playback_count"`
	LikesCount         *int64          `json:"likes_count"`
	Policy             string          `json:"policy"`
	Streamable         bool            `json:"streamable"`
	IsAlbum            bool            `json:"is_album"`
	SetType            string          `json:"set_type"`
	TrackCount         *int64          `json:"track_count"`
	FollowersCount     *int64          `json:"followers_count"`
	Username           string          `json:"username"`
	AvatarURL          *string         `json:"avatar_url"`
	Verified           bool            `json:"verified"`
	City               string          `json:"city"`
	TrackAuthorization string          `json:"track_authorization"`
	User               *soundcloudUser `json:"user"`
	Media              soundcloudMedia `json:"media"`
}

// soundcloudSearchPayload is the raw /search response.
type soundcloudSearchPayload struct {
	Collection   []soundcloudItem `json:"collection"`
	TotalResults *int64           `json:"total_results"`
	NextHref     string           `json:"next_href"`
}

// soundcloudSearchResult is the shaped search result.
type soundcloudSearchResult struct {
	TotalResults *int64 `json:"total_results"`
	Results      []any  `json:"results"`
	NextOffset   *int   `json:"next_offset"`
}

type soundcloudSearchAuthor struct {
	Username     string `json:"username"`
	PermalinkURL string `json:"permalink_url"`
}

type soundcloudSearchTrack struct {
	Type          string                  `json:"type"`
	ID            string                  `json:"id"`
	Title         string                  `json:"title"`
	PermalinkURL  string                  `json:"permalink_url"`
	DurationMS    *int64                  `json:"duration_ms"`
	ArtworkURL    *string                 `json:"artwork_url"`
	Genre         *string                 `json:"genre"`
	PlaybackCount *int64                  `json:"playback_count"`
	LikesCount    *int64                  `json:"likes_count"`
	Policy        *string                 `json:"policy"`
	Streamable    bool                    `json:"streamable"`
	IsPreview     bool                    `json:"is_preview"`
	Author        *soundcloudSearchAuthor `json:"author"`
}

type soundcloudSearchPlaylist struct {
	Type         string                  `json:"type"`
	ID           string                  `json:"id"`
	Title        string                  `json:"title"`
	PermalinkURL string                  `json:"permalink_url"`
	DurationMS   *int64                  `json:"duration_ms"`
	ArtworkURL   *string                 `json:"artwork_url"`
	TrackCount   *int64                  `json:"track_count"`
	LikesCount   *int64                  `json:"likes_count"`
	Author       *soundcloudSearchAuthor `json:"author"`
}

type soundcloudSearchUser struct {
	Type           string  `json:"type"`
	ID             string  `json:"id"`
	Username       string  `json:"username"`
	PermalinkURL   string  `json:"permalink_url"`
	AvatarURL      *string `json:"avatar_url"`
	FollowersCount *int64  `json:"followers_count"`
	TrackCount     *int64  `json:"track_count"`
	Verified       bool    `json:"verified"`
	City           *string `json:"city"`
}

type soundcloudDownloadUser struct {
	Username  string  `json:"username"`
	AvatarURL *string `json:"avatar_url"`
}

// soundcloudDownload is the downloader result for one track.
type soundcloudDownload struct {
	ID            string                  `json:"id"`
	Title         string                  `json:"title"`
	PermalinkURL  string                  `json:"permalink_url"`
	DurationMS    *int64                  `json:"duration_ms"`
	ArtworkURL    *string                 `json:"artwork_url"`
	User          *soundcloudDownloadUser `json:"user"`
	Genre         *string                 `json:"genre"`
	PlaybackCount *int64                  `json:"playback_count"`
	Policy        string                  `json:"policy"`
	Format        string                  `json:"format"`
	Protocol      string                  `json:"protocol"`
	IsPreview     bool                    `json:"is_preview"`
	ExpiresNote   string                  `json:"expires_note"`
	StreamURL     *string                 `json:"stream_url"`
	DownloadURL   *string                 `json:"download_url,omitempty"`
	Filename      string                  `json:"filename,omitempty"`
}

// soundcloudDownloadEnvelope is the success envelope of the downloader route.
type soundcloudDownloadEnvelope struct {
	Success bool   `json:"success"`
	Source  string `json:"source"`
	soundcloudDownload
}

// soundcloudSearchEnvelope is the success envelope of the search route.
type soundcloudSearchEnvelope struct {
	Success      bool   `json:"success"`
	Source       string `json:"source"`
	Query        string `json:"query"`
	TotalResults *int64 `json:"total_results"`
	Results      []any  `json:"results"`
	NextOffset   *int   `json:"next_offset"`
}

// soundcloudPlayTrack is the trimmed track block returned by /play.
type soundcloudPlayTrack struct {
	ID           string  `json:"id"`
	Title        string  `json:"title"`
	Author       *string `json:"author"`
	DurationMS   *int64  `json:"duration_ms"`
	ArtworkURL   *string `json:"artwork_url"`
	PermalinkURL string  `json:"permalink_url"`
	Policy       string  `json:"policy"`
	IsPreview    bool    `json:"is_preview"`
	StreamURL    *string `json:"stream_url"`
}

// soundcloudPlayEnvelope is the success envelope of the play route.
type soundcloudPlayEnvelope struct {
	Success bool                 `json:"success"`
	Source  string               `json:"source"`
	Query   string               `json:"query"`
	Track   *soundcloudPlayTrack `json:"track"`
}

func soundcloudHostAllowed(host string) bool {
	return hostIsDomainOrSubdomain(host, "soundcloud.com")
}

/* ---------------------------- routes ---------------------------- */

func (h *handler) soundcloudDownloadGET(w http.ResponseWriter, r *http.Request) {
	rawURL := r.URL.Query().Get("url")
	h.cachedGET(w, r, func(ctx context.Context) (int, any) {
		return h.produceSoundCloudDownload(ctx, rawURL)
	})
}

func (h *handler) soundcloudDownloadPOST(w http.ResponseWriter, r *http.Request) {
	body, err := decodeBody(r)
	if err != nil {
		httpx.JSON(w, http.StatusBadRequest, map[string]any{
			"success": false,
			"error":   `Body harus JSON: {"url": "..."}`,
		})
		return
	}
	status, payload := h.produceSoundCloudDownload(r.Context(), stringField(body, "url"))
	httpx.JSON(w, status, payload)
}

func (h *handler) produceSoundCloudDownload(ctx context.Context, rawURL string) (int, any) {
	if invalid := validateDownloadURL(rawURL, soundcloudHostAllowed, "URL harus dari domain soundcloud.com"); invalid != nil {
		return http.StatusBadRequest, map[string]any{"success": false, "error": invalid.message}
	}

	result, err := h.soundcloud.download(ctx, rawURL)
	if err != nil {
		return http.StatusBadGateway, map[string]any{"success": false, "error": err.Error()}
	}
	return http.StatusOK, soundcloudDownloadEnvelope{
		Success:            true,
		Source:             soundcloudSource,
		soundcloudDownload: *result,
	}
}

func (h *handler) soundcloudSearchGET(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	status, payload := h.produceSoundCloudSearch(
		r.Context(),
		query.Get("q"),
		query.Get("type"),
		query.Get("limit"),
		query.Get("offset"),
	)
	httpx.JSON(w, status, payload)
}

func (h *handler) soundcloudSearchPOST(w http.ResponseWriter, r *http.Request) {
	body, err := decodeBody(r)
	if err != nil {
		httpx.JSON(w, http.StatusBadRequest, map[string]any{
			"success": false,
			"error":   `Body harus JSON: {"q": "..."}`,
		})
		return
	}
	status, payload := h.produceSoundCloudSearch(
		r.Context(),
		stringField(body, "q"),
		scalarField(body, "type"),
		scalarField(body, "limit"),
		scalarField(body, "offset"),
	)
	httpx.JSON(w, status, payload)
}

// produceSoundCloudSearch validates the query and runs the search. The route is
// intentionally not memoized: lib/api-cache.js never cached search results.
func (h *handler) produceSoundCloudSearch(ctx context.Context, query, searchType, limit, offset string) (int, any) {
	if strings.TrimSpace(query) == "" {
		return http.StatusBadRequest, map[string]any{"success": false, "error": "Parameter q wajib diisi"}
	}
	if len(query) > 200 {
		return http.StatusBadRequest, map[string]any{"success": false, "error": "Query terlalu panjang (maks 200 karakter)"}
	}

	normalizedType := strings.ToLower(searchType)
	if normalizedType == "" {
		normalizedType = "all"
	}
	if !isSoundCloudSearchType(normalizedType) {
		return http.StatusBadRequest, map[string]any{
			"success": false,
			"error":   "type tidak valid. Pilihan: all, tracks, playlists, albums, users",
		}
	}

	result, err := h.soundcloud.search(ctx, strings.TrimSpace(query), normalizedType, limit, offset)
	if err != nil {
		return http.StatusBadGateway, map[string]any{"success": false, "error": err.Error()}
	}
	return http.StatusOK, soundcloudSearchEnvelope{
		Success:      true,
		Source:       soundcloudSource,
		Query:        strings.TrimSpace(query),
		TotalResults: result.TotalResults,
		Results:      result.Results,
		NextOffset:   result.NextOffset,
	}
}

func (h *handler) soundcloudPlayGET(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	if strings.TrimSpace(query) == "" {
		httpx.JSON(w, http.StatusBadRequest, map[string]any{
			"success": false,
			"error":   `Parameter "q" wajib diisi`,
		})
		return
	}
	h.cachedGET(w, r, func(ctx context.Context) (int, any) {
		return h.produceSoundCloudPlay(ctx, query)
	})
}

// produceSoundCloudPlay searches for the top track and resolves its stream URL.
func (h *handler) produceSoundCloudPlay(ctx context.Context, query string) (int, any) {
	searchResult, err := h.soundcloud.search(ctx, strings.TrimSpace(query), "tracks", "1", "0")
	if err != nil {
		return http.StatusBadGateway, map[string]any{"success": false, "error": err.Error()}
	}
	if len(searchResult.Results) == 0 {
		return http.StatusNotFound, map[string]any{"success": false, "error": "Track tidak ditemukan"}
	}

	top, ok := searchResult.Results[0].(soundcloudSearchTrack)
	if !ok {
		return http.StatusNotFound, map[string]any{"success": false, "error": "Track tidak ditemukan"}
	}

	download, err := h.soundcloud.download(ctx, top.PermalinkURL)
	if err != nil {
		return http.StatusBadGateway, map[string]any{"success": false, "error": err.Error()}
	}

	var author *string
	if download.User != nil {
		author = &download.User.Username
	}
	return http.StatusOK, soundcloudPlayEnvelope{
		Success: true,
		Source:  soundcloudSource,
		Query:   strings.TrimSpace(query),
		Track: &soundcloudPlayTrack{
			ID:           download.ID,
			Title:        download.Title,
			Author:       author,
			DurationMS:   download.DurationMS,
			ArtworkURL:   download.ArtworkURL,
			PermalinkURL: download.PermalinkURL,
			Policy:       download.Policy,
			IsPreview:    download.IsPreview,
			StreamURL:    download.StreamURL,
		},
	}
}

/* ------------------------- client_id / API ------------------------- */

// getClientID returns the cached client_id, scraping the site bundles on demand.
func (c *soundcloudClient) getClientID(ctx context.Context, forceRefresh bool) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if !forceRefresh && c.clientID != "" {
		return c.clientID, nil
	}
	clientID, err := fetchSoundCloudClientID(ctx)
	if err != nil {
		return "", err
	}
	c.clientID = clientID
	return clientID, nil
}

// fetchSoundCloudClientID scans the JS bundles of soundcloud.com for a client_id.
func fetchSoundCloudClientID(ctx context.Context) (string, error) {
	homeCtx, cancelHome := context.WithTimeout(ctx, 15*time.Second)
	resp, err := webclient.Get(homeCtx, soundcloudHome, map[string]string{"User-Agent": soundcloudUA})
	if err != nil {
		cancelHome()
		return "", err
	}
	body, err := webclient.ReadBody(resp)
	cancelHome()
	if err != nil {
		return "", err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("soundcloud.com HTTP %d", resp.StatusCode)
	}

	assets := uniqueStrings(soundcloudAssetPattern.FindAllString(soundcloudEscapeReplacer.Replace(body), -1))
	// The bundles are scanned newest-first, like the reversed array in the JS.
	for index := len(assets) - 1; index >= 0; index-- {
		assetCtx, cancelAsset := context.WithTimeout(ctx, 20*time.Second)
		script, err := webclient.GetText(assetCtx, assets[index], map[string]string{"User-Agent": soundcloudUA})
		cancelAsset()
		if err != nil {
			continue // try the next bundle
		}
		if match := soundcloudClientIDPattern.FindStringSubmatch(script); match != nil {
			return match[1], nil
		}
	}
	return "", errors.New("client_id SoundCloud tidak ditemukan di asset JS")
}

// uniqueStrings removes duplicates while preserving the original order.
func uniqueStrings(values []string) []string {
	seen := make(map[string]bool, len(values))
	unique := make([]string, 0, len(values))
	for _, value := range values {
		if seen[value] {
			continue
		}
		seen[value] = true
		unique = append(unique, value)
	}
	return unique
}

// apiCall resolves a client_id and performs the API request, retrying once with
// a fresh client_id when the upstream answers 401.
func (c *soundcloudClient) apiCall(ctx context.Context, path string, params url.Values, target any) error {
	clientID, err := c.getClientID(ctx, false)
	if err != nil {
		return err
	}
	return c.apiWithClientID(ctx, path, params, clientID, target, false)
}

func (c *soundcloudClient) apiWithClientID(ctx context.Context, path string, params url.Values, clientID string, target any, retried bool) error {
	reqCtx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()

	headers := map[string]string{"User-Agent": soundcloudUA, "Accept": "application/json"}
	resp, err := webclient.Get(reqCtx, soundcloudAPIURL(path, params, clientID), headers)
	if err != nil {
		return err
	}

	if resp.StatusCode == http.StatusUnauthorized && !retried {
		resp.Body.Close()
		fresh, refreshErr := c.getClientID(ctx, true)
		if refreshErr != nil {
			return refreshErr
		}
		return c.apiWithClientID(ctx, path, params, fresh, target, true)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		resp.Body.Close()
		return &soundcloudStatusError{path: path, status: resp.StatusCode}
	}
	return webclient.DecodeJSON(resp, target)
}

// soundcloudAPIURL appends the mandatory client_id query parameter.
func soundcloudAPIURL(path string, params url.Values, clientID string) string {
	query := make(url.Values, len(params)+1)
	for key, values := range params {
		query[key] = append([]string(nil), values...)
	}
	query.Set("client_id", clientID)
	return soundcloudAPI + path + "?" + query.Encode()
}

// authorizeTranscoding exchanges a transcoding for a signed media URL.
func (c *soundcloudClient) authorizeTranscoding(ctx context.Context, track *soundcloudItem, transcoding *soundcloudTranscoding, clientID string) (*string, error) {
	parsed, err := url.Parse(transcoding.URL)
	if err != nil {
		return nil, fmt.Errorf("authorize transcoding: %w", err)
	}
	query := parsed.Query()
	query.Set("client_id", clientID)
	if track.TrackAuthorization != "" {
		query.Set("track_authorization", track.TrackAuthorization)
	}
	parsed.RawQuery = query.Encode()

	reqCtx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()

	headers := map[string]string{"User-Agent": soundcloudUA, "Accept": "application/json"}
	resp, err := webclient.Get(reqCtx, parsed.String(), headers)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		resp.Body.Close()
		return nil, fmt.Errorf("authorize transcoding HTTP %d", resp.StatusCode)
	}

	var payload struct {
		URL string `json:"url"`
	}
	if err := webclient.DecodeJSON(resp, &payload); err != nil {
		return nil, err
	}
	return pointerString(payload.URL), nil
}

/* --------------------------- download/search --------------------------- */

// download resolves a track URL and authorizes its best transcoding.
func (c *soundcloudClient) download(ctx context.Context, soundcloudURL string) (*soundcloudDownload, error) {
	var track soundcloudItem
	if err := c.apiCall(ctx, "/resolve", url.Values{"url": {soundcloudURL}}, &track); err != nil {
		var statusErr *soundcloudStatusError
		if errors.As(err, &statusErr) && statusErr.status == http.StatusNotFound {
			return nil, errors.New("Track tidak ditemukan (URL salah atau track dihapus)")
		}
		return nil, err
	}
	if track.Kind != "track" {
		return nil, errors.New("URL bukan halaman track SoundCloud")
	}

	chosen := pickTranscoding(track.Media.Transcodings)
	if chosen == nil {
		return nil, errors.New("Track tidak memiliki format audio yang tersedia")
	}

	clientID, err := c.getClientID(ctx, false)
	if err != nil {
		return nil, err
	}
	signedURL, err := c.authorizeTranscoding(ctx, &track, chosen, clientID)
	if err != nil {
		return nil, err
	}

	result := &soundcloudDownload{
		ID:            track.ID.String(),
		Title:         track.Title,
		PermalinkURL:  track.PermalinkURL,
		DurationMS:    soundcloudDurationMS(&track),
		ArtworkURL:    upgradeSoundCloudArtwork(track.ArtworkURL),
		Genre:         pointerString(track.Genre),
		PlaybackCount: track.PlaybackCount,
		Policy:        track.Policy,
		Format:        soundcloudAudioFormat(chosen.Preset),
		Protocol:      chosen.Format.Protocol,
		IsPreview:     signedURL != nil && strings.Contains(*signedURL, "cf-preview-media"),
		ExpiresNote:   soundcloudExpiresNote,
		StreamURL:     signedURL,
	}
	if track.User != nil {
		result.User = &soundcloudDownloadUser{
			Username:  track.User.Username,
			AvatarURL: upgradeSoundCloudArtwork(track.User.AvatarURL),
		}
	}
	// Progressive downloads are single files; HLS playlists have no direct URL.
	if chosen.Format.Protocol == "progressive" {
		result.DownloadURL = signedURL
		result.Filename = soundcloudFilename(track.Title) + ".mp3"
	}
	return result, nil
}

// pickTranscoding prefers progressive MP3, then HLS MP3, then any HLS stream.
func pickTranscoding(transcodings []soundcloudTranscoding) *soundcloudTranscoding {
	var progressive, hlsMP3, hlsAny *soundcloudTranscoding
	for index := range transcodings {
		transcoding := &transcodings[index]
		switch transcoding.Format.Protocol {
		case "progressive":
			if progressive == nil {
				progressive = transcoding
			}
		case "hls":
			if hlsAny == nil {
				hlsAny = transcoding
			}
			if transcoding.Preset == "mp3_1_0" && hlsMP3 == nil {
				hlsMP3 = transcoding
			}
		}
	}
	switch {
	case progressive != nil:
		return progressive
	case hlsMP3 != nil:
		return hlsMP3
	default:
		return hlsAny
	}
}

// soundcloudDurationMS picks the duration reported by the downloader.
func soundcloudDurationMS(track *soundcloudItem) *int64 {
	if track.Policy == "SNIP" {
		return track.Duration
	}
	if track.FullDuration != nil && *track.FullDuration != 0 {
		return track.FullDuration
	}
	return track.Duration
}

// soundcloudAudioFormat derives the container from the transcoding preset.
func soundcloudAudioFormat(preset string) string {
	if strings.Contains(strings.Replace(preset, "mp3_", "", 1), "aac") {
		return "aac"
	}
	return "mp3"
}

// soundcloudFilename sanitizes a track title into a download filename.
func soundcloudFilename(title string) string {
	var builder strings.Builder
	for _, char := range title {
		switch {
		case char >= 'a' && char <= 'z',
			char >= 'A' && char <= 'Z',
			char >= '0' && char <= '9',
			char == '_', char == '-',
			char == ' ', char == '\t', char == '\n', char == '\r', char == '\f', char == '\v':
			builder.WriteRune(char)
		}
	}
	return soundcloudSpacePattern.ReplaceAllString(strings.TrimSpace(builder.String()), "_")
}

// upgradeSoundCloudArtwork swaps the small rendition for the 500px one.
func upgradeSoundCloudArtwork(raw *string) *string {
	if raw == nil || *raw == "" {
		return nil
	}
	upgraded := strings.Replace(*raw, "-large.jpg", "-t500x500.jpg", 1)
	return &upgraded
}

// search normalizes the pagination parameters and shapes the API collection.
func (c *soundcloudClient) search(ctx context.Context, query, searchType, limitRaw, offsetRaw string) (*soundcloudSearchResult, error) {
	mediaType := strings.ToLower(searchType)
	if !isSoundCloudSearchType(mediaType) {
		mediaType = "all"
	}

	limit := parseInt(limitRaw, 0)
	if limit == 0 {
		limit = 20
	}
	if limit < 1 {
		limit = 1
	}
	if limit > 50 {
		limit = 50
	}
	offset := parseInt(offsetRaw, 0)
	if offset < 0 {
		offset = 0
	}

	path := "/search"
	if mediaType != "all" {
		path = "/search/" + mediaType
	}
	params := url.Values{
		"q":      {query},
		"limit":  {strconv.Itoa(limit)},
		"offset": {strconv.Itoa(offset)},
	}

	var data soundcloudSearchPayload
	if err := c.apiCall(ctx, path, params, &data); err != nil {
		return nil, err
	}

	results := make([]any, 0, len(data.Collection))
	for index := range data.Collection {
		if shaped := shapeSoundCloudItem(&data.Collection[index]); shaped != nil {
			results = append(results, shaped)
		}
	}
	return &soundcloudSearchResult{
		TotalResults: data.TotalResults,
		Results:      results,
		NextOffset:   soundcloudNextOffset(data.NextHref, offset, len(results)),
	}, nil
}

// isSoundCloudSearchType reports whether the type filter is supported.
func isSoundCloudSearchType(value string) bool {
	switch value {
	case "all", "tracks", "playlists", "albums", "users":
		return true
	default:
		return false
	}
}

// soundcloudNextOffset extracts the offset from next_href, falling back to the
// current offset plus the number of shaped results.
func soundcloudNextOffset(nextHref string, offset, count int) *int {
	if nextHref == "" {
		return nil
	}
	next := offset + count
	if parsed, err := url.Parse(nextHref); err == nil {
		if raw := parsed.Query().Get("offset"); raw != "" {
			if value, err := strconv.Atoi(raw); err == nil {
				next = value
			}
		}
	}
	return &next
}

// shapeSoundCloudItem maps one collection entry to its public representation.
// Incomplete stubs (track/playlist/user without the expected kind) are dropped.
func shapeSoundCloudItem(item *soundcloudItem) any {
	switch item.Kind {
	case "track":
		var author *soundcloudSearchAuthor
		if item.User != nil {
			author = &soundcloudSearchAuthor{Username: item.User.Username, PermalinkURL: item.User.PermalinkURL}
		}
		return soundcloudSearchTrack{
			Type:          "track",
			ID:            item.ID.String(),
			Title:         item.Title,
			PermalinkURL:  item.PermalinkURL,
			DurationMS:    trackDurationMS(item),
			ArtworkURL:    upgradeSoundCloudArtwork(item.ArtworkURL),
			Genre:         pointerString(item.Genre),
			PlaybackCount: item.PlaybackCount,
			LikesCount:    item.LikesCount,
			Policy:        pointerString(item.Policy),
			Streamable:    item.Streamable,
			IsPreview:     item.Policy == "SNIP",
			Author:        author,
		}
	case "playlist":
		playlistType := "playlist"
		if item.IsAlbum || item.SetType == "album" {
			playlistType = "album"
		}
		var author *soundcloudSearchAuthor
		if item.User != nil {
			author = &soundcloudSearchAuthor{Username: item.User.Username, PermalinkURL: item.User.PermalinkURL}
		}
		return soundcloudSearchPlaylist{
			Type:         playlistType,
			ID:           item.ID.String(),
			Title:        item.Title,
			PermalinkURL: item.PermalinkURL,
			DurationMS:   item.Duration,
			ArtworkURL:   upgradeSoundCloudArtwork(item.ArtworkURL),
			TrackCount:   item.TrackCount,
			LikesCount:   item.LikesCount,
			Author:       author,
		}
	case "user":
		return soundcloudSearchUser{
			Type:           "user",
			ID:             item.ID.String(),
			Username:       item.Username,
			PermalinkURL:   item.PermalinkURL,
			AvatarURL:      upgradeSoundCloudArtwork(item.AvatarURL),
			FollowersCount: item.FollowersCount,
			TrackCount:     item.TrackCount,
			Verified:       item.Verified,
			City:           pointerString(item.City),
		}
	default:
		return nil
	}
}

// trackDurationMS is the `full_duration || duration` used for search tracks.
func trackDurationMS(item *soundcloudItem) *int64 {
	if item.FullDuration != nil && *item.FullDuration != 0 {
		return item.FullDuration
	}
	return item.Duration
}
