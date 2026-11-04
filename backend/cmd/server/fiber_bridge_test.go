package main

import (
	"bufio"
	"context"
	"io"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
)

// newTestApp serves handler through the Fiber bridge on a random port.
func newTestApp(t *testing.T, handler http.Handler) (*fiber.App, string) {
	t.Helper()
	app := fiber.New(fiber.Config{})
	app.Use(fiberBridge{handler: handler}.Serve)

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	go func() {
		_ = app.Listener(listener, fiber.ListenConfig{DisableStartupMessage: true})
	}()
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = app.ShutdownWithContext(ctx)
	})
	return app, "http://" + listener.Addr().String()
}

// TestBridgePreservesStatusHeadersAndBody checks that a plain JSON response
// keeps its status code, headers, and payload.
func TestBridgePreservesStatusHeadersAndBody(t *testing.T) {
	handler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("X-Test", "bridge")
		w.WriteHeader(http.StatusTeapot)
		_, _ = io.WriteString(w, `{"success":false}`)
	})

	_, baseURL := newTestApp(t, handler)
	response, err := http.Get(baseURL + "/")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	defer response.Body.Close()

	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	if response.StatusCode != http.StatusTeapot {
		t.Fatalf("status = %d, want %d", response.StatusCode, http.StatusTeapot)
	}
	if got := response.Header.Get("X-Test"); got != "bridge" {
		t.Fatalf("X-Test = %q, want bridge", got)
	}
	if string(body) != `{"success":false}` {
		t.Fatalf("body = %q", body)
	}
}

// TestBridgeStreamsChunksIncrementally proves that flushed writes reach the
// client before the handler returns, which the stock Fiber adaptor cannot do.
func TestBridgeStreamsChunksIncrementally(t *testing.T) {
	release := make(chan struct{})
	handler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		flusher, ok := w.(http.Flusher)
		if !ok {
			t.Error("handler response writer is not a flusher")
			return
		}
		_, _ = io.WriteString(w, "data: first\n\n")
		flusher.Flush()
		<-release
		_, _ = io.WriteString(w, "data: second\n\n")
	})

	_, baseURL := newTestApp(t, handler)
	response, err := http.Get(baseURL + "/stream")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	defer response.Body.Close()

	reader := bufio.NewReader(response.Body)
	first := make(chan string, 1)
	go func() {
		var collected strings.Builder
		for collected.Len() < len("data: first\n\n") {
			line, err := reader.ReadString('\n')
			if err != nil {
				first <- collected.String() + "|error: " + err.Error()
				return
			}
			collected.WriteString(line)
		}
		first <- collected.String()
	}()

	select {
	case chunk := <-first:
		if chunk != "data: first\n\n" {
			t.Fatalf("first chunk = %q", chunk)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("first chunk was buffered instead of streamed")
	}

	// The handler is still blocked, so the connection must stay open.
	close(release)
	rest, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("read rest: %v", err)
	}
	if string(rest) != "data: second\n\n" {
		t.Fatalf("rest = %q", rest)
	}
}

// TestBridgeHandlerWithoutBody checks responses that never write a body.
func TestBridgeHandlerWithoutBody(t *testing.T) {
	handler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})

	_, baseURL := newTestApp(t, handler)
	response, err := http.Get(baseURL + "/empty")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	defer response.Body.Close()

	body, _ := io.ReadAll(response.Body)
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", response.StatusCode)
	}
	if len(body) != 0 {
		t.Fatalf("body = %q, want empty", body)
	}
}
