package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"purulocal-bot/internal/bot"
	"purulocal-bot/internal/web"
)

func main() {
	cfgPath := os.Getenv("PURULOCAL_CONFIG")
	if cfgPath == "" {
		cfgPath = "config.json"
	}
	dataDir := os.Getenv("PURULOCAL_DATA")
	if dataDir == "" {
		dataDir = "data"
	}

	manager, err := bot.NewManager(cfgPath, dataDir)
	if err != nil {
		log.Fatalf("init bot manager: %v", err)
	}

	addr := os.Getenv("PURULOCAL_ADDR")
	if addr == "" {
		if a := manager.Config().ListenAddr(); a != "" {
			addr = a
		} else {
			addr = "127.0.0.1:8787" // local phone / localhost
		}
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		if err := manager.AutoReconnect(ctx); err != nil {
			log.Printf("autoreconnect: %v", err)
		}
	}()

	srv := web.NewServer(addr, manager)
	log.Printf("puruLocal Bot UI/API berjalan di http://%s (sesi lokal di perangkat)", addr)
	if err := srv.Start(ctx); err != nil {
		log.Fatalf("server: %v", err)
	}

	_ = manager.Close()
}