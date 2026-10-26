package deepseek

import (
	"context"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
)

// DeepSeekHashV1 is chat.deepseek.com's proof-of-work hash: a Keccak-f[1600]
// permutation restricted to rounds 1..23, a 136-byte rate with SHA-3 style
// padding, and a 32-byte digest. This file mirrors lib/deepseek-pow.js exactly,
// including the 32-bit lane layout of the reference implementation, because the
// upstream verifier only accepts answers produced by that exact variant.
const (
	powRate       = 136
	powOutLen     = 32
	powDeltaRound = 1
	powLastRound  = 23
	powSafetyMS   = 60_000
)

// powRoundConstants holds the two 32-bit halves (high, low) of each round
// constant, indexed by round*2.
var powRoundConstants = [48]uint32{
	0, 1, 0, 32898, 0x80000000, 32906, 0x80000000, 0x80008000, 0, 32907,
	0, 0x80000001, 0x80000000, 0x80008081, 0x80000000, 32777, 0, 138, 0, 136,
	0, 0x80008009, 0, 0x8000000a, 0, 0x8000808b, 0x80000000, 139, 0x80000000, 32905,
	0x80000000, 32771, 0x80000000, 32770, 0x80000000, 128, 0, 32778, 0x80000000, 0x8000000a,
	0x80000000, 0x80008081, 0x80000000, 32896, 0, 0x80000001, 0x80000000, 0x80008008,
}

// powPiIndexes is the rho/pi walk order used by the reference solver.
var powPiIndexes = [24]int{10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1}

// powRhoShifts holds the rotation amount for each lane in the walk order.
var powRhoShifts = [24]int{1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44}

// powChallenge is the challenge payload returned by create_pow_challenge.
type powChallenge struct {
	Algorithm  string `json:"algorithm"`
	Challenge  string `json:"challenge"`
	Salt       string `json:"salt"`
	Signature  string `json:"signature"`
	Difficulty int64  `json:"difficulty"`
	ExpireAt   int64  `json:"expire_at"`
	TargetPath string `json:"target_path"`
}

// keccakF1600 applies rounds 1..23 of Keccak-f[1600] to the 50-word state.
// Lanes are stored as [2k]=high 32 bits, [2k+1]=low 32 bits.
func keccakF1600(state *[50]uint32) {
	var c [10]uint32
	var d [10]uint32
	var w [2]uint32

	for round := powDeltaRound; round <= powLastRound; round++ {
		// Theta: column parity.
		for x := 0; x < 5; x++ {
			base := 2 * x
			c[base] = state[base] ^ state[base+10] ^ state[base+20] ^ state[base+30] ^ state[base+40]
			c[base+1] = state[base+1] ^ state[base+11] ^ state[base+21] ^ state[base+31] ^ state[base+41]
		}
		for x := 0; x < 5; x++ {
			next := ((x + 1) % 5) * 2
			w[0] = c[next]
			w[1] = c[next+1]
			high, low := w[0], w[1]
			w[0] = high<<1 | low>>31
			w[1] = low<<1 | high>>31
			previous := ((x + 4) % 5) * 2
			d[x*2] = c[previous] ^ w[0]
			d[x*2+1] = c[previous+1] ^ w[1]
			for row := 0; row < 50; row += 10 {
				state[row+x*2] ^= d[x*2]
				state[row+x*2+1] ^= d[x*2+1]
			}
		}

		// Rho and pi: rotate each lane and permute it into place.
		w[0] = state[2]
		w[1] = state[3]
		for i := 0; i < 24; i++ {
			lane := powPiIndexes[i] * 2
			shift := powRhoShifts[i]
			c[0] = state[lane]
			c[1] = state[lane+1]
			high, low := w[0], w[1]
			offset := uint(32 - shift) // uint conversion reproduces the JS shift-count masking
			slot := 0
			if shift >= 32 {
				slot = 1
			}
			w[slot] = high<<uint(shift&31) | low>>(offset&31)
			w[(slot+1)%2] = low<<uint(shift&31) | high>>(offset&31)
			state[lane] = w[0]
			state[lane+1] = w[1]
			w[0] = c[0]
			w[1] = c[1]
		}

		// Chi: non-linear row mixing.
		for row := 0; row < 50; row += 10 {
			copy(c[:], state[row:row+10])
			for n := 0; n < 5; n++ {
				index := row + n*2
				first := ((n + 1) % 5) * 2
				second := ((n + 2) % 5) * 2
				state[index] ^= ^c[first] & c[second]
				state[index+1] ^= ^c[first+1] & c[second+1]
			}
		}

		state[0] ^= powRoundConstants[round*2]
		state[1] ^= powRoundConstants[round*2+1]
	}
}

// xorBytesInto XORs data[from:to], read as little-endian 64-bit lanes, into the
// state. from and to must be multiples of 8 apart.
//
// Lane indexes are derived from the absolute byte offset (offset/4), matching
// the reference implementation: absorbing a block that starts at byte 136
// continues at lane 34 instead of lane 0. Lanes past state[49] are dropped
// because the reference writes into a fixed-size Uint32Array, so the overflow
// bytes of such blocks are silently discarded. Upstream hashes the same way,
// which makes this truncation part of the wire format (verified against
// lib/deepseek-pow.js).
func xorBytesInto(state *[50]uint32, data []byte, from, to int) {
	for offset := from; offset < to; offset += 8 {
		lane := (offset / 4) &^ 1
		if lane+1 >= len(state) {
			return
		}
		state[lane] ^= uint32(data[offset+7])<<24 | uint32(data[offset+6])<<16 |
			uint32(data[offset+5])<<8 | uint32(data[offset+4])
		state[lane+1] ^= uint32(data[offset+3])<<24 | uint32(data[offset+2])<<16 |
			uint32(data[offset+1])<<8 | uint32(data[offset])
	}
}

// deepSeekHashV1 returns the 32-byte DeepSeekHashV1 digest of message.
func deepSeekHashV1(message []byte) [powOutLen]byte {
	var state [50]uint32
	queue := make([]byte, powRate)

	consumed := 0
	for len(message)-consumed >= powRate {
		xorBytesInto(&state, message, consumed, consumed+powRate)
		keccakF1600(&state)
		consumed += powRate
	}

	queueOffset := 0
	for ; consumed < len(message); consumed++ {
		queue[queueOffset] = message[consumed]
		queueOffset++
	}
	for i := queueOffset; i < powRate; i++ {
		queue[i] = 0
	}
	queue[queueOffset] |= 0x06
	queue[powRate-1] |= 0x80

	xorBytesInto(&state, queue, 0, powRate)
	keccakF1600(&state)

	var digest [powOutLen]byte
	for offset := 0; offset < powOutLen; offset += 8 {
		lane := (offset / 8) * 2
		binary.LittleEndian.PutUint32(digest[offset:], state[lane+1])
		binary.LittleEndian.PutUint32(digest[offset+4:], state[lane])
	}
	return digest
}

// solvePow brute-forces the challenge nonce in [0, difficulty).
// The prefix is absorbed once; every candidate only absorbs its decimal digits,
// which is the same optimisation the upstream page uses.
func solvePow(ctx context.Context, challenge powChallenge) (int64, error) {
	if challenge.Algorithm != "DeepSeekHashV1" {
		return 0, fmt.Errorf("Unsupported algorithm: %s", challenge.Algorithm)
	}
	target, err := hex.DecodeString(challenge.Challenge)
	if err != nil {
		return 0, fmt.Errorf("invalid challenge digest: %w", err)
	}
	if len(target) < powOutLen {
		return 0, errors.New("invalid challenge digest: too short")
	}

	prefix := []byte(fmt.Sprintf("%s_%d_", challenge.Salt, challenge.ExpireAt))
	var baseState [50]uint32
	var baseQueue [powRate]byte
	baseQueueOffset := 0

	consumed := 0
	for len(prefix)-consumed >= powRate {
		xorBytesInto(&baseState, prefix, consumed, consumed+powRate)
		keccakF1600(&baseState)
		consumed += powRate
	}
	for ; consumed < len(prefix); consumed++ {
		baseQueue[baseQueueOffset] = prefix[consumed]
		baseQueueOffset++
	}
	// Leave room for the longest decimal nonce of the search range.
	if baseQueueOffset+20 > powRate {
		return 0, errors.New("challenge prefix exceeds the hash rate")
	}

	var state [50]uint32
	var queue [powRate]byte
	for nonce := int64(0); nonce < challenge.Difficulty; nonce++ {
		if nonce&0x3FFF == 0 {
			if err := ctx.Err(); err != nil {
				return 0, err
			}
		}

		state = baseState
		queue = baseQueue
		queueOffset := baseQueueOffset
		for _, digit := range strconv.FormatInt(nonce, 10) {
			queue[queueOffset] = byte(digit)
			queueOffset++
		}
		for i := queueOffset; i < powRate; i++ {
			queue[i] = 0
		}
		queue[queueOffset] |= 0x06
		queue[powRate-1] |= 0x80

		xorBytesInto(&state, queue[:], 0, powRate)
		keccakF1600(&state)
		if digestMatches(&state, target) {
			return nonce, nil
		}
	}
	return 0, errors.New("No solution found")
}

// digestMatches compares the squeezed state against the target digest.
func digestMatches(state *[50]uint32, target []byte) bool {
	for offset := 0; offset < powOutLen; offset += 8 {
		lane := (offset / 8) * 2
		if state[lane+1] != binary.LittleEndian.Uint32(target[offset:]) {
			return false
		}
		if state[lane] != binary.LittleEndian.Uint32(target[offset+4:]) {
			return false
		}
	}
	return true
}
