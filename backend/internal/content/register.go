// Package content exposes the dynamic content endpoints: blog posts, the public
// chat board, the temporary data store, the GitHub-backed page/userScript
// catalogs, and the small admin settings routes.
package content

import (
	"net/http"

	"github.com/purujawa06-bot/na-api/backend/internal/app"
)

// Register mounts the content endpoints on the shared mux.
func Register(mux *http.ServeMux, deps *app.Deps) {
	h := &handler{deps: deps}

	mux.HandleFunc("GET /api/blogs", h.listBlogs)
	mux.HandleFunc("POST /api/blogs", h.createBlog)
	mux.HandleFunc("GET /api/blogs/{id}", h.getBlog)
	mux.HandleFunc("PUT /api/blogs/{id}", h.updateBlog)
	mux.HandleFunc("DELETE /api/blogs/{id}", h.deleteBlog)

	mux.HandleFunc("GET /api/chat", h.getChats)
	mux.HandleFunc("POST /api/chat", h.postChat)

	mux.HandleFunc("GET /api/temp/{id}", h.getTemp)

	mux.HandleFunc("GET /api/pages", h.listPages)

	mux.HandleFunc("GET /api/user-scripts", h.listUserScripts)
	mux.HandleFunc("GET /api/user-scripts/{id}", h.serveUserScript)
	mux.HandleFunc("GET /userscripts/{id}", h.serveUserScript)

	mux.HandleFunc("POST /api/admin/login", h.adminLogin)
	mux.HandleFunc("GET /api/admin/aichain", h.getAutoChain)
	mux.HandleFunc("POST /api/admin/aichain", h.setAutoChain)
	mux.HandleFunc("GET /api/admin/featured", h.getFeatured)
	mux.HandleFunc("POST /api/admin/featured", h.setFeatured)
}
