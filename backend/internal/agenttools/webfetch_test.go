package agenttools

import "testing"

func TestIsBlockedHostname(t *testing.T) {
	blocked := []string{
		"", "localhost", "LOCALHOST.", "127.0.0.1", "10.1.2.3", "172.16.0.1",
		"172.31.255.255", "192.168.1.1", "169.254.169.254", "0.0.0.0",
		"::1", "[::1]", "fd00::1", "fe80::1", "printer.local", "service.internal",
		"100.64.0.1",
	}
	for _, host := range blocked {
		if !isBlockedHostname(host) {
			t.Errorf("isBlockedHostname(%q) = false, want true", host)
		}
	}

	allowed := []string{"example.com", "8.8.8.8", "172.32.0.1", "skills.sh"}
	for _, host := range allowed {
		if isBlockedHostname(host) {
			t.Errorf("isBlockedHostname(%q) = true, want false", host)
		}
	}
}

func TestParseWebFetchParams(t *testing.T) {
	if _, _, _, err := parseWebFetchParams("", "0", "100"); err == nil {
		t.Fatal("expected an error for a missing url")
	}
	if _, _, _, err := parseWebFetchParams("https://example.com", nil, "100"); err == nil {
		t.Fatal("expected an error for a missing offset")
	}
	if _, _, _, err := parseWebFetchParams("https://example.com", "0", nil); err == nil {
		t.Fatal("expected an error for a missing length")
	}
	if _, _, _, err := parseWebFetchParams("https://example.com", "0", "20001"); err == nil {
		t.Fatal("expected an error for an oversized length")
	}
	if _, _, _, err := parseWebFetchParams("https://example.com", "-1", "100"); err == nil {
		t.Fatal("expected an error for a negative offset")
	}

	urlValue, offset, length, err := parseWebFetchParams(" https://example.com ", "5", "5000")
	if err != nil {
		t.Fatalf("parseWebFetchParams() error = %v", err)
	}
	if urlValue != "https://example.com" || offset != 5 || length != 5000 {
		t.Fatalf("parseWebFetchParams() = (%q, %d, %d)", urlValue, offset, length)
	}

	if _, offset, length, err := parseWebFetchParams("https://example.com", 0.0, 100.0); err != nil || offset != 0 || length != 100 {
		t.Fatalf("parseWebFetchParams() numeric body failed: offset=%d length=%d err=%v", offset, length, err)
	}
}

func TestCleanText(t *testing.T) {
	got := cleanText("  hello   world \r\n\n\n\nsecond\tline  ")
	want := "hello world\nsecond line"
	if got != want {
		t.Fatalf("cleanText() = %q, want %q", got, want)
	}
}

func TestHTMLToTextDropsScripts(t *testing.T) {
	got := htmlToText("<html><body><script>alert(1)</script><p>Hello</p><style>.x{}</style><div>World</div></body></html>")
	if got != "HelloWorld" {
		t.Fatalf("htmlToText() = %q, want %q", got, "HelloWorld")
	}
}
