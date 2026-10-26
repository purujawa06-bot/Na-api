package agenttools

import (
	"reflect"
	"testing"
)

func TestPGNToUCI(t *testing.T) {
	tests := []struct {
		name string
		pgn  string
		want []string
	}{
		{
			name: "simple opening",
			pgn:  "1. e4 e6 2. Nf3",
			want: []string{"e2e4", "e7e6", "g1f3"},
		},
		{
			name: "captures and check suffix",
			pgn:  "1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7#",
			want: []string{"e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6", "h5f7"},
		},
		{
			name: "kingside castling",
			pgn:  "1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O",
			want: []string{"e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "f8c5", "e1g1"},
		},
		{
			name: "both sides castling from FEN",
			pgn:  "[SetUp \"1\"]\n[FEN \"r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1\"]\n\n1. O-O O-O-O",
			want: []string{"e1g1", "e8c8"},
		},
		{
			name: "en passant",
			pgn:  "1. e4 a6 2. e5 d5 3. exd6",
			want: []string{"e2e4", "a7a6", "e4e5", "d7d5", "e5d6"},
		},
		{
			name: "promotion",
			pgn:  "1. a4 b5 2. axb5 a6 3. bxa6 Bb7 4. axb7 Nc6 5. bxa8=Q",
			want: []string{"a2a4", "b7b5", "a4b5", "a7a6", "b5a6", "c8b7", "a6b7", "b8c6", "b7a8q"},
		},
		{
			name: "file disambiguation",
			pgn:  "[FEN \"7k/8/8/8/8/5N2/8/1N5K w - - 0 1\"]\n\n1. Nbd2",
			want: []string{"b1d2"},
		},
		{
			name: "rank disambiguation",
			pgn:  "[FEN \"7k/8/8/8/8/5N2/8/1N5K w - - 0 1\"]\n\n1. Nfd2",
			want: []string{"f3d2"},
		},
		{
			name: "comments variations and results",
			pgn:  "1. e4 {[%clk 0:03:00]} e5 2. Nf3 (2. Bc4 Nc6) Nc6 3. Bb5 a6 1-0",
			want: []string{"e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := pgnToUCI(test.pgn)
			if err != nil {
				t.Fatalf("pgnToUCI() error = %v", err)
			}
			if !reflect.DeepEqual(got, test.want) {
				t.Fatalf("pgnToUCI() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestPGNToUCIRejectsIllegalMoves(t *testing.T) {
	for _, pgn := range []string{
		"1. e4 e5 2. Qxf7",
		"1. e4 Ke2",
		"1. e4 e5 2. Nf6",
	} {
		if _, err := pgnToUCI(pgn); err == nil {
			t.Fatalf("pgnToUCI(%q) expected an error", pgn)
		}
	}
}

func TestPGNToUCIEmpty(t *testing.T) {
	got, err := pgnToUCI("")
	if err != nil {
		t.Fatalf("pgnToUCI() error = %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("pgnToUCI() = %v, want no moves", got)
	}
}
