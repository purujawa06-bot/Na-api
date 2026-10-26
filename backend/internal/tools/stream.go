package tools

import (
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
)

// heartbeatInterval is the cadence of the "processing" keep-alive events used
// by the streaming image tools.
const heartbeatInterval = 2 * time.Second

// streamEvent is the shared shape for progress lines on the NDJSON endpoints.
type streamEvent struct {
	Event   string `json:"event"`
	Status  string `json:"status,omitempty"`
	Message string `json:"message,omitempty"`
}

// doneEvent is the terminal line emitted by the streaming image tools.
type doneEvent struct {
	Event      string `json:"event"`
	Success    bool   `json:"success"`
	Status     string `json:"status"`
	Source     string `json:"source,omitempty"`
	Scale      int    `json:"scale,omitempty"`
	URL        string `json:"url,omitempty"`
	Filename   string `json:"filename,omitempty"`
	Mimetype   string `json:"mimetype,omitempty"`
	Error      string `json:"error,omitempty"`
	HTTPStatus int    `json:"httpStatus,omitempty"`
}

// ndjsonEmitter serialises writes to a streaming response and can run a
// background heartbeat so clients see progress during slow upstream calls.
type ndjsonEmitter struct {
	mu        sync.Mutex
	writer    io.Writer
	flusher   http.Flusher
	closed    bool
	stop      chan struct{}
	stopped   chan struct{}
	heartbeat bool
}

// newNDJSONEmitter wraps a streaming response writer.
func newNDJSONEmitter(w io.Writer, flusher http.Flusher) *ndjsonEmitter {
	return &ndjsonEmitter{writer: w, flusher: flusher}
}

// emit writes one JSON line unless the stream has been closed.
func (e *ndjsonEmitter) emit(payload any) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.closed {
		return
	}
	httpx.WriteNDJSON(e.writer, e.flusher, payload)
}

// startHeartbeat emits a payload every interval until stopped.
func (e *ndjsonEmitter) startHeartbeat(interval time.Duration, payload func() any) {
	stop := make(chan struct{})
	stopped := make(chan struct{})
	e.stop = stop
	e.stopped = stopped
	e.heartbeat = true
	go func() {
		defer close(stopped)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				e.emit(payload())
			}
		}
	}()
}

// stopHeartbeat halts the background ticker and waits for it to finish.
func (e *ndjsonEmitter) stopHeartbeat() {
	if !e.heartbeat {
		return
	}
	e.heartbeat = false
	close(e.stop)
	<-e.stopped
}

// close prevents any further writes to the response.
func (e *ndjsonEmitter) close() {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.closed = true
}
