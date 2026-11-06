package bill

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/purujawa06-bot/na-api/backend/internal/app"
	"github.com/purujawa06-bot/na-api/backend/internal/htmlx"
	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
	"github.com/purujawa06-bot/na-api/backend/internal/webclient"
)

// iescoResult is the API response for IESCO bill lookup.
type iescoResult struct {
	Success        bool   `json:"success"`
	Source         string `json:"source"`
	Type           string `json:"type"`
	Number         string `json:"number"`
	BillURL        string `json:"billUrl"`
	Reachable      bool   `json:"reachable"`
	UpstreamStatus int    `json:"upstreamStatus,omitempty"`
	Title          string `json:"title,omitempty"`
	Text           string `json:"text,omitempty"`
	Amount         string `json:"amount,omitempty"`
	DueDate        string `json:"dueDate,omitempty"`
	Error          string `json:"error,omitempty"`
}

type handler struct {
	deps *app.Deps
}

func Register(mux *http.ServeMux, deps *app.Deps) {
	h := &handler{deps: deps}
	mux.HandleFunc("GET /api/bill/iesco", h.handleGET)
	mux.HandleFunc("POST /api/bill/iesco", h.handlePOST)
}

func (h *handler) handleGET(w http.ResponseWriter, r *http.Request) {
	number := strings.TrimSpace(r.URL.Query().Get("number"))
	if number == "" {
		number = strings.TrimSpace(r.URL.Query().Get("refno"))
	}
	if number == "" {
		number = strings.TrimSpace(r.URL.Query().Get("customer_id"))
	}
	billType := strings.TrimSpace(r.URL.Query().Get("type"))
	if billType == "" {
		if r.URL.Query().Has("customer_id") {
			billType = "customer"
		} else {
			billType = "reference"
		}
	}
	fetch := r.URL.Query().Get("fetch") == "1" || r.URL.Query().Get("fetch") == "true"
	h.respond(w, r, number, billType, fetch)
}

func (h *handler) handlePOST(w http.ResponseWriter, r *http.Request) {
	body, err := decodeBody(r)
	if err != nil {
		httpx.JSON(w, http.StatusBadRequest, map[string]any{"error": "Body harus JSON: {\"number\": \"...\", \"type\": \"reference|customer\", \"fetch\": true}"})
		return
	}
	number := stringField(body, "number")
	if number == "" {
		number = stringField(body, "refno")
	}
	if number == "" {
		number = stringField(body, "customer_id")
	}
	billType := stringField(body, "type")
	if billType == "" {
		billType = "reference"
	}
	fetch := boolField(body, "fetch")
	h.respond(w, r, number, billType, fetch)
}

func (h *handler) respond(w http.ResponseWriter, r *http.Request, number, billType string, fetch bool) {
	number = strings.TrimSpace(strings.ReplaceAll(number, " ", ""))
	billType = strings.ToLower(strings.TrimSpace(billType))
	if billType != "customer" {
		billType = "reference"
	}

	var billURL string
	if billType == "customer" {
		if !regexp.MustCompile(`^\d{10}$`).MatchString(number) {
			httpx.JSON(w, http.StatusBadRequest, map[string]any{"success": false, "error": "customer_id harus 10 digit"})
			return
		}
		billURL = "https://bill.pitc.com.pk/iescobill/general?appno=" + number
	} else {
		if !regexp.MustCompile(`^\d{14}$`).MatchString(number) {
			httpx.JSON(w, http.StatusBadRequest, map[string]any{"success": false, "error": "refno harus 14 digit"})
			return
		}
		billURL = "https://bill.pitc.com.pk/gbill.aspx?refno=" + number
	}

	result := iescoResult{
		Success:   true,
		Source:    "iesco.com.pk / bill.pitc.com.pk",
		Type:      billType,
		Number:    number,
		BillURL:   billURL,
		Reachable: false,
	}

	if fetch {
		ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
		defer cancel()
		resp, err := webclient.Get(ctx, billURL, map[string]string{
			"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
		})
		if err != nil {
			result.Error = err.Error()
			httpx.JSON(w, http.StatusFailedDependency, result)
			return
		}
		body, readErr := webclient.ReadBody(resp)
		result.UpstreamStatus = resp.StatusCode
		if readErr != nil {
			result.Error = readErr.Error()
		}
		if resp.StatusCode >= 200 && resp.StatusCode < 400 {
			result.Reachable = true
		}
		doc, _ := htmlx.Parse(body)
		if doc != nil {
			for _, n := range htmlx.Find(doc, "title", "", "") {
				result.Title = htmlx.Text(n)
				break
			}
		}
		text := htmlx.Text(doc)
		if len(text) > 1500 {
			text = text[:1500]
		}
		result.Text = text

		amountRe := regexp.MustCompile(`(?i)(?:payable|amount|total)\s*[:\-]?\s*([\d,]+(?:\.\d+)?)`)
		if m := amountRe.FindStringSubmatch(text); len(m) > 1 {
			result.Amount = m[1]
		}
		dueRe := regexp.MustCompile(`(?i)due\s*date\s*[:\-]?\s*([A-Za-z0-9,\-\/ ]{6,30})`)
		if m := dueRe.FindStringSubmatch(text); len(m) > 1 {
			result.DueDate = strings.TrimSpace(m[1])
		}
	}

	httpx.JSON(w, http.StatusOK, result)
}

func decodeBody(r *http.Request) (map[string]any, error) {
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return nil, err
	}
	if body == nil {
		body = map[string]any{}
	}
	return body, nil
}

func stringField(body map[string]any, key string) string {
	if v, ok := body[key]; ok && v != nil {
		switch t := v.(type) {
		case string:
			return t
		default:
			return fmt.Sprint(t)
		}
	}
	return ""
}

func boolField(body map[string]any, key string) bool {
	if v, ok := body[key]; ok && v != nil {
		switch t := v.(type) {
		case bool:
			return t
		case string:
			l := strings.ToLower(strings.TrimSpace(t))
			return l == "1" || l == "true" || l == "yes"
		case float64:
			return t != 0
		}
	}
	return false
}
