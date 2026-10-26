package purtv

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/purujawa06-bot/na-api/backend/internal/htmlx"
)

// animeSeries builds the series payload for a samehadaku slug.
func (c *client) animeSeries(ctx context.Context, slug string) (*seriesAnimeResponse, error) {
	result := c.fetchSamehadakuDetail(ctx, slug)
	if result.Error != "" {
		return nil, errors.New(result.Error)
	}

	genres := make([]string, 0, len(result.Genres))
	genres = append(genres, result.Genres...)

	episodes := make([]seriesEpisode, 0, len(result.Episodes))
	for _, episode := range result.Episodes {
		episodes = append(episodes, seriesEpisode{
			Episode: episode.Number,
			Title:   episode.Title,
			URL:     episode.URL,
		})
	}

	return &seriesAnimeResponse{
		Source:     purtvSource,
		Title:      result.Title,
		Genres:     genres,
		Synopsis:   result.Synopsis,
		Info:       result.Info,
		Episodes:   episodes,
		Poster:     result.Poster,
		Rating:     result.Rating,
		Pagenation: newPagenation(1, false),
	}, nil
}

// donghuaSeries builds the series payload for an anichin page.
func (c *client) donghuaSeries(ctx context.Context, rawURL string) (*seriesDonghuaResponse, error) {
	body, err := c.anichinHTML(ctx, normalizeAnichinURL(rawURL))
	if err != nil {
		return nil, err
	}
	doc, err := htmlx.Parse(body)
	if err != nil {
		return nil, fmt.Errorf("parse anichin series: %w", err)
	}

	info := map[string]string{}
	for _, containerClass := range []string{"info-content", "infox"} {
		for _, container := range findClass(doc, "", containerClass) {
			for _, block := range findClass(container, "", "spe") {
				for _, span := range findClass(block, "span", "") {
					labelNode := firstClass(span, "b", "")
					label := strings.TrimSpace(strings.ReplaceAll(text(labelNode), ":", ""))
					if label == "" {
						continue
					}
					full := text(span)
					info[label] = strings.TrimSpace(strings.Replace(full, text(labelNode), "", 1))
				}
			}
		}
	}

	genres := []string{}
	for _, container := range findClass(doc, "", "genxed") {
		for _, link := range findClass(container, "a", "") {
			if name := text(link); name != "" {
				genres = append(genres, name)
			}
		}
	}
	if len(genres) == 0 {
		for _, link := range findClass(doc, "", "info-content") {
			for _, anchor := range findClass(link, "a", "") {
				if strings.Contains(htmlx.Attr(anchor, "href"), "/genres/") {
					if name := text(anchor); name != "" {
						genres = append(genres, name)
					}
				}
			}
		}
	}

	poster := imgSrc(firstClass(firstClass(doc, "", "thumb"), "img", ""))
	if poster == nil {
		poster = metaContent(doc, "property", "og:image")
	}

	rating := trimmedPtr(text(firstClass(doc, "", "numscore")))
	if rating == nil {
		fallback := firstClass(firstClass(firstClass(doc, "", "thumbook"), "", "rating"), "strong", "")
		rating = trimmedPtr(ratingPrefixPattern.ReplaceAllString(text(fallback), ""))
	}

	synopsis := trimmedPtr(text(firstClass(doc, "", "mindesc")))
	if synopsis == nil {
		synopsis = trimmedPtr(text(firstClass(firstClass(doc, "", "entry-content"), "p", "")))
	}

	episodes := []seriesEpisode{}
	for _, list := range findClass(doc, "", "eplister") {
		for _, unorderedList := range findClass(list, "ul", "") {
			for _, item := range findClass(unorderedList, "li", "") {
				link := firstClass(item, "a", "")
				if link == nil {
					continue
				}
				episodes = append(episodes, seriesEpisode{
					Episode: trimmedPtr(text(firstClass(link, "", "epl-num"))),
					Title:   trimmedPtr(text(firstClass(link, "", "epl-title"))),
					URL:     absAnichin(htmlx.Attr(link, "href")),
				})
			}
		}
	}

	return &seriesDonghuaResponse{
		Source:     purtvSource,
		Title:      text(firstClass(doc, "", "entry-title")),
		Poster:     poster,
		Rating:     rating,
		Genres:     genres,
		Synopsis:   synopsis,
		Info:       info,
		Episodes:   episodes,
		Pagenation: newPagenation(1, false),
	}, nil
}
