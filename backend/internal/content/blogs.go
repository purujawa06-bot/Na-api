package content

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
)

const (
	blogPageDefaultLimit = 5
	blogPageMaxLimit     = 100
	blogExcerptLength    = 120
	blogPruneLimit       = 500
)

// blogRecord is the mutation shape shared by create/update responses, matching
// the fields the JS service returns (no excerpt).
type blogRecord struct {
	ID        string  `json:"id"`
	Tag       string  `json:"tag"`
	Image     *string `json:"image"`
	Content   string  `json:"content"`
	CreatedAt string  `json:"createdAt"`
	UpdatedAt string  `json:"updatedAt"`
}

// blogPost is the JSON shape returned for list/detail responses.
type blogPost struct {
	blogRecord
	Excerpt string `json:"excerpt"`
}

// blogCreateResult adds the duplicate bookkeeping fields to a create response.
type blogCreateResult struct {
	blogRecord
	Duplicate bool   `json:"duplicate"`
	Message   string `json:"message,omitempty"`
}

// blogPage is the paginated list payload.
type blogPage struct {
	Posts       []blogPost `json:"posts"`
	TotalPosts  int64      `json:"totalPosts"`
	TotalPages  int        `json:"totalPages"`
	CurrentPage int        `json:"currentPage"`
}

type blogWriteBody struct {
	Image   *string `json:"image"`
	Content *string `json:"content"`
	Tag     *string `json:"tag"`
}

var (
	// markdownExcerptSteps mirrors the sequential replacements in lib/blogService.js.
	// RE2 has no backreferences, so each bold/italic delimiter pair is expanded
	// into its own pattern; the ordering keeps the JS result.
	markdownImages     = regexp.MustCompile(`!\[.*?\]\(.*?\)`)
	markdownLinks      = regexp.MustCompile(`\[(.*?)\]\(.*?\)`)
	markdownHeadings   = regexp.MustCompile(`#{1,6}\s`)
	markdownBoldStar   = regexp.MustCompile(`\*\*(.*?)\*\*`)
	markdownBoldUnder  = regexp.MustCompile(`__(.*?)__`)
	markdownItalicStar = regexp.MustCompile(`\*(.*?)\*`)
	markdownItalUnder  = regexp.MustCompile(`_(.*?)_`)
	markdownFences     = regexp.MustCompile("(?s)```.*?```")
	markdownCode       = regexp.MustCompile("`(.+?)`")
	newlines           = regexp.MustCompile(`\n`)
	blogTitlePattern   = regexp.MustCompile(`(?m)^#[ \t]+(.+)$`)
)

// createExcerpt builds a plain-text preview from markdown.
func createExcerpt(markdown string, length int) string {
	if markdown == "" {
		return ""
	}
	text := markdownImages.ReplaceAllString(markdown, "")
	text = markdownLinks.ReplaceAllString(text, "$1")
	text = markdownHeadings.ReplaceAllString(text, "")
	text = markdownBoldStar.ReplaceAllString(text, "$1")
	text = markdownBoldUnder.ReplaceAllString(text, "$1")
	text = markdownItalicStar.ReplaceAllString(text, "$1")
	text = markdownItalUnder.ReplaceAllString(text, "$1")
	text = markdownFences.ReplaceAllString(text, "")
	text = markdownCode.ReplaceAllString(text, "$1")
	text = newlines.ReplaceAllString(text, " ")
	text = strings.TrimSpace(text)

	runes := []rune(text)
	if len(runes) > length {
		return string(runes[:length]) + "..."
	}
	return text
}

// extractBlogTitle returns the first markdown H1, mirroring the JS helper.
func extractBlogTitle(content string) string {
	match := blogTitlePattern.FindStringSubmatch(content)
	if match == nil {
		return ""
	}
	return strings.TrimSpace(match[1])
}

const createBlogsTable = `CREATE TABLE IF NOT EXISTS blogs (
	id UUID PRIMARY KEY,
	tag TEXT NOT NULL,
	image TEXT,
	content TEXT NOT NULL,
	created_at TIMESTAMPTZ DEFAULT NOW(),
	updated_at TIMESTAMPTZ DEFAULT NOW()
)`

// ensureBlogsTable creates the blogs table when possible. Failures are ignored
// because the following query reports the real problem, as in the JS service.
func (h *handler) ensureBlogsTable(ctx context.Context) {
	pool := h.pool()
	if pool == nil {
		return
	}
	_, _ = pool.Exec(ctx, createBlogsTable)
}

// listBlogPosts returns one page of blog posts.
func (h *handler) listBlogPosts(ctx context.Context, page, limit int) (blogPage, error) {
	empty := blogPage{Posts: []blogPost{}, TotalPosts: 0, TotalPages: 1, CurrentPage: 1}

	pool := h.pool()
	if pool == nil {
		// Matches the JS ECONNREFUSED fallback so builds/pages still render.
		return empty, nil
	}
	h.ensureBlogsTable(ctx)

	var totalPosts int64
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM blogs`).Scan(&totalPosts); err != nil {
		return blogPage{}, fmt.Errorf("count blog posts: %w", err)
	}

	totalPages := 0
	if totalPosts > 0 {
		totalPages = int((totalPosts + int64(limit) - 1) / int64(limit))
	}

	offset := (page - 1) * limit
	rows, err := pool.Query(ctx, `
		SELECT id::text, tag, image, LEFT(content, 2000), created_at, updated_at
		FROM blogs ORDER BY created_at DESC LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		return blogPage{}, fmt.Errorf("fetch blog posts: %w", err)
	}
	defer rows.Close()

	posts := make([]blogPost, 0, limit)
	for rows.Next() {
		var (
			record    blogRecord
			content   string
			createdAt time.Time
			updatedAt time.Time
		)
		if err := rows.Scan(&record.ID, &record.Tag, &record.Image, &content, &createdAt, &updatedAt); err != nil {
			return blogPage{}, fmt.Errorf("scan blog post: %w", err)
		}
		record.Content = content
		record.CreatedAt = isoTime(createdAt)
		record.UpdatedAt = isoTime(updatedAt)
		posts = append(posts, blogPost{
			blogRecord: record,
			Excerpt:    createExcerpt(content, blogExcerptLength),
		})
	}
	if err := rows.Err(); err != nil {
		return blogPage{}, fmt.Errorf("iterate blog posts: %w", err)
	}

	return blogPage{
		Posts:       posts,
		TotalPosts:  totalPosts,
		TotalPages:  totalPages,
		CurrentPage: page,
	}, nil
}

// getBlogPost loads a single post; a nil post means "not found".
func (h *handler) getBlogPost(ctx context.Context, id string) (*blogPost, error) {
	if !validUUID(id) {
		return nil, nil
	}
	pool := h.pool()
	if pool == nil {
		// The JS service treats a refused connection as a missing row.
		return nil, nil
	}
	h.ensureBlogsTable(ctx)

	var (
		record    blogRecord
		content   string
		createdAt time.Time
		updatedAt time.Time
	)
	err := pool.QueryRow(ctx, `
		SELECT id::text, tag, image, content, created_at, updated_at
		FROM blogs WHERE id = $1::uuid`, id).
		Scan(&record.ID, &record.Tag, &record.Image, &content, &createdAt, &updatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("fetch blog post: %w", err)
	}
	record.Content = content
	record.CreatedAt = isoTime(createdAt)
	record.UpdatedAt = isoTime(updatedAt)
	return &blogPost{
		blogRecord: record,
		Excerpt:    createExcerpt(content, blogExcerptLength),
	}, nil
}

// findDuplicateBlog returns the ID of a post with the same tag and normalized
// H1 title, or an empty string when none exists.
func (h *handler) findDuplicateBlog(ctx context.Context, tag, title string) (string, error) {
	pool := h.pool()
	if pool == nil || title == "" {
		return "", nil
	}
	normalized := normalizeText(title)

	rows, err := pool.Query(ctx,
		`SELECT id::text, content FROM blogs WHERE tag = $1 ORDER BY created_at DESC`, tag)
	if err != nil {
		return "", fmt.Errorf("find duplicate blog: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var (
			id      string
			content string
		)
		if err := rows.Scan(&id, &content); err != nil {
			return "", fmt.Errorf("scan duplicate candidate: %w", err)
		}
		existing := extractBlogTitle(content)
		if existing != "" && normalizeText(existing) == normalized {
			return id, nil
		}
	}
	if err := rows.Err(); err != nil {
		return "", fmt.Errorf("iterate duplicate candidates: %w", err)
	}
	return "", nil
}

// createBlogPost inserts a post, updating an existing one when the tag+title
// pair is already present.
func (h *handler) createBlogPost(ctx context.Context, body blogWriteBody) (*blogCreateResult, error) {
	if body.Content == nil || strings.TrimSpace(*body.Content) == "" {
		return nil, errors.New("content is required")
	}
	if body.Tag == nil || strings.TrimSpace(*body.Tag) == "" {
		return nil, errors.New("tag is required")
	}
	content := *body.Content
	tag := *body.Tag
	image := ""
	if body.Image != nil {
		image = *body.Image
	}

	pool := h.pool()
	if pool == nil {
		return nil, errDatabaseUnavailable
	}
	h.ensureBlogsTable(ctx)

	existingID, err := h.findDuplicateBlog(ctx, tag, extractBlogTitle(content))
	if err != nil {
		// The JS service logs and continues with a fresh insert.
		existingID = ""
	}
	if existingID != "" {
		updated, err := h.updateBlogPost(ctx, existingID, blogWriteBody{
			Image:   &image,
			Content: &content,
			Tag:     &tag,
		})
		if err != nil {
			return nil, err
		}
		return &blogCreateResult{
			blogRecord: *updated,
			Duplicate:  true,
			Message:    "Post updated (duplicate title)",
		}, nil
	}

	id, err := newUUID()
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()

	var (
		record    blogRecord
		createdAt time.Time
		updatedAt time.Time
	)
	err = pool.QueryRow(ctx, `
		INSERT INTO blogs (id, tag, image, content, created_at, updated_at)
		VALUES ($1::uuid, $2, $3, $4, $5, $5)
		RETURNING id::text, tag, image, content, created_at, updated_at`,
		id, tag, image, content, now).
		Scan(&record.ID, &record.Tag, &record.Image, &record.Content, &createdAt, &updatedAt)
	if err != nil {
		return nil, fmt.Errorf("insert blog post: %w", err)
	}
	record.CreatedAt = isoTime(createdAt)
	record.UpdatedAt = isoTime(updatedAt)

	// Auto-control: keep only the 500 newest posts.
	if _, err := pool.Exec(ctx, `
		DELETE FROM blogs WHERE id NOT IN (
			SELECT id FROM blogs ORDER BY created_at DESC LIMIT $1
		)`, blogPruneLimit); err != nil {
		return nil, fmt.Errorf("prune blog posts: %w", err)
	}

	return &blogCreateResult{blogRecord: record, Duplicate: false}, nil
}

// updateBlogPost patches the provided fields and refreshes updated_at.
func (h *handler) updateBlogPost(ctx context.Context, id string, body blogWriteBody) (*blogRecord, error) {
	if !validUUID(id) {
		return nil, errNotFound
	}
	pool := h.pool()
	if pool == nil {
		return nil, errNotFound
	}
	h.ensureBlogsTable(ctx)

	fields := []string{"updated_at = $2"}
	values := []any{id, time.Now().UTC()}
	index := 3
	if body.Tag != nil {
		fields = append(fields, fmt.Sprintf("tag = $%d", index))
		values = append(values, *body.Tag)
		index++
	}
	if body.Image != nil {
		fields = append(fields, fmt.Sprintf("image = $%d", index))
		values = append(values, *body.Image)
		index++
	}
	if body.Content != nil {
		fields = append(fields, fmt.Sprintf("content = $%d", index))
		values = append(values, *body.Content)
		index++
	}

	query := fmt.Sprintf(`
		UPDATE blogs SET %s WHERE id = $1::uuid
		RETURNING id::text, tag, image, content, created_at, updated_at`,
		strings.Join(fields, ", "))

	var (
		record    blogRecord
		createdAt time.Time
		updatedAt time.Time
	)
	err := pool.QueryRow(ctx, query, values...).
		Scan(&record.ID, &record.Tag, &record.Image, &record.Content, &createdAt, &updatedAt)
	if err != nil {
		return nil, errNotFound
	}
	record.CreatedAt = isoTime(createdAt)
	record.UpdatedAt = isoTime(updatedAt)
	return &record, nil
}

// deleteBlogPost removes a post, reporting errNotFound when it does not exist.
func (h *handler) deleteBlogPost(ctx context.Context, id string) error {
	if !validUUID(id) {
		return errNotFound
	}
	pool := h.pool()
	if pool == nil {
		return errDatabaseUnavailable
	}
	h.ensureBlogsTable(ctx)

	tag, err := pool.Exec(ctx, `DELETE FROM blogs WHERE id = $1::uuid`, id)
	if err != nil {
		return fmt.Errorf("delete blog post: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return errNotFound
	}
	return nil
}

// listBlogs handles GET /api/blogs.
func (h *handler) listBlogs(w http.ResponseWriter, r *http.Request) {
	page := httpx.QueryInt(r, "page", 1, 1, 100000)
	limit := httpx.QueryInt(r, "limit", blogPageDefaultLimit, 1, blogPageMaxLimit)

	result, err := h.listBlogPosts(r.Context(), page, limit)
	if err != nil {
		httpx.JSON(w, http.StatusInternalServerError, map[string]any{
			"error":   "Failed to fetch posts",
			"details": err.Error(),
		})
		return
	}
	httpx.OK(w, result)
}

// createBlog handles POST /api/blogs.
func (h *handler) createBlog(w http.ResponseWriter, r *http.Request) {
	if !h.adminAuthorized(r) {
		httpx.JSON(w, http.StatusUnauthorized, map[string]any{
			"error": "Unauthorized: Invalid admin password",
		})
		return
	}

	var body blogWriteBody
	if err := httpx.DecodeJSON(r, &body); err != nil {
		httpx.JSON(w, http.StatusBadRequest, map[string]any{
			"error":   "Failed to create post",
			"details": err.Error(),
		})
		return
	}

	result, err := h.createBlogPost(r.Context(), body)
	if err != nil {
		httpx.JSON(w, http.StatusBadRequest, map[string]any{
			"error":   "Failed to create post",
			"details": err.Error(),
		})
		return
	}
	httpx.JSON(w, http.StatusCreated, result)
}

// getBlog handles GET /api/blogs/{id}.
func (h *handler) getBlog(w http.ResponseWriter, r *http.Request) {
	post, err := h.getBlogPost(r.Context(), r.PathValue("id"))
	if err != nil {
		httpx.JSON(w, http.StatusInternalServerError, map[string]any{
			"error":   "Failed to fetch post",
			"details": err.Error(),
		})
		return
	}
	if post == nil {
		httpx.JSON(w, http.StatusNotFound, map[string]any{"error": "Post not found"})
		return
	}
	httpx.OK(w, post)
}

// updateBlog handles PUT /api/blogs/{id}.
func (h *handler) updateBlog(w http.ResponseWriter, r *http.Request) {
	if !h.adminAuthorized(r) {
		httpx.JSON(w, http.StatusUnauthorized, map[string]any{"error": "Invalid password"})
		return
	}

	var body blogWriteBody
	if err := httpx.DecodeJSON(r, &body); err != nil {
		httpx.JSON(w, http.StatusNotFound, map[string]any{
			"error":   "Failed to update post",
			"details": err.Error(),
		})
		return
	}

	post, err := h.updateBlogPost(r.Context(), r.PathValue("id"), body)
	if err != nil {
		httpx.JSON(w, http.StatusNotFound, map[string]any{
			"error":   "Failed to update post",
			"details": err.Error(),
		})
		return
	}
	httpx.OK(w, post)
}

// deleteBlog handles DELETE /api/blogs/{id}.
func (h *handler) deleteBlog(w http.ResponseWriter, r *http.Request) {
	if !h.adminAuthorized(r) {
		httpx.JSON(w, http.StatusUnauthorized, map[string]any{"error": "Invalid password"})
		return
	}

	if err := h.deleteBlogPost(r.Context(), r.PathValue("id")); err != nil {
		httpx.JSON(w, http.StatusInternalServerError, map[string]any{
			"error":   "Failed to delete post",
			"details": err.Error(),
		})
		return
	}
	httpx.OK(w, map[string]any{"message": "Post deleted successfully."})
}
