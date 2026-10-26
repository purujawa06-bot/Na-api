package purtv

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"

	"golang.org/x/net/html"

	"github.com/purujawa06-bot/na-api/backend/internal/htmlx"
)

// scheduleDays is the release order of the official schedule page.
var scheduleDays = []string{"monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"}

// scheduleDayID maps the English key to the Indonesian label.
var scheduleDayID = map[string]string{
	"monday":    "Senin",
	"tuesday":   "Selasa",
	"wednesday": "Rabu",
	"thursday":  "Kamis",
	"friday":    "Jumat",
	"saturday":  "Sabtu",
	"sunday":    "Minggu",
}

// scheduleCardExpr is the jQuery expression run by scraper-web for one card.
const scheduleCardExpr = `title:$(e).find('h2').attr('title')||$(e).find('h2').text().trim(),url:$(e).find('a').attr('href'),img:$(e).find('img').attr('src'),type:$(e).find('.type').first().text().trim()||null,score:$(e).find('.score').text().replace(/[^0-9.]/g,'')||null,time:$(e).find('.data_tw a').text().replace(/\s+/g,' ').trim()||null,genre:$(e).find('.data .type').text().replace(/\s+/g,' ').trim()||null`

// shScheduleResult is the normalised samehadaku schedule payload.
type shScheduleResult struct {
	Schedule []scheduleDay
	Error    string
}

// schedule merges the samehadaku anime schedule with the anichin donghua
// updates used as the donghua tab.
func (c *client) schedule(ctx context.Context) (*scheduleResponse, error) {
	var (
		waitGroup sync.WaitGroup
		anime     shScheduleResult
		donghua   []anichinResult
	)
	waitGroup.Add(2)
	go func() {
		defer waitGroup.Done()
		anime = c.fetchSamehadakuSchedule(ctx)
	}()
	go func() {
		defer waitGroup.Done()
		donghua = c.fetchAnichinDonghua(ctx)
	}()
	waitGroup.Wait()

	schedule := anime.Schedule
	if schedule == nil {
		schedule = []scheduleDay{}
	}
	donghuaSchedule := []donghuaScheduleDay{}
	if len(donghua) > 0 {
		donghuaSchedule = append(donghuaSchedule, donghuaScheduleDay{
			Day:   "Update Donghua",
			DayEn: "donghua",
			List:  donghua,
		})
	}

	noteParts := []string{}
	emptyAnime := len(schedule) == 0
	if !emptyAnime {
		emptyAnime = true
		for _, day := range schedule {
			if len(day.List) > 0 {
				emptyAnime = false
				break
			}
		}
	}
	if emptyAnime {
		noteParts = append(noteParts, "jadwal anime samehadaku kosong/gagal")
	}
	if len(donghuaSchedule) == 0 {
		noteParts = append(noteParts, "jadwal donghua anichin kosong/gagal")
	}
	note := ""
	if len(noteParts) > 0 {
		note = "Jadwal sebagian kosong: " + strings.Join(noteParts, "; ")
	}

	return &scheduleResponse{
		Source:          purtvSource,
		Schedule:        schedule,
		DonghuaSchedule: donghuaSchedule,
		Donghua:         donghua,
		Note:            note,
		Pagenation:      newPagenation(1, false),
	}, nil
}

// schedulePageSelector builds the scraper-web expression that grabs all seven
// day blocks from `/jadwal-rilis/` in one request.
func schedulePageSelector() string {
	var builder strings.Builder
	builder.WriteString("({ ")
	for index, day := range scheduleDays {
		if index > 0 {
			builder.WriteString(", ")
		}
		fmt.Fprintf(&builder, "%s: $('.result-schedule').eq(%d).find('.animepost').map((i,e)=>({%s})).get()", day, index, scheduleCardExpr)
	}
	builder.WriteString(" })")
	return builder.String()
}

// fetchSamehadakuSchedule prefers the SSR schedule page, falling back to the
// per-day REST endpoints.
func (c *client) fetchSamehadakuSchedule(ctx context.Context) shScheduleResult {
	if schedule, err := c.scheduleFromPage(ctx); err == nil {
		for _, day := range schedule {
			if len(day.List) > 0 {
				return shScheduleResult{Schedule: schedule}
			}
		}
	}
	schedule, err := c.scheduleFromRest(ctx)
	if err != nil {
		return shScheduleResult{Schedule: []scheduleDay{}, Error: err.Error()}
	}
	return shScheduleResult{Schedule: schedule}
}

// scheduleFromPage scrapes the official `/jadwal-rilis/` page.
func (c *client) scheduleFromPage(ctx context.Context) ([]scheduleDay, error) {
	raw, err := c.scraperWebPost(ctx, samehadakuHost+"/jadwal-rilis/", map[string]string{
		"days": schedulePageSelector(),
	}, samehadakuSource)
	if err != nil {
		return nil, err
	}
	days := decodeInto[map[string][]map[string]any](raw, "days")

	schedule := make([]scheduleDay, 0, len(scheduleDays))
	for _, day := range scheduleDays {
		list := []scheduleCard{}
		for _, item := range days[day] {
			if mapped := mapScheduleCard(item); mapped != nil {
				list = append(list, *mapped)
			}
		}
		schedule = append(schedule, scheduleDay{Day: scheduleDayLabel(day), DayEn: day, List: list})
	}
	return schedule, nil
}

// scheduleFromRest queries the per-day REST routes (newest namespace first).
func (c *client) scheduleFromRest(ctx context.Context) ([]scheduleDay, error) {
	routes := []func(string) string{
		func(day string) string { return samehadakuHost + "/wp-json/apk/schedule?day=" + day },
		func(day string) string {
			return samehadakuHost + "/wp-json/custom/v1/all-schedule?perpage=20&day=" + day
		},
	}

	schedule := make([]scheduleDay, len(scheduleDays))
	var waitGroup sync.WaitGroup
	for index, day := range scheduleDays {
		waitGroup.Add(1)
		go func(index int, day string) {
			defer waitGroup.Done()
			base := scheduleDay{Day: scheduleDayLabel(day), DayEn: day, List: []scheduleCard{}}
			for _, route := range routes {
				raw, err := c.scraperWebPost(ctx, route(day), map[string]string{
					"raw": "$('body').text().trim()",
				}, samehadakuSource)
				if err != nil {
					continue
				}
				payload := decodeInto[string](raw, "raw")
				var entries []map[string]any
				if json.Unmarshal([]byte(payload), &entries) != nil {
					continue
				}
				list := make([]scheduleCard, 0, len(entries))
				for _, entry := range entries {
					if status := stringValue(entry["status"]); status != "" && !strings.Contains(strings.ToLower(status), "currently airing") {
						continue
					}
					if mapped := mapScheduleCard(entry); mapped != nil {
						list = append(list, *mapped)
					}
				}
				sort.SliceStable(list, func(left, right int) bool {
					return releaseSortKey(list[left]) < releaseSortKey(list[right])
				})
				if len(list) > 0 {
					base.List = list
					break
				}
			}
			schedule[index] = base
		}(index, day)
	}
	waitGroup.Wait()
	return schedule, nil
}

// releaseSortKey supplies the "99:99" fallback used when a card has no time.
func releaseSortKey(entry scheduleCard) string {
	if entry.ReleaseTime == nil || *entry.ReleaseTime == "" {
		return "99:99"
	}
	return *entry.ReleaseTime
}

// scheduleDayLabel returns the Indonesian label for an English day key.
func scheduleDayLabel(day string) string {
	if label, ok := scheduleDayID[day]; ok {
		return label
	}
	return day
}

// mapScheduleCard normalises one schedule entry from either source shape.
func mapScheduleCard(raw map[string]any) *scheduleCard {
	if raw == nil {
		return nil
	}
	title := strings.TrimSpace(stringValue(raw["title"]))
	link := strings.TrimSpace(stringValue(raw["url"]))
	if title == "" || link == "" {
		return nil
	}

	slug := strings.TrimSpace(stringValue(raw["slug"]))
	if slug == "" {
		slug = slugOf(link)
	}

	var score *string
	if value, exists := raw["score"]; exists && truthy(value) {
		score = trimmedPtr(stringValue(value))
	} else {
		score = trimmedPtr(stringValue(raw["east_score"]))
	}

	return &scheduleCard{
		Title:       title,
		Thumbnail:   absSamehadaku(firstNonEmpty(raw, "img", "thumbnail", "featured_img_src")),
		URL:         link,
		Slug:        trimmedPtr(slug),
		ReleaseTime: normaliseReleaseTime(firstNonEmpty(raw, "time", "releaseTime", "east_time")),
		Type:        trimmedPtr(firstNonEmpty(raw, "type", "east_type")),
		Genre:       normaliseGenre(raw["genre"]),
		Score:       score,
		Status:      trimmedPtr(stringValue(raw["status"])),
		Source:      samehadakuSource,
	}
}

// normaliseReleaseTime rewrites "23", "23.59", "2.30" as "HH:MM".
func normaliseReleaseTime(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	if match := releaseTimePattern.FindStringSubmatch(value); match != nil {
		return stringPtr(padHour(match[1]) + ":" + match[2])
	}
	if match := hourOnlyPattern.FindStringSubmatch(value); match != nil {
		return stringPtr(padHour(match[1]) + ":00")
	}
	return stringPtr(value)
}

// padHour left-pads a single-digit hour with a zero.
func padHour(hour string) string {
	if len(hour) >= 2 {
		return hour
	}
	return "0" + hour
}

// normaliseGenre splits a comma separated genre string into a list.
func normaliseGenre(value any) []string {
	if value == nil {
		return nil
	}
	if list, ok := value.([]any); ok {
		genres := make([]string, 0, len(list))
		for _, item := range list {
			if name := strings.TrimSpace(stringValue(item)); name != "" {
				genres = append(genres, name)
			}
		}
		if len(genres) == 0 {
			return nil
		}
		return genres
	}
	parts := strings.Split(stringValue(value), ",")
	genres := make([]string, 0, len(parts))
	for _, part := range parts {
		if name := strings.TrimSpace(part); name != "" {
			genres = append(genres, name)
		}
	}
	if len(genres) == 0 {
		return nil
	}
	return genres
}

// stringValue renders a decoded JSON scalar as a string.
func stringValue(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return typed
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(typed)
	default:
		return fmt.Sprint(typed)
	}
}

// firstNonEmpty returns the first non-blank value among the given keys.
func firstNonEmpty(raw map[string]any, keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(stringValue(raw[key])); value != "" {
			return value
		}
	}
	return ""
}

// truthy mirrors JavaScript's truthiness for decoded JSON values.
func truthy(value any) bool {
	switch typed := value.(type) {
	case nil:
		return false
	case string:
		return typed != ""
	case float64:
		return typed != 0
	case bool:
		return typed
	default:
		return true
	}
}

// fetchAnichinDonghua lists the latest donghua updates from the anichin home
// page, falling back to the scraper-web proxy when Cloudflare blocks us.
func (c *client) fetchAnichinDonghua(ctx context.Context) []anichinResult {
	seen := map[string]struct{}{}
	out := []anichinResult{}
	push := func(entry *card) {
		if entry == nil || entry.Title == nil || entry.URL == nil {
			return
		}
		key := strings.TrimRight(*entry.URL, "/")
		if _, exists := seen[key]; exists {
			return
		}
		seen[key] = struct{}{}
		out = append(out, anichinResult{Source: anichinSource, card: *entry})
	}

	if body, err := c.anichinHTML(ctx, anichinHost+"/"); err == nil {
		if doc, parseErr := htmlx.Parse(body); parseErr == nil {
			collectors := []func(*html.Node) []*card{
				collectHotCards,
				collectLatestCards,
				func(doc *html.Node) []*card { return collectMatchingElements(doc, "article", "bs") },
				func(doc *html.Node) []*card { return collectMatchingElements(doc, "article", "bs") },
				collectReleaseArticles,
				collectOngoingAnchors,
			}
			for _, collect := range collectors {
				for _, entry := range collect(doc) {
					push(entry)
				}
				if len(out) >= 10 {
					break
				}
			}
			if len(out) < 10 {
				for _, container := range findClass(doc, "", "ongoingseries") {
					for _, list := range findClass(container, "ul", "") {
						for _, item := range findClass(list, "li", "") {
							title := text(firstClass(item, "", "l"))
							if title == "" {
								title = text(firstClass(item, "a", ""))
							}
							push(&card{
								Title:     trimmedPtr(title),
								URL:       absAnichin(htmlx.Attr(firstClass(item, "a", ""), "href")),
								Episode:   trimmedPtr(text(firstClass(item, "", "r"))),
								Thumbnail: nil,
								Type:      stringPtr("Ongoing"),
							})
						}
					}
				}
			}
			if len(out) > 0 {
				return limitAnichinResults(out, 40)
			}
		}
	}

	raw, err := c.scraperWebPost(ctx, anichinHost+"/", map[string]string{
		"hot":    "$('.bixbox:has(.releases.hothome) .listupd article.bs').map((i, el) => ({ title: $(el).find('.tt h2').text().trim() || $(el).find('h2').text().trim(), thumbnail: $(el).find('img').attr('data-src') || $(el).find('img').attr('src'), url: $(el).find('a').attr('href'), type: $(el).find('.typez').text().trim(), status: $(el).find('.status').text().trim(), episode: $(el).find('.epx').text().trim() })).get()",
		"latest": "$('.listupd.normal article.bs').map((i, el) => ({ title: $(el).find('.tt h2').text().trim() || $(el).find('h2').text().trim(), thumbnail: $(el).find('img').attr('data-src') || $(el).find('img').attr('src'), url: $(el).find('a').attr('href'), type: $(el).find('.typez').text().trim(), status: $(el).find('.status').text().trim(), episode: $(el).find('.epx').text().trim() })).get()",
		"any":    "$('article.bs').map((i, el) => ({ title: $(el).find('.tt h2').text().trim() || $(el).find('h2').text().trim(), thumbnail: $(el).find('img').attr('data-src') || $(el).find('img').attr('src'), url: $(el).find('a').attr('href'), type: $(el).find('.typez').text().trim(), status: $(el).find('.status').text().trim(), episode: $(el).find('.epx').text().trim() })).get()",
	}, anichinSource)
	if err == nil {
		for _, key := range []string{"hot", "latest", "any"} {
			for _, entry := range decodeInto[[]map[string]any](raw, key) {
				push(mapScrapedCard(entry))
			}
			if len(out) >= 10 {
				break
			}
		}
	}
	return limitAnichinResults(out, 40)
}

// limitAnichinResults truncates a slice while keeping it non-nil.
func limitAnichinResults(entries []anichinResult, limit int) []anichinResult {
	if len(entries) > limit {
		return entries[:limit]
	}
	return entries
}

// collectHotCards returns the cards inside the hot-update boxes.
func collectHotCards(doc *html.Node) []*card {
	entries := []*card{}
	for _, box := range findClass(doc, "", "bixbox") {
		if len(htmlx.Find(box, "", "releases hothome", "")) == 0 {
			continue
		}
		for _, listupd := range findClass(box, "", "listupd") {
			for _, article := range findClass(listupd, "article", "bs") {
				parsed := parseAnichinCard(article)
				entries = append(entries, &parsed)
			}
		}
	}
	return entries
}

// collectLatestCards returns the cards inside the normal listing.
func collectLatestCards(doc *html.Node) []*card {
	entries := []*card{}
	for _, listupd := range findClass(doc, "", "listupd normal") {
		for _, article := range findClass(listupd, "article", "bs") {
			parsed := parseAnichinCard(article)
			entries = append(entries, &parsed)
		}
	}
	return entries
}

// collectMatchingElements converts every matching element into a card.
func collectMatchingElements(doc *html.Node, tag, class string) []*card {
	entries := []*card{}
	for _, element := range findClass(doc, tag, class) {
		parsed := parseAnichinCard(element)
		entries = append(entries, &parsed)
	}
	return entries
}

// collectReleaseArticles returns any article inside a `.releases` block.
func collectReleaseArticles(doc *html.Node) []*card {
	entries := []*card{}
	for _, releases := range findClass(doc, "", "releases") {
		for _, listupd := range findClass(releases, "", "listupd") {
			for _, article := range findClass(listupd, "article", "") {
				parsed := parseAnichinCard(article)
				entries = append(entries, &parsed)
			}
		}
	}
	return entries
}

// collectOngoingAnchors returns ongoing links rendered as bare anchors.
func collectOngoingAnchors(doc *html.Node) []*card {
	entries := []*card{}
	for _, container := range findClass(doc, "", "ongoingseries") {
		for _, list := range findClass(container, "ul", "") {
			for _, item := range findClass(list, "li", "") {
				for _, anchor := range findClass(item, "a", "") {
					title := text(anchor)
					if title == "" {
						title = htmlx.Attr(anchor, "title")
					}
					entries = append(entries, &card{
						Title:     trimmedPtr(title),
						URL:       absAnichin(htmlx.Attr(anchor, "href")),
						Episode:   nil,
						Thumbnail: imgSrc(firstClass(anchor, "img", "")),
						Type:      stringPtr("Ongoing"),
					})
				}
			}
		}
	}
	return entries
}

// mapScrapedCard normalises one scraper-web card into the listing shape.
func mapScrapedCard(raw map[string]any) *card {
	if raw == nil {
		return nil
	}
	thumbnail := stringValue(raw["thumbnail"])
	var thumbnailPtr *string
	if thumbnail != "" && !strings.HasPrefix(thumbnail, "data:image") {
		thumbnailPtr = stringPtr(thumbnail)
	}

	link := stringValue(raw["url"])
	var urlPtr *string
	if link != "" {
		if strings.HasPrefix(strings.ToLower(link), "http") {
			urlPtr = stringPtr(link)
		} else {
			path := link
			if !strings.HasPrefix(path, "/") {
				path = "/" + path
			}
			urlPtr = stringPtr(anichinHost + path)
		}
	}

	title := strings.TrimSpace(stringValue(raw["title"]))
	if title == "" || urlPtr == nil {
		return nil
	}
	return &card{
		Title:     stringPtr(title),
		Thumbnail: thumbnailPtr,
		URL:       urlPtr,
		Type:      trimmedPtr(stringValue(raw["type"])),
		Status:    trimmedPtr(stringValue(raw["status"])),
		Episode:   trimmedPtr(stringValue(raw["episode"])),
	}
}
