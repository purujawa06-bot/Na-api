package purtv

import (
	"bytes"
	"context"
	"encoding/json"
	"net/url"
	"regexp"

	"github.com/purujawa06-bot/na-api/backend/internal/webclient"
)

// m3u8Pattern detects HLS stream descriptors.
var m3u8Pattern = regexp.MustCompile(`(?i)mpegURL|m3u8`)

// extractDailymotionID pulls the access/public ID out of any Dailymotion URL.
func extractDailymotionID(rawURL string) string {
	if rawURL == "" {
		return ""
	}
	if match := dailymotionVideoParamPattern.FindStringSubmatch(rawURL); match != nil {
		if decoded, err := url.PathUnescape(match[1]); err == nil {
			return decoded
		}
		return match[1]
	}
	if match := dailymotionIDPattern.FindStringSubmatch(rawURL); match != nil {
		return match[1]
	}
	return ""
}

// resolveDailymotion resolves a Dailymotion URL to its full stream metadata.
func (c *client) resolveDailymotion(ctx context.Context, rawURL string) *dailymotionInfo {
	accessID := extractDailymotionID(rawURL)
	if accessID == "" {
		return nil
	}
	return c.fetchDailymotionInfo(ctx, accessID)
}

// fetchDailymotionInfo loads the player metadata for a Dailymotion ID.
func (c *client) fetchDailymotionInfo(ctx context.Context, accessID string) *dailymotionInfo {
	if accessID == "" {
		return nil
	}
	endpoint := "https://www.dailymotion.com/player/metadata/video/" + encodeURIComponent(accessID)
	resp, err := webclient.Get(ctx, endpoint, map[string]string{
		"User-Agent": webclient.UserAgentChrome,
		"Accept":     "application/json,*/*",
	})
	if err != nil {
		return nil
	}
	body, err := webclient.ReadBody(resp)
	if err != nil || resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil
	}

	var metadata struct {
		ID        *string         `json:"id"`
		Title     *string         `json:"title"`
		Duration  any             `json:"duration"`
		Private   *bool           `json:"private"`
		Qualities json.RawMessage `json:"qualities"`
		StreamHLS *string         `json:"stream_hls_url"`
	}
	if err := json.Unmarshal([]byte(body), &metadata); err != nil {
		return nil
	}
	publicID := deref(metadata.ID)
	if publicID == "" {
		return nil
	}

	streams := parseQualities(metadata.Qualities)
	var hlsURL *string
	for _, stream := range streams {
		if (stream.Type != nil && m3u8Pattern.MatchString(*stream.Type)) || m3u8Pattern.MatchString(stream.URL) {
			hlsURL = stringPtr(stream.URL)
			break
		}
	}
	if hlsURL == nil && len(streams) > 0 {
		hlsURL = stringPtr(streams[0].URL)
	}
	if hlsURL == nil {
		hlsURL = trimmedPtr(deref(metadata.StreamHLS))
	}

	return &dailymotionInfo{
		AccessID:  accessID,
		PublicID:  publicID,
		Title:     metadata.Title,
		Duration:  metadata.Duration,
		IsPrivate: metadata.Private,
		WatchURL:  "https://www.dailymotion.com/video/" + publicID,
		EmbedURL:  "https://www.dailymotion.com/embed/video/" + publicID,
		StreamURL: hlsURL,
		HLSURL:    hlsURL,
		Streams:   streams,
	}
}

// parseQualities flattens the `qualities` object while preserving the key
// order sent by Dailymotion (important for picking the same default stream).
func parseQualities(raw json.RawMessage) []dailymotionStream {
	streams := []dailymotionStream{}
	if len(raw) == 0 {
		return streams
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	token, err := decoder.Token()
	if err != nil {
		return streams
	}
	if delimiter, ok := token.(json.Delim); !ok || delimiter != '{' {
		return streams
	}
	for decoder.More() {
		keyToken, err := decoder.Token()
		if err != nil {
			break
		}
		quality, ok := keyToken.(string)
		if !ok {
			break
		}
		var items []struct {
			Type *string `json:"type"`
			URL  *string `json:"url"`
		}
		if err := decoder.Decode(&items); err != nil {
			break
		}
		for _, item := range items {
			if item.URL == nil || *item.URL == "" {
				continue
			}
			streams = append(streams, dailymotionStream{Quality: quality, Type: item.Type, URL: *item.URL})
		}
	}
	return streams
}
