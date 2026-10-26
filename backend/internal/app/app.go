// Package app wires the shared dependencies handed to every feature package.
package app

import (
	"github.com/purujawa06-bot/na-api/backend/internal/cache"
	"github.com/purujawa06-bot/na-api/backend/internal/config"
	"github.com/purujawa06-bot/na-api/backend/internal/db"
	"github.com/purujawa06-bot/na-api/backend/internal/settings"
)

// Deps is the dependency container passed to feature Register functions.
type Deps struct {
	Config   *config.Config
	DB       *db.Store
	Cache    *cache.Cache
	Settings *settings.Service
}
