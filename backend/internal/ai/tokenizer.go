package ai

import "unicode/utf8"

// approxTokenRatio is the characters-per-token factor of the heuristic below.
const approxTokenRatio = 4

// countTokens approximates BPE token usage for the OpenAI-compatible usage
// object.
//
// The original Next.js backend used js-tiktoken (o200k_base). Porting that
// vocabulary to Go would require shipping a large merge table, so this port
// uses a deterministic approximation instead: one token per four runes, with
// an extra token for a partial group and one token per run of whitespace.
// The values are stable across processes but are NOT exact BPE counts, which
// only affects the reported usage numbers, never response content.
func countTokens(text string) int {
	if text == "" {
		return 0
	}
	runes := utf8.RuneCountInString(text)
	if runes == 0 {
		return 0
	}
	tokens := (runes + approxTokenRatio - 1) / approxTokenRatio
	// Whitespace runs usually collapse into punctuation-adjacent tokens; the
	// bump keeps short, whitespace-heavy prompts from reporting zero.
	inSpace := false
	for _, r := range text {
		if r == ' ' || r == '\n' || r == '\t' || r == '\r' {
			if !inSpace {
				tokens++
				inSpace = true
			}
			continue
		}
		inSpace = false
	}
	return tokens
}
