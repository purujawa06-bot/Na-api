package bot

import (
	"sync"
	"time"
)

type LogEntry struct {
	Time    string `json:"time"`
	Level   string `json:"level"`
	Source  string `json:"source"`
	Message string `json:"message"`
}

type Logger struct {
	mu      sync.RWMutex
	entries []LogEntry
	max     int
}

func NewLogger(max int) *Logger {
	if max <= 0 {
		max = 200
	}
	return &Logger{max: max, entries: make([]LogEntry, 0, max)}
}

func (l *Logger) Add(level, source, message string) {
	if l == nil {
		return
	}
	level = normalizeLogLevel(level)
	if message == "" {
		return
	}
	entry := LogEntry{
		Time:    time.Now().Format(time.RFC3339),
		Level:   level,
		Source:  source,
		Message: message,
	}
	l.mu.Lock()
	l.entries = append(l.entries, entry)
	if len(l.entries) > l.max {
		// keep last max
		l.entries = append([]LogEntry(nil), l.entries[len(l.entries)-l.max:]...)
	}
	l.mu.Unlock()
}

func (l *Logger) Error(source, message string) { l.Add("error", source, message) }
func (l *Logger) Info(source, message string)  { l.Add("info", source, message) }
func (l *Logger) Warn(source, message string)  { l.Add("warn", source, message) }

func (l *Logger) List() []LogEntry {
	if l == nil {
		return nil
	}
	l.mu.RLock()
	defer l.mu.RUnlock()
	out := make([]LogEntry, len(l.entries))
	copy(out, l.entries)
	return out
}

func (l *Logger) Clear() {
	if l == nil {
		return
	}
	l.mu.Lock()
	l.entries = l.entries[:0]
	l.mu.Unlock()
}

func normalizeLogLevel(s string) string {
	switch s {
	case "error", "warn", "info":
		return s
	default:
		return "info"
	}
}
