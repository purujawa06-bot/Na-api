package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	"purulocal-bot/internal/bot"
	"purulocal-bot/internal/web"
)

func main() {
	for _, a := range os.Args[1:] {
		if a == "-emit-runner" || a == "--emit-runner" {
			fmt.Print(bot.NodeRunnerScript())
			return
		}
	}
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
	errCh := make(chan error, 1)
	go func() { errCh <- srv.Start(ctx) }()
	select {
	case <-ctx.Done():
	case err := <-errCh:
		if err != nil {
			log.Printf("server: %v", err)
		}
	case reason := <-manager.RestartRequested():
		log.Printf("restart requested: %s", reason)
		stop()
		_ = manager.Close()
		os.Exit(42)
	}

	_ = manager.Close()
}