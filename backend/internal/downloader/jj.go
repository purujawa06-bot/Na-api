package downloader

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/mxschmitt/playwright-go"
	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
)

const (
	jjBaseURL       = "https://cc.fgsi.dpdns.org"
	jjCDPURL        = "wss://light-panda-cdp.onrender.com/"
	jjMaxPhotoBytes = 15 << 20 // 15 MB, selaras batas situs
	jjRenderTimeout = 15 * time.Minute
	jjPollInterval  = 5 * time.Second
	jjJobTTL        = 30 * time.Minute
)

// jjTemplate describes one CapCut template from the JJ site.
type jjTemplate struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Slots   int    `json:"slots"`
	Ratio   string `json:"ratio,omitempty"`
	ViewURL string `json:"view_url"`
}

// jjPhoto is one uploaded image held in memory for CDP injection.
type jjPhoto struct {
	Name string
	Mime string
	Data []byte
}

type jjJob struct {
	ID          string      `json:"id"`
	Status      string      `json:"status"` // processing|selesai|gagal|timeout|error
	Success     bool        `json:"success"`
	Source      string      `json:"source"`
	Template    *jjTemplate `json:"template,omitempty"`
	PhotoCount  int         `json:"photo_count"`
	DownloadURL string      `json:"download_url,omitempty"`
	ViewAction  string      `json:"view_action,omitempty"`
	TaskText    string      `json:"task_text,omitempty"`
	Error       string      `json:"error,omitempty"`
	Note        string      `json:"note,omitempty"`
	CreatedAt   time.Time   `json:"created_at"`
	UpdatedAt   time.Time   `json:"updated_at"`
}

var (
	jjJobsMu sync.RWMutex
	jjJobs   = map[string]*jjJob{}

	reJJID = regexp.MustCompile(`^\d+$`)
)

var jjStaticTemplates = []jjTemplate{
	{ID: "7403664152742366472", Title: "Testing", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7403664152742366472"},
	{ID: "7448610737376841021", Title: "DJ ADA POKEMON SLOW", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7448610737376841021"},
	{ID: "7340205796568976658", Title: "DJ HABIBI V2", Slots: 5, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7340205796568976658"},
	{ID: "7378467903340924167", Title: "Kurang tahu namanya", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7378467903340924167"},
	{ID: "7341991210350939399", Title: "OLD KANE SIMPLE", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7341991210350939399"},
	{ID: "7348779539301977352", Title: "DJ KANE NIGHT", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7348779539301977352"},
	{ID: "7434697031710444817", Title: "DJ TOT TOT", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7434697031710444817"},
	{ID: "7423373312283151632", Title: "DJ SEREM", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7423373312283151632"},
	{ID: "7438072867821997313", Title: "🗿", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7438072867821997313"},
	{ID: "7322807375067434258", Title: "Dj Seram #2 🗿", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7322807375067434258"},
	{ID: "7431150197352222008", Title: "SOUNDNYA KANE BGT", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7431150197352222008"},
	{ID: "7345836624850308354", Title: "SOUNDNYA SEREM", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7345836624850308354"},
	{ID: "7348035625435647233", Title: "JJ Kane", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7348035625435647233"},
	{ID: "7350269782215625986", Title: "JJ Kece", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7350269782215625986"},
	{ID: "7460349965882166581", Title: "JJ Kece Cuy", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7460349965882166581"},
	{ID: "7434163588408921361", Title: "JJ Kece Cuy Lagi", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7434163588408921361"},
	{ID: "7408701445559635216", Title: "JJ Capcut Kece", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7408701445559635216"},
	{ID: "7428190214230756616", Title: "jj mirip am wak", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7428190214230756616"},
	{ID: "7397036418595409160", Title: "loop mirip am", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7397036418595409160"},
	{ID: "7426151786249080080", Title: "JJ CAPCUT KECE", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7426151786249080080"},
	{ID: "7460124436167953717", Title: "versi 3:4 jj kane", Slots: 3, Ratio: "3:4", ViewURL: "https://cc.fgsi.dpdns.org/view/7460124436167953717"},
	{ID: "7436627061160086837", Title: "JJ 3:4 AM kane", Slots: 3, Ratio: "3:4", ViewURL: "https://cc.fgsi.dpdns.org/view/7436627061160086837"},
	{ID: "7423006504594296065", Title: "Transisi Mirip AM ( Terkele kele kana )", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7423006504594296065"},
	{ID: "7435906131127504189", Title: "kece banget cuy", Slots: 2, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7435906131127504189"},
	{ID: "7398723144262962433", Title: "DJ IN YOUR EYES", Slots: 4, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7398723144262962433"},
	{ID: "7412449358651673872", Title: "JJ-CAPCUT-KECE", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7412449358651673872"},
	{ID: "7377938370237861136", Title: "PCARKUH DITIKUNG", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7377938370237861136"},
	{ID: "7416123959495740688", Title: "JJ CAPCUT KECEE", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7416123959495740688"},
	{ID: "7610655389452995841", Title: "Collab Berdua", Slots: 4, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7610655389452995841"},
	{ID: "7649585745329540360", Title: "jj", Slots: 1, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7649585745329540360"},
	{ID: "7350140444715552018", Title: "Ver 1:1", Slots: 3, Ratio: "1:1", ViewURL: "https://cc.fgsi.dpdns.org/view/7350140444715552018"},
	{ID: "7421126835024579896", Title: "Iri Bilang bOss", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7421126835024579896"},
	{ID: "7422986945934003464", Title: "JJ-KANE-CUY", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7422986945934003464"},
	{ID: "7418157844849036561", Title: "JJ-CAPCUT-VERSI-AM", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7418157844849036561"},
	{ID: "7420380949247986960", Title: "JJ-CAPCUT-VERSI-AM-☠️", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7420380949247986960"},
	{ID: "7394014832195816705", Title: "JJ Sweet Love", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7394014832195816705"},
	{ID: "7374017712399371528", Title: "SHAKE-AM", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7374017712399371528"},
	{ID: "7405909526802615570", Title: "SOUND-KANE-GINI", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7405909526802615570"},
	{ID: "7363692697065901330", Title: "JJ-AM-KECE", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7363692697065901330"},
	{ID: "7333146802067197192", Title: "SOUND-KECE", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7333146802067197192"},
	{ID: "7410928797391867153", Title: "JJ-CAPCUT-KECE", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7410928797391867153"},
	{ID: "7413527393639353601", Title: "JJ-CAPCUT-KECE-NGOMONG DENGAN SIAPA??", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7413527393639353601"},
	{ID: "7343156874193210642", Title: "JJ-berjalan-AM", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7343156874193210642"},
	{ID: "7412253343436901648", Title: "Anomasep", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7412253343436901648"},
	{ID: "7408552894636559633", Title: "im-so-sad", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7408552894636559633"},
	{ID: "7312083605558267137", Title: "Loop kece amat [ AlightMotion ]", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7312083605558267137"},
	{ID: "7459768171373907253", Title: "kece/kane [ AlightMotion ]", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7459768171373907253"},
	{ID: "7442650055275810109", Title: "JJ VERSI 3:4", Slots: 3, Ratio: "3:4", ViewURL: "https://cc.fgsi.dpdns.org/view/7442650055275810109"},
	{ID: "7363445564756823303", Title: "ganti ktp guys🗿", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7363445564756823303"},
	{ID: "7445213389737020733", Title: "Dj give you love", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7445213389737020733"},
	{ID: "7169857076133465345", Title: "CapCut juga keren kok 😎", Slots: 5, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7169857076133465345"},
	{ID: "7344352078552157447", Title: "Sound Ilmuan🗿", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7344352078552157447"},
	{ID: "7411302294647573776", Title: "masa ga dicobain🥵", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7411302294647573776"},
	{ID: "7410024595463425288", Title: "Sekane ini guys 👽", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7410024595463425288"},
	{ID: "7403288328155745554", Title: "🗿🗿HARI2 SEPI MLU", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7403288328155745554"},
	{ID: "7441568696587324725", Title: ". ( Rekomendasi Untuk Kane )", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7441568696587324725"},
	{ID: "7440808939366665525", Title: ". Dj Ayuk Syng Culik aku dong ( Rekomendasi Untuk Collab )", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7440808939366665525"},
	{ID: "7392574284004183303", Title: "konsep Atur sendiri🗿 ( Aaaaaaaaaaaaaaaaa )", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7392574284004183303"},
	{ID: "7381067467881286919", Title: "gas cobain🗿☕ Dj Geri Sang geee", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7381067467881286919"},
	{ID: "7438954440826031413", Title: ". ( Tipis Saja )", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7438954440826031413"},
	{ID: "7387380603722796296", Title: "Dj Aku Cuma cuma dgn mu...", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7387380603722796296"},
	{ID: "7410738697160740114", Title: "#fyp#trend#uyekece#mastertobe ( Rekomendasi Untuk Kece )", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7410738697160740114"},
	{ID: "7423777183128194312", Title: "jj kece", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7423777183128194312"},
	{ID: "7308175448251337986", Title: "GABISA KECE", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7308175448251337986"},
	{ID: "7417334485378780434", Title: "jj smooth capcut nih😝👊🏻 KANE BGT INI WOI", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7417334485378780434"},
	{ID: "7399242683727842615", Title: "Lupa nama DJ nya tapi ini viral kok pada zamannya 🤫", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7399242683727842615"},
	{ID: "7413725674562653457", Title: "tangkisdang ( Rekomendasi Untuk Cool )", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7413725674562653457"},
	{ID: "7306823497748172033", Title: "Trend Lag Jadi HD ( Rekomendasi Untuk Prank Lag )", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7306823497748172033"},
	{ID: "7416871527536217399", Title: "SAFONAMIX OLD ( Rekomendasi Untuk Anime )", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7416871527536217399"},
	{ID: "7424770329026874625", Title: "Trend 60Fps!!?", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7424770329026874625"},
	{ID: "7327729978529926407", Title: "DJ CLEAN BANDIT BABY", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7327729978529926407"},
	{ID: "7435112288979406097", Title: "nyoba style doctor kece nggk 😹🗿", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7435112288979406097"},
	{ID: "7447107605618609469", Title: "JJ MENINA DO JOBS ( Rekomendasi Untuk Spill )", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7447107605618609469"},
	{ID: "7358081619162418450", Title: "JJ LONCAT LONCAT ( Rekomendasi Untuk Ep Ep )", Slots: 4, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7358081619162418450"},
	{ID: "7344916176683814152", Title: "JJ BERJALAN AM V2", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7344916176683814152"},
	{ID: "7452318274177518901", Title: "Dj Pale pale pale... JJ KECE MIRIP AM", Slots: 3, Ratio: "", ViewURL: "https://cc.fgsi.dpdns.org/view/7452318274177518901"},
}

func jjNewID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("jj%d", time.Now().UnixNano())
	}
	return "jj_" + hex.EncodeToString(b)
}

func jjStoreJob(job *jjJob) {
	jjJobsMu.Lock()
	// cleanup expired
	now := time.Now()
	for id, j := range jjJobs {
		if now.Sub(j.UpdatedAt) > jjJobTTL {
			delete(jjJobs, id)
		}
	}
	jjJobs[job.ID] = job
	jjJobsMu.Unlock()
}

func jjGetJob(id string) *jjJob {
	jjJobsMu.RLock()
	j, ok := jjJobs[id]
	jjJobsMu.RUnlock()
	if !ok {
		return nil
	}
	return j
}

func jjUpdateJob(id string, fn func(*jjJob)) {
	jjJobsMu.Lock()
	if j, ok := jjJobs[id]; ok {
		fn(j)
		j.UpdatedAt = time.Now()
	}
	jjJobsMu.Unlock()
}

func jjJobSnapshot(j *jjJob) map[string]any {
	jjJobsMu.RLock()
	defer jjJobsMu.RUnlock()
	resp := map[string]any{
		"success":     j.Success,
		"job_id":      j.ID,
		"status":      j.Status,
		"source":      j.Source,
		"photo_count": j.PhotoCount,
		"created_at":  j.CreatedAt.Format(time.RFC3339),
		"updated_at":  j.UpdatedAt.Format(time.RFC3339),
	}
	if j.Template != nil {
		resp["template"] = j.Template
	}
	if j.DownloadURL != "" {
		resp["download_url"] = j.DownloadURL
	}
	if j.ViewAction != "" {
		resp["view_action"] = j.ViewAction
	}
	if j.TaskText != "" {
		resp["task_text"] = j.TaskText
	}
	if j.Error != "" {
		resp["error"] = j.Error
	}
	if j.Note != "" {
		resp["note"] = j.Note
	}
	return resp
}

func (h *handler) jjGET(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.URL.Query().Get("id"))
	if id == "" {
		id = strings.TrimSpace(r.URL.Query().Get("job_id"))
	}
	if id == "" {
		httpx.JSON(w, http.StatusBadRequest, map[string]any{
			"success": false,
			"status":  400,
			"message": "Parameter 'id' (job_id) wajib diisi",
		})
		return
	}
	job := jjGetJob(id)
	if job == nil {
		httpx.JSON(w, http.StatusNotFound, map[string]any{
			"success": false,
			"status":  404,
			"message": "Job tidak ditemukan atau sudah kedaluwarsa",
		})
		return
	}
	status := http.StatusOK
	switch job.Status {
	case "processing":
		status = http.StatusAccepted
	case "error", "gagal", "timeout":
		status = http.StatusFailedDependency
	}
	httpx.JSON(w, status, jjJobSnapshot(job))
}

func (h *handler) jjPOST(w http.ResponseWriter, r *http.Request) {
	status, payload := h.handleJJCreate(r)
	httpx.JSON(w, status, payload)
}

func (h *handler) handleJJCreate(r *http.Request) (int, map[string]any) {
	// multipart body: field file "photos"/"files"/"file" (multiple), opsional "template_id".
	ct := r.Header.Get("Content-Type")
	if !strings.Contains(strings.ToLower(ct), "multipart/form-data") {
		return http.StatusBadRequest, map[string]any{
			"success": false,
			"error":   "Gunakan multipart/form-data dengan field file 'photos' (bisa lebih dari satu) dan opsional 'template_id'",
		}
	}
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		return http.StatusBadRequest, map[string]any{"success": false, "error": "Gagal membaca form: " + err.Error()}
	}

	templateID := strings.TrimSpace(r.FormValue("template_id"))
	if templateID == "" {
		templateID = strings.TrimSpace(r.FormValue("template"))
	}
	if templateID != "" && !reJJID.MatchString(templateID) {
		return http.StatusBadRequest, map[string]any{
			"success": false,
			"error":   "template_id tidak valid",
		}
	}

	photos, err := collectJJPhotos(r)
	if err != nil {
		return http.StatusBadRequest, map[string]any{"success": false, "error": err.Error()}
	}
	if len(photos) == 0 {
		return http.StatusBadRequest, map[string]any{
			"success": false,
			"error":   "Minimal 1 foto wajib diunggah (field: photos/files/file)",
		}
	}

	templates := jjFetchTemplates()
	if len(templates) == 0 {
		return http.StatusFailedDependency, map[string]any{
			"success": false,
			"error":   "Daftar template JJ kosong/tidak dapat dibaca",
		}
	}

	maxSlots := 0
	for _, t := range templates {
		if t.Slots > maxSlots {
			maxSlots = t.Slots
		}
	}
	if len(photos) > maxSlots {
		return http.StatusBadRequest, map[string]any{
			"success":    false,
			"error":      fmt.Sprintf("Jumlah foto (%d) melebihi slot terbanyak template (%d)", len(photos), maxSlots),
			"max_photos": maxSlots,
		}
	}

	selected, selErr := jjPickTemplate(templates, len(photos), templateID)
	if selErr != nil {
		supported := jjSupportedSlots(templates)
		return http.StatusBadRequest, map[string]any{
			"success":         false,
			"error":           selErr.Error(),
			"photo_count":     len(photos),
			"supported_slots": supported,
			"max_photos":      maxSlots,
		}
	}

	now := time.Now()
	job := &jjJob{
		ID:         jjNewID(),
		Status:     "processing",
		Success:    false,
		Source:     jjBaseURL,
		Template:   &selected,
		PhotoCount: len(photos),
		Note:       "Render berjalan di latar; cek status via GET ?id=. Tautan hasil bertoken/bermasa berlaku.",
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	jjStoreJob(job)

	go jjRunJob(job.ID, selected, photos)

	return http.StatusAccepted, jjJobSnapshot(job)
}

func jjRunJob(id string, tpl jjTemplate, photos []jjPhoto) {
	ctx, cancel := context.WithTimeout(context.Background(), jjRenderTimeout+2*time.Minute)
	defer cancel()

	result, genErr := jjGenerate(ctx, tpl, photos)
	jjUpdateJob(id, func(j *jjJob) {
		if genErr != nil {
			j.Status = "error"
			j.Success = false
			j.Error = genErr.Error()
			return
		}
		j.TaskText = result.TaskText
		j.ViewAction = result.ViewURL
		if result.Done && result.DownloadURL != "" {
			j.Status = "selesai"
			j.Success = true
			j.DownloadURL = result.DownloadURL
			j.Note = "Video berhasil dirender. Tautan hasil bertoken/bermasa berlaku."
			return
		}
		if result.Failed {
			j.Status = "gagal"
			j.Success = false
			if j.Error == "" {
				j.Error = "Render gagal pada sisi penyedia template"
			}
			return
		}
		j.Status = "timeout"
		j.Success = false
		j.Error = "Render melewati batas waktu tanpa hasil unduhan"
	})
}

func collectJJPhotos(r *http.Request) ([]jjPhoto, error) {
	if r.MultipartForm == nil {
		return nil, nil
	}
	keys := []string{"photos", "files", "file", "images", "image"}
	var out []jjPhoto
	for _, k := range keys {
		fhs := r.MultipartForm.File[k]
		for _, fh := range fhs {
			if fh == nil {
				continue
			}
			if fh.Size > jjMaxPhotoBytes {
				return nil, fmt.Errorf("file %s melebihi batas %dMB", fh.Filename, jjMaxPhotoBytes/(1<<20))
			}
			f, err := fh.Open()
			if err != nil {
				return nil, err
			}
			data, err := io.ReadAll(io.LimitReader(f, jjMaxPhotoBytes+1))
			f.Close()
			if err != nil {
				return nil, err
			}
			if int64(len(data)) > jjMaxPhotoBytes {
				return nil, fmt.Errorf("file %s melebihi batas %dMB", fh.Filename, jjMaxPhotoBytes/(1<<20))
			}
			mime := strings.ToLower(strings.TrimSpace(fh.Header.Get("Content-Type")))
			if mime == "" {
				mime = http.DetectContentType(data)
			}
			if !strings.HasPrefix(mime, "image/") {
				return nil, fmt.Errorf("file %s bukan gambar (content-type: %s)", fh.Filename, mime)
			}
			name := strings.TrimSpace(fh.Filename)
			if name == "" {
				name = fmt.Sprintf("photo-%d.jpg", len(out)+1)
			}
			out = append(out, jjPhoto{Name: name, Mime: mime, Data: data})
		}
	}
	return out, nil
}

func jjSupportedSlots(ts []jjTemplate) []int {
	seen := map[int]bool{}
	for _, t := range ts {
		if t.Slots > 0 {
			seen[t.Slots] = true
		}
	}
	out := make([]int, 0, len(seen))
	for s := range seen {
		out = append(out, s)
	}
	// small sort asc
	for i := 0; i < len(out); i++ {
		for j := i + 1; j < len(out); j++ {
			if out[j] < out[i] {
				out[i], out[j] = out[j], out[i]
			}
		}
	}
	return out
}

func jjPickTemplate(ts []jjTemplate, photoCount int, forceID string) (jjTemplate, error) {
	if forceID != "" {
		for _, t := range ts {
			if t.ID == forceID {
				if t.Slots != photoCount {
					return jjTemplate{}, fmt.Errorf("template %s membutuhkan %d foto, tetapi diterima %d foto", forceID, t.Slots, photoCount)
				}
				return t, nil
			}
		}
		return jjTemplate{}, fmt.Errorf("template_id %s tidak ditemukan", forceID)
	}
	cands := make([]jjTemplate, 0)
	for _, t := range ts {
		if t.Slots == photoCount {
			cands = append(cands, t)
		}
	}
	if len(cands) == 0 {
		return jjTemplate{}, fmt.Errorf("tidak ada template yang cocok untuk %d foto", photoCount)
	}
	n, err := rand.Int(rand.Reader, big.NewInt(int64(len(cands))))
	if err != nil {
		return cands[time.Now().UnixNano()%int64(len(cands))], nil
	}
	return cands[n.Int64()], nil
}

// jjFetchTemplates returns the static, pre-scraped template catalog so job
// creation does not depend on live scraping/CDP and avoids Cloudflare challenges.
func jjFetchTemplates() []jjTemplate {
	out := make([]jjTemplate, len(jjStaticTemplates))
	copy(out, jjStaticTemplates)
	return out
}

func jjRandInt(min, max int) int {
	if max <= min {
		return min
	}
	n, err := rand.Int(rand.Reader, big.NewInt(int64(max-min+1)))
	if err != nil {
		return min + int(time.Now().UnixNano()%int64(max-min+1))
	}
	return min + int(n.Int64())
}

func jjSleepJitter(ctx context.Context, base, jitter time.Duration) error {
	d := base
	if jitter > 0 {
		d += time.Duration(jjRandInt(0, int(jitter/time.Millisecond))) * time.Millisecond
	}
	return sleepCtx(ctx, d)
}

func jjHumanScroll(ctx context.Context, page playwright.Page) {
	// Scroll down/up in small steps with pauses to mimic a real visitor.
	steps := jjRandInt(2, 5)
	for i := 0; i < steps; i++ {
		dy := jjRandInt(120, 420)
		_, _ = page.Evaluate(fmt.Sprintf(`() => window.scrollBy({top:%d,left:0,behavior:'smooth'})`, dy))
		_ = jjSleepJitter(ctx, 180*time.Millisecond, 420*time.Millisecond)
	}
	_ = jjSleepJitter(ctx, 150*time.Millisecond, 350*time.Millisecond)
	_, _ = page.Evaluate(`() => window.scrollBy({top:-120,left:0,behavior:'smooth'})`)
	_ = jjSleepJitter(ctx, 120*time.Millisecond, 280*time.Millisecond)
}

func jjClickSelector(ctx context.Context, page playwright.Page, selector string) error {
	// Try to scroll element into view, move mouse over its center and click.
	// Falls back to a JS click. This aims to behave like a natural interaction.
	jsGet := fmt.Sprintf(`() => {
  const el = document.querySelector(%q);
  if(!el) return '';
  try{ el.scrollIntoView({block:'center', behavior:'smooth'}); }catch(e){}
  const r = el.getBoundingClientRect();
  return JSON.stringify({x: r.left + r.width/2, y: r.top + r.height/2, w: r.width, h: r.height, ok: r.width>0 && r.height>0});
}`, selector)
	posVal, err := page.Evaluate(jsGet)
	if err != nil {
		return err
	}
	_ = jjSleepJitter(ctx, 250*time.Millisecond, 450*time.Millisecond)
	if posStr, _ := posVal.(string); posStr != "" {
		var pos struct {
			X  float64 `json:"x"`
			Y  float64 `json:"y"`
			OK bool    `json:"ok"`
		}
		if err := json.Unmarshal([]byte(posStr), &pos); err == nil && pos.OK {
			pos.X += float64(jjRandInt(-4, 4))
			pos.Y += float64(jjRandInt(-3, 3))
			if err := page.Mouse().Move(pos.X, pos.Y); err == nil {
				_ = jjSleepJitter(ctx, 60*time.Millisecond, 140*time.Millisecond)
				if err := page.Mouse().Down(); err == nil {
					_ = jjSleepJitter(ctx, 40*time.Millisecond, 120*time.Millisecond)
					_ = page.Mouse().Up()
					return nil
				}
			}
		}
	}
	// fallback: JS click
	_, err = page.Evaluate(fmt.Sprintf(`() => { const el=document.querySelector(%q); if(!el) return 'NO'; el.click(); return 'OK'; }`, selector))
	return err
}

type jjGenerateResult struct {
	Done        bool
	Failed      bool
	DownloadURL string
	ViewURL     string
	TaskText    string
}

func jjGenerate(ctx context.Context, tpl jjTemplate, photos []jjPhoto) (jjGenerateResult, error) {
	createURL := jjBaseURL + "/create/" + tpl.ID

	pw, err := playwright.Run()
	if err != nil {
		if strings.Contains(err.Error(), "please install the driver") || strings.Contains(err.Error(), "could not start driver") || strings.Contains(err.Error(), "no such file or directory") {
			if instErr := playwright.Install(&playwright.RunOptions{SkipInstallBrowsers: true}); instErr != nil {
				return jjGenerateResult{}, fmt.Errorf("playwright install: %w (run: %v)", instErr, err)
			}
			pw, err = playwright.Run()
		}
	}
	if err != nil {
		return jjGenerateResult{}, fmt.Errorf("playwright run: %w", err)
	}
	defer func() { _ = pw.Stop() }()

	browser, err := pw.Chromium.ConnectOverCDP(jjCDPURL)
	if err != nil {
		return jjGenerateResult{}, fmt.Errorf("cdp connect: %w", err)
	}
	defer func() { _ = browser.Close() }()

	bctx, err := browser.NewContext()
	if err != nil {
		return jjGenerateResult{}, fmt.Errorf("new context: %w", err)
	}
	defer func() { _ = bctx.Close() }()

	page, err := bctx.NewPage()
	if err != nil {
		return jjGenerateResult{}, fmt.Errorf("new page: %w", err)
	}
	defer func() { _ = page.Close() }()

	page.SetDefaultTimeout(30000)
	_ = jjSleepJitter(ctx, 300*time.Millisecond, 500*time.Millisecond)
	if _, err := page.Goto(createURL, playwright.PageGotoOptions{
		WaitUntil: playwright.WaitUntilStateDomcontentloaded,
		Timeout:   playwright.Float(45000),
	}); err != nil {
		return jjGenerateResult{}, fmt.Errorf("navigate: %w", err)
	}
	_ = jjSleepJitter(ctx, 1800*time.Millisecond, 1200*time.Millisecond)
	_, _ = page.WaitForFunction(`() => document.readyState === 'complete' || document.readyState === 'interactive'`, nil, playwright.PageWaitForFunctionOptions{Timeout: playwright.Float(20000)})
	_ = jjSleepJitter(ctx, 700*time.Millisecond, 900*time.Millisecond)

	// tunggu form upload siap
	if _, err := page.WaitForFunction(`() => !!document.querySelector('input[type=file]')`, nil, playwright.PageWaitForFunctionOptions{Timeout: playwright.Float(30000)}); err != nil {
		return jjGenerateResult{}, fmt.Errorf("halaman create tidak siap: %w", err)
	}
	_ = jjSleepJitter(ctx, 900*time.Millisecond, 900*time.Millisecond)
	jjHumanScroll(ctx, page)

	// inject file via DataTransfer (file ada di server, bukan FS browser remote)
	payloads := make([]map[string]any, 0, len(photos))
	for _, p := range photos {
		payloads = append(payloads, map[string]any{
			"name": p.Name,
			"mime": p.Mime,
			"b64":  base64.StdEncoding.EncodeToString(p.Data),
		})
	}
	pb, _ := json.Marshal(payloads)
	injectExpr := fmt.Sprintf(`() => {
  const items = %s;
  const input = document.querySelector('input[type=file]');
  if(!input) return 'NO_INPUT';
  const dt = new DataTransfer();
  for(const it of items){
    const bin = atob(it.b64);
    const bytes = new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
    dt.items.add(new File([bytes], it.name||'photo.jpg', {type: it.mime||'image/jpeg'}));
  }
  input.files = dt.files;
  input.dispatchEvent(new Event('input',{bubbles:true}));
  input.dispatchEvent(new Event('change',{bubbles:true}));
  return 'FILES='+input.files.length;
}`, string(pb))
	injectVal, err := page.Evaluate(injectExpr)
	if err != nil {
		return jjGenerateResult{}, fmt.Errorf("gagal inject foto: %w", err)
	}
	injectRes, _ := injectVal.(string)
	if injectRes != fmt.Sprintf("FILES=%d", len(photos)) {
		return jjGenerateResult{}, fmt.Errorf("gagal menyiapkan foto (%s)", injectRes)
	}
	_ = jjSleepJitter(ctx, 900*time.Millisecond, 1200*time.Millisecond)
	jjHumanScroll(ctx, page)
	_ = jjSleepJitter(ctx, 300*time.Millisecond, 600*time.Millisecond)

	// submit: scroll to button and click naturally
	_ = jjClickSelector(ctx, page, "button")
	// verify click had effect (button may disable or task area appear); if nothing, try JS click on submit-like button
	_ = jjSleepJitter(ctx, 600*time.Millisecond, 700*time.Millisecond)
	submitVal, _ := page.Evaluate(`() => {
  const b = Array.from(document.querySelectorAll('button')).find(x=>/submit|buat|generate|proses|render/i.test((x.innerText||x.textContent||'')));
  if(!b) return 'NO_SUBMIT';
  const t = (document.body&&document.body.innerText||'');
  if(/Task kamu|Memproses|Menunggu|Antrian|Selesai|Gagal/i.test(t)) return 'CLICKED';
  if(b.disabled) return 'DISABLED';
  try{ b.scrollIntoView({block:'center',behavior:'smooth'}); }catch(e){}
  b.click();
  return 'CLICKED';
}`)
	submitRes, _ := submitVal.(string)
	if submitRes == "NO_SUBMIT" {
		return jjGenerateResult{}, fmt.Errorf("gagal submit: tombol submit tidak ditemukan")
	}

	// poll status task
	deadline := time.Now().Add(jjRenderTimeout)
	var last jjGenerateResult
	for time.Now().Before(deadline) {
		if err := sleepCtx(ctx, jjPollInterval); err != nil {
			return last, err
		}
		st, err := jjReadState(page)
		if err != nil {
			continue
		}
		last = st
		if st.Done || st.Failed {
			return st, nil
		}
	}
	return last, nil
}

func jjReadState(page playwright.Page) (jjGenerateResult, error) {
	expr := `() => {
  const text = (document.body && document.body.innerText || '').slice(0,8000);
  let task = '';
  const idx = text.indexOf('Task kamu');
  if(idx >= 0) task = text.slice(idx, idx+1200);
  const vids = Array.from(document.querySelectorAll('video,source')).map(v=>v.src||v.currentSrc||'').filter(Boolean);
  const links = Array.from(document.querySelectorAll('a')).map(a=>({href:a.href||'', text:(a.innerText||'').trim()}));
  let dl = '';
  let view = '';
  for(const l of links){
    const h=l.href||''; const t=(l.text||'').toLowerCase();
    if(!dl && (/unduh|download/i.test(t) || /mp4|evercloud|capcut|media/i.test(h)) && /^https?:/i.test(h)) dl=h;
    if(!view && /lihat|view/i.test(t) && /^https?:/i.test(h)) view=h;
  }
  if(!dl){ for(const v of vids){ if(/^https?:/i.test(v)) { dl=v; break; } } }
  const done = /selesai|berhasil/i.test(task) || (!!dl);
  const failed = /gagal|error|failed/i.test(task);
  return JSON.stringify({task:task, dl:dl, view:view, done:done, failed:failed});
}`
	val, err := page.Evaluate(expr)
	if err != nil {
		return jjGenerateResult{}, err
	}
	s, _ := val.(string)
	var st struct {
		Task   string `json:"task"`
		DL     string `json:"dl"`
		View   string `json:"view"`
		Done   bool   `json:"done"`
		Failed bool   `json:"failed"`
	}
	if err := json.Unmarshal([]byte(s), &st); err != nil {
		return jjGenerateResult{}, err
	}
	return jjGenerateResult{
		Done:        st.Done && st.DL != "",
		Failed:      st.Failed,
		DownloadURL: st.DL,
		ViewURL:     st.View,
		TaskText:    st.Task,
	}, nil
}
