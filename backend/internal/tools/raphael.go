package tools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"

	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
	"github.com/purujawa06-bot/na-api/backend/internal/webclient"
)

const (
	raphaelBase = "https://raphael.app"
	raphaelUA   = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36"

	// videoModel is the free model Raphael serves to anonymous callers.
	videoModel = "minimax-h3-turbo"
)

// videoAspects lists the aspect ratios accepted by the Raphael API.
var videoAspects = []string{"16:9", "9:16", "1:1", "4:3", "3:4", "21:9"}

var (
	raphaelCookieRegex = regexp.MustCompile(`raphael-anonymous-video=[^;]+`)

	videoProcessingStates = map[string]bool{
		"processing":       true,
		"pending_dispatch": true,
		"pending_payment":  true,
	}
	videoFailedStates = map[string]bool{
		"failed":                   true,
		"dispatch_failed":          true,
		"payment_failed":           true,
		"credits_deduction_failed": true,
	}
)

// raphaelHeaders builds the JSON request headers for raphael.app.
func raphaelHeaders(cookie string) map[string]string {
	headers := map[string]string{
		"content-type": "application/json",
		"user-agent":   raphaelUA,
		"origin":       raphaelBase,
		"referer":      raphaelBase + "/ai-video-generator",
		"accept":       "application/json",
	}
	if cookie != "" {
		headers["cookie"] = cookie
	}
	return headers
}

// normalizeRaphaelCookie accepts a full cookie string or a bare value.
func normalizeRaphaelCookie(cookie string) string {
	if cookie == "" {
		return ""
	}
	first := strings.TrimSpace(strings.Split(cookie, ";")[0])
	if first == "" {
		return ""
	}
	if strings.Contains(first, "=") {
		return first
	}
	return "raphael-anonymous-video=" + first
}

// requestRaphaelIdentity obtains a fresh anonymous identity cookie.
func requestRaphaelIdentity(ctx context.Context) (string, error) {
	resp, err := webclient.PostJSON(ctx, raphaelBase+"/api/video/anon/identity",
		map[string]any{}, raphaelHeaders(""))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	for _, header := range resp.Header.Values("Set-Cookie") {
		if cookie := raphaelCookieRegex.FindString(header); cookie != "" && resp.StatusCode >= 200 && resp.StatusCode <= 299 {
			return cookie, nil
		}
	}
	if resp.StatusCode == http.StatusTooManyRequests {
		return "", newToolsError(http.StatusTooManyRequests, "Limit identitas Raphael tercapai (UPLOAD_RATE_LIMITED)")
	}
	return "", newToolsError(http.StatusBadGateway, "Gagal membuat identitas anonim Raphael")
}

// videoTicket is the queue ticket returned by Raphael.
type videoTicket struct {
	ticket string
	waitMS int
	cookie string
	aspect string
}

// requestVideoTicket asks Raphael for a queue ticket.
func requestVideoTicket(ctx context.Context, prompt, aspect, cookie string) (videoTicket, error) {
	if prompt == "" {
		return videoTicket{}, newToolsError(http.StatusBadRequest, "Parameter prompt wajib diisi")
	}
	if len(prompt) > 2000 {
		return videoTicket{}, newToolsError(http.StatusBadRequest, "Parameter prompt terlalu panjang (maks 2000 karakter)")
	}
	if !containsString(videoAspects, aspect) {
		return videoTicket{}, newToolsError(http.StatusBadRequest,
			"Parameter aspect tidak valid. Pilihan: "+strings.Join(videoAspects, ", "))
	}
	if cookie == "" {
		identity, err := requestRaphaelIdentity(ctx)
		if err != nil {
			return videoTicket{}, err
		}
		cookie = identity
	}

	resp, err := webclient.PostJSON(ctx, raphaelBase+"/api/video/anon/ticket",
		struct {
			Prompt string `json:"prompt"`
			Aspect string `json:"aspect"`
		}{Prompt: prompt, Aspect: aspect}, raphaelHeaders(cookie))
	if err != nil {
		return videoTicket{}, err
	}
	defer resp.Body.Close()

	var envelope struct {
		Code    *int   `json:"code"`
		Message string `json:"message"`
		Data    struct {
			Ticket string  `json:"ticket"`
			WaitMS float64 `json:"wait_ms"`
		} `json:"data"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, webclient.MaxBodyBytes)).Decode(&envelope); err != nil {
		return videoTicket{}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 || envelope.Code == nil || *envelope.Code != 0 || envelope.Data.Ticket == "" {
		message := envelope.Message
		if message == "" {
			message = fmt.Sprintf("Ticket gagal (HTTP %d)", resp.StatusCode)
		}
		if resp.StatusCode == http.StatusBadRequest {
			return videoTicket{}, newToolsError(http.StatusBadRequest, message)
		}
		return videoTicket{}, newToolsError(http.StatusBadGateway, message)
	}
	return videoTicket{
		ticket: envelope.Data.Ticket,
		waitMS: int(envelope.Data.WaitMS),
		cookie: cookie,
		aspect: aspect,
	}, nil
}

// redeemVideoTicket exchanges a queue ticket for a job id.
func redeemVideoTicket(ctx context.Context, ticket, cookie string) (string, error) {
	if strings.TrimSpace(ticket) == "" {
		return "", newToolsError(http.StatusBadRequest, "Parameter ticket wajib diisi")
	}
	normalized := normalizeRaphaelCookie(cookie)
	if normalized == "" {
		return "", newToolsError(http.StatusBadRequest, "Parameter cookie wajib diisi")
	}

	resp, err := webclient.PostJSON(ctx, raphaelBase+"/api/video/anon/redeem",
		struct {
			Ticket string `json:"ticket"`
		}{Ticket: strings.TrimSpace(ticket)}, raphaelHeaders(normalized))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var envelope struct {
		Code    *int   `json:"code"`
		Message string `json:"message"`
		Data    struct {
			JobID  string  `json:"job_id"`
			WaitMS float64 `json:"wait_ms"`
		} `json:"data"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, webclient.MaxBodyBytes)).Decode(&envelope); err != nil {
		return "", err
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 || envelope.Code == nil || *envelope.Code != 0 || envelope.Data.JobID == "" {
		message := envelope.Message
		if message == "" {
			message = fmt.Sprintf("Redeem gagal (HTTP %d)", resp.StatusCode)
		}
		switch message {
		case "QUEUE_NOT_READY":
			waitMS := int(envelope.Data.WaitMS)
			if waitMS <= 0 {
				waitMS = 15000
			}
			return "", &toolsError{
				status:  http.StatusConflict,
				message: "Antrean belum siap (QUEUE_NOT_READY), coba lagi setelah wait_ms",
				waitMS:  waitMS,
			}
		case "QUEUE_TICKET_INVALID":
			return "", newToolsError(http.StatusBadRequest, "Tiket tidak valid/kedaluwarsa (QUEUE_TICKET_INVALID)")
		case "ANON_DAILY_LIMIT":
			return "", newToolsError(http.StatusTooManyRequests, "Limit harian video gratis tercapai (ANON_DAILY_LIMIT)")
		}
		if resp.StatusCode == http.StatusBadRequest {
			return "", newToolsError(http.StatusBadRequest, message)
		}
		return "", newToolsError(http.StatusBadGateway, message)
	}
	return envelope.Data.JobID, nil
}

// videoJobStatus is the normalized job status returned to clients.
type videoJobStatus struct {
	Status         string   `json:"status"`
	UpstreamStatus string   `json:"upstream_status"`
	Progress       *float64 `json:"progress"`
	Videos         []string `json:"videos"`
	Thumbnails     []string `json:"thumbnails"`
	NextPollMS     *float64 `json:"next_poll_ms"`
}

// fetchVideoJobStatus polls the status of a Raphael video job.
func fetchVideoJobStatus(ctx context.Context, jobID, cookie string) (videoJobStatus, error) {
	if strings.TrimSpace(jobID) == "" {
		return videoJobStatus{}, newToolsError(http.StatusBadRequest, "Parameter job_id wajib diisi")
	}
	normalized := normalizeRaphaelCookie(cookie)
	if normalized == "" {
		return videoJobStatus{}, newToolsError(http.StatusBadRequest, "Parameter cookie wajib diisi")
	}

	endpoint := raphaelBase + "/api/video/anon/job/" + url.PathEscape(strings.TrimSpace(jobID))
	resp, err := webclient.Get(ctx, endpoint, raphaelHeaders(normalized))
	if err != nil {
		return videoJobStatus{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return videoJobStatus{}, newToolsError(http.StatusNotFound, "Job tidak ditemukan (mungkin sudah dibersihkan server)")
	}

	var envelope struct {
		Code    *int   `json:"code"`
		Message string `json:"message"`
		Data    *struct {
			Status     string   `json:"status"`
			Progress   *float64 `json:"progress"`
			NextPollMS *float64 `json:"nextPollMs"`
			Tasks      []struct {
				Meta struct {
					Status string `json:"status"`
				} `json:"meta"`
				Assets struct {
					VideoURL     string `json:"videoUrl"`
					ThumbnailURL string `json:"thumbnailUrl"`
				} `json:"assets"`
			} `json:"tasks"`
		} `json:"data"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, webclient.MaxBodyBytes)).Decode(&envelope); err != nil {
		return videoJobStatus{}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 || envelope.Code == nil || *envelope.Code != 0 || envelope.Data == nil {
		message := envelope.Message
		if message == "" {
			message = fmt.Sprintf("Status job gagal (HTTP %d)", resp.StatusCode)
		}
		return videoJobStatus{}, newToolsError(http.StatusBadGateway, message)
	}

	upstream := envelope.Data.Status
	if upstream == "" {
		upstream = "processing"
	}
	videos := make([]string, 0, len(envelope.Data.Tasks))
	thumbnails := make([]string, 0, len(envelope.Data.Tasks))
	for _, task := range envelope.Data.Tasks {
		if task.Meta.Status != "success" || task.Assets.VideoURL == "" {
			continue
		}
		videos = append(videos, task.Assets.VideoURL)
		thumbnails = append(thumbnails, task.Assets.ThumbnailURL)
	}

	var status string
	switch {
	case videoProcessingStates[upstream]:
		status = "processing"
	case upstream == "partial":
		status = "partial"
	case videoFailedStates[upstream]:
		status = "failed"
	case len(videos) > 0:
		status = "complete"
	default:
		status = "processing"
	}

	return videoJobStatus{
		Status:         status,
		UpstreamStatus: upstream,
		Progress:       envelope.Data.Progress,
		Videos:         videos,
		Thumbnails:     thumbnails,
		NextPollMS:     envelope.Data.NextPollMS,
	}, nil
}

// videoTicketResponse is the POST /api/text2video success payload.
type videoTicketResponse struct {
	Success     bool   `json:"success"`
	Status      string `json:"status"`
	Source      string `json:"source"`
	Model       string `json:"model"`
	Ticket      string `json:"ticket"`
	WaitMS      int    `json:"wait_ms"`
	WaitSeconds int    `json:"wait_seconds"`
	Cookie      string `json:"cookie"`
	Aspect      string `json:"aspect"`
	Next        struct {
		RedeemAfterMS int    `json:"redeem_after_ms"`
		RedeemURL     string `json:"redeem_url"`
		Hint          string `json:"hint"`
	} `json:"next"`
}

// requestVideoTicket handles POST /api/text2video.
func (h *handlers) requestVideoTicket(w http.ResponseWriter, r *http.Request) {
	body, ok := decodeBody(w, r)
	if !ok {
		return
	}
	prompt, valid := stringValue(body, "prompt")
	if !valid || prompt == "" {
		failJSON(w, http.StatusBadRequest, "Parameter prompt wajib diisi")
		return
	}
	if len(prompt) > 2000 {
		failJSON(w, http.StatusBadRequest, "Parameter prompt terlalu panjang (maks 2000 karakter)")
		return
	}
	aspect := "16:9"
	if requested, exists := body["aspect"]; exists {
		if typed, isString := requested.(string); isString {
			aspect = strings.TrimSpace(typed)
		}
	}
	if !containsString(videoAspects, aspect) {
		failJSON(w, http.StatusBadRequest,
			"Parameter aspect tidak valid. Pilihan: "+strings.Join(videoAspects, ", "))
		return
	}

	ctx, cancel := h.requestContext(r)
	defer cancel()
	ticket, err := requestVideoTicket(ctx, prompt, aspect, "")
	if err != nil {
		status := errorStatus(err)
		if status != http.StatusBadRequest && status != http.StatusTooManyRequests {
			status = http.StatusBadGateway
		}
		failJSON(w, status, errorMessage(err, "Gagal meminta tiket video"))
		return
	}

	response := videoTicketResponse{
		Success:     true,
		Status:      "queued",
		Source:      "raphael",
		Model:       videoModel,
		Ticket:      ticket.ticket,
		WaitMS:      ticket.waitMS,
		WaitSeconds: ceilSeconds(ticket.waitMS),
		Cookie:      ticket.cookie,
		Aspect:      ticket.aspect,
	}
	response.Next.RedeemAfterMS = ticket.waitMS
	response.Next.RedeemURL = "/api/text2video/redeem?ticket=" + url.QueryEscape(ticket.ticket) +
		"&cookie=" + url.QueryEscape(ticket.cookie)
	response.Next.Hint = "Tunggu wait_ms lalu GET redeem_url untuk dapat job_id"

	httpx.SetNoStore(w)
	httpx.OK(w, response)
}

// redeemVideoTicket handles GET /api/text2video/redeem.
func (h *handlers) redeemVideoTicket(w http.ResponseWriter, r *http.Request) {
	ticket := strings.TrimSpace(httpx.QueryStr(r, "ticket", ""))
	cookie := strings.TrimSpace(httpx.QueryStr(r, "cookie", ""))
	if ticket == "" {
		failJSON(w, http.StatusBadRequest, "Parameter ticket wajib diisi")
		return
	}
	if cookie == "" {
		failJSON(w, http.StatusBadRequest, "Parameter cookie wajib diisi")
		return
	}

	ctx, cancel := h.requestContext(r)
	defer cancel()
	jobID, err := redeemVideoTicket(ctx, ticket, cookie)
	if err != nil {
		var typed *toolsError
		if errors.As(err, &typed) && typed.status == http.StatusConflict {
			httpx.JSON(w, http.StatusConflict, struct {
				Success     bool   `json:"success"`
				Status      string `json:"status"`
				Error       string `json:"error"`
				WaitMS      int    `json:"wait_ms"`
				WaitSeconds int    `json:"wait_seconds"`
			}{
				Success:     false,
				Status:      "queued",
				Error:       typed.message,
				WaitMS:      typed.waitMS,
				WaitSeconds: ceilSeconds(typed.waitMS),
			})
			return
		}
		status := errorStatus(err)
		if status != http.StatusBadRequest && status != http.StatusNotFound && status != http.StatusTooManyRequests {
			status = http.StatusBadGateway
		}
		failJSON(w, status, errorMessage(err, "Gagal menukar tiket"))
		return
	}

	httpx.SetNoStore(w)
	httpx.OK(w, struct {
		Success   bool   `json:"success"`
		Status    string `json:"status"`
		Source    string `json:"source"`
		JobID     string `json:"job_id"`
		StatusURL string `json:"status_url"`
		Hint      string `json:"hint"`
	}{
		Success: true,
		Status:  "submitted",
		Source:  "raphael",
		JobID:   jobID,
		StatusURL: "/api/text2video/status?job_id=" + url.QueryEscape(jobID) +
			"&cookie=" + url.QueryEscape(cookie),
		Hint: "Poll GET status_url sampai status complete (videoUrl)",
	})
}

// videoStatus handles GET /api/text2video/status.
func (h *handlers) videoStatus(w http.ResponseWriter, r *http.Request) {
	jobID := strings.TrimSpace(httpx.QueryStr(r, "job_id", ""))
	if jobID == "" {
		jobID = strings.TrimSpace(httpx.QueryStr(r, "jobId", ""))
	}
	cookie := strings.TrimSpace(httpx.QueryStr(r, "cookie", ""))
	if jobID == "" {
		failJSON(w, http.StatusBadRequest, "Parameter job_id wajib diisi")
		return
	}
	if cookie == "" {
		failJSON(w, http.StatusBadRequest, "Parameter cookie wajib diisi")
		return
	}

	ctx, cancel := h.requestContext(r)
	defer cancel()
	status, err := fetchVideoJobStatus(ctx, jobID, cookie)
	if err != nil {
		code := errorStatus(err)
		if code != http.StatusBadRequest && code != http.StatusNotFound {
			code = http.StatusBadGateway
		}
		failJSON(w, code, errorMessage(err, "Gagal cek status job"))
		return
	}

	httpx.SetNoStore(w)
	httpx.OK(w, struct {
		Success        bool     `json:"success"`
		Source         string   `json:"source"`
		Status         string   `json:"status"`
		UpstreamStatus string   `json:"upstream_status"`
		Progress       *float64 `json:"progress"`
		Videos         []string `json:"videos"`
		Thumbnails     []string `json:"thumbnails"`
		NextPollMS     *float64 `json:"next_poll_ms"`
	}{
		Success:        true,
		Source:         "raphael",
		Status:         status.Status,
		UpstreamStatus: status.UpstreamStatus,
		Progress:       status.Progress,
		Videos:         status.Videos,
		Thumbnails:     status.Thumbnails,
		NextPollMS:     status.NextPollMS,
	})
}
