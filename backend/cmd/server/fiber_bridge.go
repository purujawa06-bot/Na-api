// Package-level streaming bridge between Fiber (fasthttp) and the existing
// net/http handlers.
package main

import (
	"errors"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/adaptor"
)

// errStreamStalled is returned to a handler whose response body is no longer
// consumed, so the goroutine is released instead of blocking forever.
var errStreamStalled = errors.New("response stream stalled")

// streamStallTimeout bounds how long a single body write may wait for the
// client to consume it. It matches the server write timeout.
const streamStallTimeout = 5 * time.Minute

// fiberBridge exposes a net/http handler through Fiber. Fiber's stock adaptor
// buffers the complete response, which breaks the SSE and NDJSON endpoints, so
// this bridge forwards every handler write to the client as a flushed chunk.
type fiberBridge struct {
	handler http.Handler
}

// Serve implements fiber.Handler.
func (b fiberBridge) Serve(c fiber.Ctx) error {
	request, err := adaptor.ConvertRequest(c, true)
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request")
	}

	reader, writer := io.Pipe()
	response := newBridgeResponse(writer)
	finished := make(chan struct{})

	go func() {
		defer close(finished)
		defer func() {
			_ = writer.Close()
		}()
		b.handler.ServeHTTP(response, request)
	}()

	// Wait for the handler to commit its status and headers before handing the
	// response to fasthttp. A handler that never writes anything closes
	// finished without committing; the default 200 status then applies.
	select {
	case <-response.committed:
	case <-finished:
	}

	c.Status(response.statusCode())
	for key, values := range response.header {
		for index, value := range values {
			// The first value replaces Fiber's default header (notably the
			// text/plain Content-Type) while extra values are appended.
			if index == 0 {
				c.Set(key, value)
				continue
			}
			c.Append(key, value)
		}
	}

	select {
	case <-finished:
		// The handler produced no body: io.Pipe writes are synchronous, so a
		// finished handler cannot have outstanding body bytes.
		response.stopWatchdog()
		return nil
	default:
		return c.SendStream(&watchdogReader{reader: reader, timer: response.stall})
	}
}

// watchdogReader releases the stall timer as soon as the stream ends.
type watchdogReader struct {
	reader io.Reader
	timer  *time.Timer
}

// Read forwards one chunk and stops the watchdog on the final read.
func (r *watchdogReader) Read(p []byte) (int, error) {
	n, err := r.reader.Read(p)
	if err != nil {
		r.timer.Stop()
	}
	return n, err
}

// bridgeResponse adapts an io.Pipe into the http.ResponseWriter contract.
type bridgeResponse struct {
	header    http.Header
	writer    *io.PipeWriter
	committed chan struct{}
	once      sync.Once
	status    int
	stall     *time.Timer
}

// newBridgeResponse builds a response writer that streams into writer.
func newBridgeResponse(writer *io.PipeWriter) *bridgeResponse {
	return &bridgeResponse{
		header:    make(http.Header),
		writer:    writer,
		committed: make(chan struct{}),
		stall:     time.AfterFunc(streamStallTimeout, func() { _ = writer.CloseWithError(errStreamStalled) }),
	}
}

// Header returns the response headers collected from the handler.
func (r *bridgeResponse) Header() http.Header { return r.header }

// WriteHeader records the status and releases the waiting Fiber handler.
func (r *bridgeResponse) WriteHeader(status int) {
	r.once.Do(func() {
		r.status = status
		close(r.committed)
	})
}

// Write streams one chunk to the client.
func (r *bridgeResponse) Write(p []byte) (int, error) {
	r.WriteHeader(http.StatusOK)
	r.stall.Reset(streamStallTimeout)
	return r.writer.Write(p)
}

// Flush is a no-op: every Write already reaches the client immediately because
// fasthttp flushes each stream chunk.
func (r *bridgeResponse) Flush() {}

// statusCode returns the committed status or 200 when the handler never set one.
func (r *bridgeResponse) statusCode() int {
	if r.status == 0 {
		return http.StatusOK
	}
	return r.status
}

// stopWatchdog releases the stall timer when no body is streamed.
func (r *bridgeResponse) stopWatchdog() { r.stall.Stop() }
