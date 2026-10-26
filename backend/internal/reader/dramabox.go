package reader

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/purujawa06-bot/na-api/backend/internal/webclient"
)

const dramaboxHost = "https://www.dramabox.com"

// dramaboxLocales lists the supported content locales.
var dramaboxLocales = []string{
	"en", "zhHans", "ko", "zh", "es", "in", "ja", "de", "fr", "pt", "ar", "th", "tl", "vi", "it", "tr", "pl",
}

var (
	nextDataRe = regexp.MustCompile(`<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)</script>`)
	expiresRe  = regexp.MustCompile(`[?&]Expires=(\d+)`)
)

// dramaboxBook is the cleaned book shape reused by most DramaBox endpoints.
type dramaboxBook struct {
	ID       any   `json:"id"`
	Title    any   `json:"title"`
	Author   any   `json:"author"`
	Synopsis any   `json:"synopsis"`
	Cover    any   `json:"cover"`
	Tags     []any `json:"tags"`
	Ratings  any   `json:"ratings"`
	Views    any   `json:"views"`
	Episodes any   `json:"episodes"`
	Status   any   `json:"status"`
	Genre    []any `json:"genre"`
	URL      any   `json:"url"`
}

// dramaboxSection is one recommendation section on the home page.
type dramaboxSection struct {
	ID      any            `json:"id"`
	Title   any            `json:"title"`
	Style   any            `json:"style"`
	HasMore bool           `json:"hasMore"`
	Items   []dramaboxBook `json:"items"`
}

// dramaboxHomeResponse is the payload of GET /api/dramabox/home.
type dramaboxHomeResponse struct {
	Success  bool              `json:"success"`
	Source   string            `json:"source"`
	BuildID  any               `json:"buildId"`
	Locale   any               `json:"locale"`
	Featured []dramaboxBook    `json:"featured"`
	Sections []dramaboxSection `json:"sections"`
}

// dramaboxPerformer is one cast member.
type dramaboxPerformer struct {
	ID         any `json:"id"`
	Name       any `json:"name"`
	Avatar     any `json:"avatar"`
	VideoCount any `json:"videoCount"`
}

// dramaboxBookInfo is the detailed book block.
type dramaboxBookInfo struct {
	ID         any                 `json:"id"`
	Title      any                 `json:"title"`
	Cover      any                 `json:"cover"`
	Synopsis   any                 `json:"synopsis"`
	Tags       []any               `json:"tags"`
	Views      any                 `json:"views"`
	Followers  any                 `json:"followers"`
	Episodes   any                 `json:"episodes"`
	Language   any                 `json:"language"`
	Genre      []any               `json:"genre"`
	ShelfTime  any                 `json:"shelfTime"`
	Performers []dramaboxPerformer `json:"performers"`
	URL        any                 `json:"url"`
}

// dramaboxEpisode is one cleaned chapter entry.
type dramaboxEpisode struct {
	ID       any  `json:"id"`
	Name     any  `json:"name"`
	Index    any  `json:"index"`
	Unlock   bool `json:"unlock"`
	Duration any  `json:"duration"`
	Cover    any  `json:"cover"`
	Date     any  `json:"date"`
	Price    any  `json:"price"`
	New      bool `json:"new"`
	VideoURL any  `json:"video_url"`
}

// dramaboxDetailResponse is the payload of GET /api/dramabox/detail.
type dramaboxDetailResponse struct {
	Success   bool              `json:"success"`
	Source    string            `json:"source"`
	BuildID   any               `json:"buildId"`
	Locale    any               `json:"locale"`
	Book      dramaboxBookInfo  `json:"book"`
	Episodes  []dramaboxEpisode `json:"episodes"`
	Tabs      []any             `json:"tabs"`
	Related   []dramaboxBook    `json:"related"`
	Languages []any             `json:"languages"`
}

// dramaboxStreamChapter is the playable chapter metadata.
type dramaboxStreamChapter struct {
	ID       any `json:"id"`
	Name     any `json:"name"`
	Index    any `json:"index"`
	Duration any `json:"duration"`
	Cover    any `json:"cover"`
	Date     any `json:"date"`
}

// dramaboxStreamResponse is the payload of GET /api/dramabox/stream.
type dramaboxStreamResponse struct {
	Success   bool                  `json:"success"`
	Source    string                `json:"source"`
	BuildID   any                   `json:"buildId"`
	Locale    any                   `json:"locale"`
	BookID    any                   `json:"bookId"`
	ChapterID string                `json:"chapterId"`
	Chapter   dramaboxStreamChapter `json:"chapter"`
	VideoURL  any                   `json:"video_url"`
	Expires   any                   `json:"expires"`
}

// dramaboxSearchItem is one search result.
type dramaboxSearchItem struct {
	ID          any   `json:"id"`
	Title       any   `json:"title"`
	Author      any   `json:"author"`
	Cover       any   `json:"cover"`
	Synopsis    any   `json:"synopsis"`
	Protagonist any   `json:"protagonist"`
	Genres      []any `json:"genres"`
	Episodes    any   `json:"episodes"`
	Status      any   `json:"status"`
	ChapterID   any   `json:"chapterId"`
	Views       any   `json:"views"`
	URL         any   `json:"url"`
}

// dramaboxSearchResponse is the payload of GET /api/dramabox/search.
type dramaboxSearchResponse struct {
	Success   bool                 `json:"success"`
	Source    string               `json:"source"`
	BuildID   any                  `json:"buildId"`
	Locale    any                  `json:"locale"`
	Keyword   any                  `json:"keyword"`
	Page      any                  `json:"page"`
	TotalPage any                  `json:"totalPage"`
	Total     any                  `json:"total"`
	IsEmpty   bool                 `json:"isEmpty"`
	Results   []dramaboxSearchItem `json:"results"`
	Similar   []dramaboxBook       `json:"similar"`
}

// dramaboxCategory is one browse category chip.
type dramaboxCategory struct {
	ID      any  `json:"id"`
	Name    any  `json:"name"`
	Slug    any  `json:"slug"`
	Checked bool `json:"checked"`
}

// dramaboxCategoryInfo describes the currently selected category.
type dramaboxCategoryInfo struct {
	ID   any `json:"id"`
	Name any `json:"name"`
}

// dramaboxCategoryResponse is the payload of GET /api/dramabox/category.
type dramaboxCategoryResponse struct {
	Success    bool                 `json:"success"`
	Source     string               `json:"source"`
	BuildID    any                  `json:"buildId"`
	Locale     any                  `json:"locale"`
	Category   dramaboxCategoryInfo `json:"category"`
	Page       any                  `json:"page"`
	Pages      any                  `json:"pages"`
	Categories []dramaboxCategory   `json:"categories"`
	Results    []dramaboxBook       `json:"results"`
}

// dramaboxGetPage fetches a page and decodes its __NEXT_DATA__ payload.
func dramaboxGetPage(ctx context.Context, rawURL, locale string) (map[string]any, error) {
	headers := map[string]string{
		"accept":          "text/html,application/xhtml+xml,*/*",
		"accept-language": locale + ",en;q=0.9",
	}
	if locale == "in" {
		headers["accept-language"] = "id-ID,id;q=0.9,en;q=0.8"
	}

	resp, err := webclient.Get(ctx, rawURL, headers)
	if err != nil {
		return nil, fmt.Errorf("dramabox.com gagal diakses: %w", err)
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		resp.Body.Close()
		return nil, fmt.Errorf("dramabox.com gagal diakses (HTTP %d)", resp.StatusCode)
	}
	body, err := webclient.ReadBody(resp)
	if err != nil {
		return nil, fmt.Errorf("dramabox.com gagal dibaca: %w", err)
	}

	match := nextDataRe.FindStringSubmatch(body)
	if match == nil {
		return nil, errors.New("Data __NEXT_DATA__ tidak ditemukan di halaman dramabox.com")
	}
	decoder := json.NewDecoder(strings.NewReader(match[1]))
	decoder.UseNumber()
	var data map[string]any
	if err := decoder.Decode(&data); err != nil {
		return nil, errors.New("Gagal memparse data dramabox.com")
	}
	return data, nil
}

// dramaboxPageProps returns data.props.pageProps, or nil when absent.
func dramaboxPageProps(data map[string]any) map[string]any {
	return objectOf(objectOf(data["props"])["pageProps"])
}

// cleanDramaboxBook normalises an upstream book object.
func cleanDramaboxBook(raw map[string]any, locale string) dramaboxBook {
	tags := []any{}
	if list := firstTruthy(raw["labels"], raw["tags"]); list != nil {
		tags = arrayOrEmpty(list)
	}

	genre := make([]any, 0, 2)
	for _, value := range []any{raw["typeOneName"], raw["typeTwoName"]} {
		if truthy(value) {
			genre = append(genre, value)
		}
	}

	var bookURL any
	if truthy(raw["bookId"]) {
		if slug := firstTruthy(raw["replacedBookName"], raw["bookNameEn"]); slug != nil {
			bookURL = fmt.Sprintf("%s/%s/drama/%s/%s", dramaboxHost, locale, jsString(raw["bookId"]), jsString(slug))
		}
	}

	return dramaboxBook{
		ID:       firstTruthy(raw["bookId"], raw["originalBookId"], raw["action"]),
		Title:    firstTruthy(raw["bookName"], raw["name"]),
		Author:   orNull(raw["author"]),
		Synopsis: orNull(raw["introduction"]),
		Cover:    orNull(raw["cover"]),
		Tags:     tags,
		Ratings:  numberOrNil(raw["ratings"]),
		Views:    firstTruthy(raw["viewCountDisplay"], raw["viewCount"]),
		Episodes: numberOrNil(raw["chapterCount"]),
		Status:   orNull(raw["lastUpdateTimeDisplay"]),
		Genre:    genre,
		URL:      bookURL,
	}
}

// cleanDramaboxEpisode normalises an upstream chapter object.
func cleanDramaboxEpisode(raw map[string]any) dramaboxEpisode {
	var videoURL any
	if truthy(raw["unlock"]) && truthy(raw["mp4"]) {
		videoURL = raw["mp4"]
	}
	return dramaboxEpisode{
		ID:       raw["id"],
		Name:     orNull(raw["name"]),
		Index:    raw["index"],
		Unlock:   truthy(raw["unlock"]),
		Duration: numberOrNil(raw["duration"]),
		Cover:    orNull(raw["cover"]),
		Date:     orNull(raw["utime"]),
		Price:    valueOr(raw["chapterPrice"], 0),
		New:      truthy(raw["new"]),
		VideoURL: videoURL,
	}
}

// fetchDramaboxHome reads the home page featured and section lists.
func fetchDramaboxHome(ctx context.Context, locale string) (*dramaboxHomeResponse, error) {
	data, err := dramaboxGetPage(ctx, dramaboxHost+"/"+locale, locale)
	if err != nil {
		return nil, err
	}
	props := dramaboxPageProps(data)

	featured := make([]dramaboxBook, 0)
	for _, item := range arrayOf(props["bigList"]) {
		if raw := objectOf(item); raw != nil {
			featured = append(featured, cleanDramaboxBook(raw, locale))
		}
	}

	sections := make([]dramaboxSection, 0)
	for _, item := range arrayOf(props["smallData"]) {
		raw := objectOf(item)
		if raw == nil {
			continue
		}
		items := make([]dramaboxBook, 0)
		for _, entry := range arrayOf(raw["items"]) {
			if book := objectOf(entry); book != nil {
				items = append(items, cleanDramaboxBook(book, locale))
			}
		}
		sections = append(sections, dramaboxSection{
			ID:      raw["id"],
			Title:   raw["name"],
			Style:   raw["style"],
			HasMore: truthy(raw["more"]),
			Items:   items,
		})
	}

	return &dramaboxHomeResponse{
		Success:  true,
		Source:   "dramabox.com",
		BuildID:  orNull(data["buildId"]),
		Locale:   firstTruthy(data["locale"], locale),
		Featured: featured,
		Sections: sections,
	}, nil
}

// fetchDramaboxDetail reads one drama detail page.
func fetchDramaboxDetail(ctx context.Context, bookID, locale string) (*dramaboxDetailResponse, error) {
	data, err := dramaboxGetPage(ctx, fmt.Sprintf("%s/%s/drama/%s", dramaboxHost, locale, bookID), locale)
	if err != nil {
		return nil, err
	}
	props := dramaboxPageProps(data)
	raw := objectOf(props["bookInfo"])

	tags := []any{}
	if list := firstTruthy(raw["labels"], raw["tags"]); list != nil {
		tags = arrayOrEmpty(list)
	}

	genre := make([]any, 0)
	if list, ok := raw["typeTwoNames"].([]any); ok {
		genre = list
	} else if truthy(raw["typeTwoName"]) {
		genre = append(genre, raw["typeTwoName"])
	}

	performers := make([]dramaboxPerformer, 0)
	for _, item := range arrayOf(raw["performerList"]) {
		performer := objectOf(item)
		performers = append(performers, dramaboxPerformer{
			ID:         performer["performerId"],
			Name:       performer["performerName"],
			Avatar:     orNull(performer["performerAvatar"]),
			VideoCount: performer["videoCount"],
		})
	}

	var bookURL any
	if truthy(raw["bookId"]) {
		bookURL = fmt.Sprintf("%s/%s/drama/%s/%s",
			dramaboxHost, locale, jsString(raw["bookId"]),
			jsString(firstTruthy(raw["bookNameEn"], raw["replacedBookName"])))
	}

	episodes := make([]dramaboxEpisode, 0)
	for _, item := range arrayOf(props["chapterList"]) {
		if chapter := objectOf(item); chapter != nil {
			episodes = append(episodes, cleanDramaboxEpisode(chapter))
		}
	}

	related := make([]dramaboxBook, 0)
	for _, item := range arrayOf(props["recommends"]) {
		if book := objectOf(item); book != nil {
			related = append(related, cleanDramaboxBook(book, locale))
		}
	}

	return &dramaboxDetailResponse{
		Success: true,
		Source:  "dramabox.com",
		BuildID: orNull(data["buildId"]),
		Locale:  firstTruthy(data["locale"], locale),
		Book: dramaboxBookInfo{
			ID:         firstTruthy(raw["bookId"], bookID),
			Title:      orNull(raw["bookName"]),
			Cover:      orNull(raw["cover"]),
			Synopsis:   orNull(raw["introduction"]),
			Tags:       tags,
			Views:      raw["viewCount"],
			Followers:  raw["followCount"],
			Episodes:   numberOrNil(raw["chapterCount"]),
			Language:   orNull(raw["language"]),
			Genre:      genre,
			ShelfTime:  orNull(raw["shelfTime"]),
			Performers: performers,
			URL:        bookURL,
		},
		Episodes:  episodes,
		Tabs:      arrayOrEmpty(props["tabData"]),
		Related:   related,
		Languages: arrayOrEmpty(props["languages"]),
	}, nil
}

// fetchDramaboxStream resolves the mp4 URL of one free episode.
func fetchDramaboxStream(ctx context.Context, bookID, chapterID, locale string) (*dramaboxStreamResponse, error) {
	data, err := dramaboxGetPage(ctx, fmt.Sprintf("%s/%s/video/%s/%s", dramaboxHost, locale, bookID, chapterID), locale)
	if err != nil {
		return nil, err
	}
	props := dramaboxPageProps(data)

	var found map[string]any
	for _, item := range arrayOf(props["chapterList"]) {
		candidate := objectOf(item)
		if candidate == nil {
			continue
		}
		if jsString(candidate["id"]) == chapterID {
			found = candidate
			break
		}
	}
	if found == nil {
		return nil, errors.New("Episode tidak ditemukan")
	}
	if !truthy(found["unlock"]) || !truthy(found["mp4"]) {
		return nil, errors.New("Episode ini berbayar dan tidak tersedia gratis")
	}

	videoURL := jsString(found["mp4"])
	var expires any
	if match := expiresRe.FindStringSubmatch(videoURL); match != nil {
		if seconds, err := strconv.Atoi(match[1]); err == nil {
			expires = seconds
		}
	}

	return &dramaboxStreamResponse{
		Success:   true,
		Source:    "dramabox.com",
		BuildID:   orNull(data["buildId"]),
		Locale:    firstTruthy(data["locale"], locale),
		BookID:    bookID,
		ChapterID: chapterID,
		Chapter: dramaboxStreamChapter{
			ID:       found["id"],
			Name:     orNull(found["name"]),
			Index:    found["index"],
			Duration: numberOrNil(found["duration"]),
			Cover:    orNull(found["cover"]),
			Date:     orNull(found["utime"]),
		},
		VideoURL: videoURL,
		Expires:  expires,
	}, nil
}

// fetchDramaboxSearch searches the catalogue.
func fetchDramaboxSearch(ctx context.Context, keyword string, page int, locale string) (*dramaboxSearchResponse, error) {
	pageURL := fmt.Sprintf("%s/%s/search?searchValue=%s&page=%d", dramaboxHost, locale, encodeURIComponent(keyword), page)
	data, err := dramaboxGetPage(ctx, pageURL, locale)
	if err != nil {
		return nil, err
	}
	props := dramaboxPageProps(data)

	bookSlug := func(raw map[string]any) string {
		return jsString(firstTruthy(raw["bookNameEn"], raw["replacedBookName"], raw["bookNameLower"], raw["bookName"]))
	}

	results := make([]dramaboxSearchItem, 0)
	for _, item := range arrayOf(props["bookList"]) {
		raw := objectOf(item)
		if raw == nil {
			continue
		}
		genres := make([]any, 0)
		for _, entry := range arrayOf(raw["typeTwoList"]) {
			genres = append(genres, objectOf(entry)["name"])
		}
		var target any
		if truthy(raw["bookId"]) && truthy(raw["chapterId"]) {
			target = fmt.Sprintf("%s/%s/video/%s_%s/%s_Episode-1",
				dramaboxHost, locale, jsString(raw["bookId"]), bookSlug(raw), jsString(raw["chapterId"]))
		}
		results = append(results, dramaboxSearchItem{
			ID:          raw["bookId"],
			Title:       orNull(raw["bookName"]),
			Author:      orNull(raw["author"]),
			Cover:       firstTruthy(raw["coverWap"], raw["coverCutWap"]),
			Synopsis:    orNull(raw["introduction"]),
			Protagonist: orNull(raw["protagonist"]),
			Genres:      genres,
			Episodes:    numberOrNil(raw["totalChapterNum"]),
			Status:      firstTruthy(raw["lastChapterName"], raw["updateStatus"]),
			ChapterID:   orNull(raw["chapterId"]),
			Views:       raw["clickNum"],
			URL:         target,
		})
	}

	similar := make([]dramaboxBook, 0)
	for _, item := range arrayOf(props["similarList"]) {
		if book := objectOf(item); book != nil {
			similar = append(similar, cleanDramaboxBook(book, locale))
		}
	}

	return &dramaboxSearchResponse{
		Success:   true,
		Source:    "dramabox.com",
		BuildID:   orNull(data["buildId"]),
		Locale:    firstTruthy(data["locale"], locale),
		Keyword:   firstTruthy(props["sValue"], keyword),
		Page:      valueOr(props["pageNo"], page),
		TotalPage: valueOr(props["totalPage"], 0),
		Total:     valueOr(props["totalNum"], 0),
		IsEmpty:   truthy(props["isEmpty"]),
		Results:   results,
		Similar:   similar,
	}, nil
}

// numericEquals reports whether a decoded JSON number equals the decimal text.
func numericEquals(value any, text string) bool {
	target, err := strconv.ParseFloat(text, 64)
	if err != nil {
		return false
	}
	switch typed := value.(type) {
	case json.Number:
		number, err := typed.Float64()
		return err == nil && number == target
	case float64:
		return typed == target
	}
	return false
}

// fetchDramaboxCategory lists the dramas of one browse category.
func fetchDramaboxCategory(ctx context.Context, typeID string, page int, locale string) (*dramaboxCategoryResponse, error) {
	pageURL := fmt.Sprintf("%s/%s/browse/%s/%d", dramaboxHost, locale, typeID, page)
	data, err := dramaboxGetPage(ctx, pageURL, locale)
	if err != nil {
		return nil, err
	}
	props := dramaboxPageProps(data)

	categories := make([]dramaboxCategory, 0)
	for _, item := range arrayOf(props["types"]) {
		raw := objectOf(item)
		if raw == nil {
			continue
		}
		categories = append(categories, dramaboxCategory{
			ID:      raw["id"],
			Name:    raw["name"],
			Slug:    firstTruthy(raw["replaceName"], raw["name"]),
			Checked: truthy(raw["checked"]),
		})
	}

	var typeName any
	for _, item := range arrayOf(props["types"]) {
		raw := objectOf(item)
		if raw == nil {
			continue
		}
		if numericEquals(raw["id"], typeID) {
			typeName = orNull(raw["name"])
			break
		}
	}
	if typeName == nil {
		typeName = orNull(props["typeTwoName"])
	}

	categoryID := any(typeID)
	if typeID != "all" {
		if number, err := strconv.ParseFloat(typeID, 64); err == nil && number != 0 {
			categoryID = json.Number(strconv.FormatFloat(number, 'f', -1, 64))
		}
	}

	results := make([]dramaboxBook, 0)
	for _, item := range arrayOf(props["bookList"]) {
		if book := objectOf(item); book != nil {
			results = append(results, cleanDramaboxBook(book, locale))
		}
	}

	return &dramaboxCategoryResponse{
		Success:    true,
		Source:     "dramabox.com",
		BuildID:    orNull(data["buildId"]),
		Locale:     firstTruthy(data["locale"], locale),
		Category:   dramaboxCategoryInfo{ID: categoryID, Name: typeName},
		Page:       valueOr(props["pageNo"], page),
		Pages:      valueOr(props["pages"], 0),
		Categories: categories,
		Results:    results,
	}, nil
}
