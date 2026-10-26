package agenttools

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
)

// The chess helpers below implement just enough of chess.js to convert a PGN
// main line (SAN) into the UCI move list expected by the Maiachess API.
//
// Board layout uses the 0x88 representation with a8 = 0 and h1 = 119, so rank
// index 0 is rank 8 and index 7 is rank 1.

const (
	piecePawn   byte = 1
	pieceKnight byte = 2
	pieceBishop byte = 3
	pieceRook   byte = 4
	pieceQueen  byte = 5
	pieceKing   byte = 6
	colorBlack  byte = 8
)

const (
	// startFEN is the standard chess starting position.
	startFEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"

	squareA1 = 112
	squareB1 = 113
	squareC1 = 114
	squareD1 = 115
	squareE1 = 116
	squareF1 = 117
	squareG1 = 118
	squareH1 = 119

	squareA8 = 0
	squareB8 = 1
	squareC8 = 2
	squareD8 = 3
	squareE8 = 4
	squareF8 = 5
	squareG8 = 6
	squareH8 = 7
)

const (
	castleWhiteKing  uint8 = 1
	castleWhiteQueen uint8 = 2
	castleBlackKing  uint8 = 4
	castleBlackQueen uint8 = 8
)

var (
	knightOffsets = [...]int{33, 31, 18, 14, -33, -31, -18, -14}
	bishopDirs    = [...]int{17, 15, -17, -15}
	rookDirs      = [...]int{16, -16, 1, -1}
	kingDirs      = [...]int{17, 16, 15, 1, -1, -15, -16, -17}
)

// position is an immutable-by-convention chess position. Applying a move
// returns a fresh copy so legality checks never mutate the caller's state.
type position struct {
	board    [128]byte
	side     byte // 'w' or 'b'
	castling uint8
	ep       int // en-passant target square, -1 when absent
}

// chessMove is a fully resolved move; castle and enPassant carry the extra
// bookkeeping needed by apply.
type chessMove struct {
	from      int
	to        int
	promo     byte
	castle    bool
	enPassant bool
}

func onBoard(square int) bool {
	return square >= 0 && square < 128 && square&0x88 == 0
}

func pieceType(piece byte) byte { return piece &^ colorBlack }

func pieceColor(piece byte) byte {
	if piece&colorBlack != 0 {
		return 'b'
	}
	return 'w'
}

func opposite(color byte) byte {
	if color == 'w' {
		return 'b'
	}
	return 'w'
}

func squareName(square int) string {
	return string([]byte{byte('a' + square&7), byte(int('8') - square>>4)})
}

func promoName(piece byte) string {
	switch piece {
	case pieceQueen:
		return "q"
	case pieceRook:
		return "r"
	case pieceBishop:
		return "b"
	case pieceKnight:
		return "n"
	default:
		return ""
	}
}

func pieceFromFEN(char byte) (byte, bool) {
	switch char {
	case 'P':
		return piecePawn, true
	case 'N':
		return pieceKnight, true
	case 'B':
		return pieceBishop, true
	case 'R':
		return pieceRook, true
	case 'Q':
		return pieceQueen, true
	case 'K':
		return pieceKing, true
	case 'p':
		return piecePawn | colorBlack, true
	case 'n':
		return pieceKnight | colorBlack, true
	case 'b':
		return pieceBishop | colorBlack, true
	case 'r':
		return pieceRook | colorBlack, true
	case 'q':
		return pieceQueen | colorBlack, true
	case 'k':
		return pieceKing | colorBlack, true
	default:
		return 0, false
	}
}

func parseSquare(name string) (int, error) {
	if len(name) != 2 {
		return 0, fmt.Errorf("invalid square %q", name)
	}
	file := name[0]
	rank := name[1]
	if file < 'a' || file > 'h' || rank < '1' || rank > '8' {
		return 0, fmt.Errorf("invalid square %q", name)
	}
	return (int('8')-int(rank))*16 + int(file-'a'), nil
}

// parseFEN builds a position from the first four FEN fields.
func parseFEN(fen string) (*position, error) {
	fields := strings.Fields(fen)
	if len(fields) < 4 {
		return nil, errors.New("invalid FEN: expected at least 4 fields")
	}

	pos := &position{ep: -1}
	rank, file := 0, 0
	for i := 0; i < len(fields[0]); i++ {
		char := fields[0][i]
		switch {
		case char == '/':
			if file != 8 {
				return nil, errors.New("invalid FEN: bad rank width")
			}
			rank++
			file = 0
		case char >= '1' && char <= '8':
			file += int(char - '0')
		default:
			piece, ok := pieceFromFEN(char)
			if !ok {
				return nil, fmt.Errorf("invalid FEN piece %q", string(char))
			}
			if rank > 7 || file > 7 {
				return nil, errors.New("invalid FEN: board overflow")
			}
			pos.board[rank*16+file] = piece
			file++
		}
	}
	if rank != 7 || file != 8 {
		return nil, errors.New("invalid FEN: board is not 8x8")
	}

	switch fields[1] {
	case "w":
		pos.side = 'w'
	case "b":
		pos.side = 'b'
	default:
		return nil, errors.New("invalid FEN: side to move must be w or b")
	}

	if fields[2] != "-" {
		for i := 0; i < len(fields[2]); i++ {
			switch fields[2][i] {
			case 'K':
				pos.castling |= castleWhiteKing
			case 'Q':
				pos.castling |= castleWhiteQueen
			case 'k':
				pos.castling |= castleBlackKing
			case 'q':
				pos.castling |= castleBlackQueen
			default:
				return nil, errors.New("invalid FEN: bad castling rights")
			}
		}
	}

	if fields[3] != "-" {
		square, err := parseSquare(fields[3])
		if err != nil {
			return nil, fmt.Errorf("invalid FEN: %w", err)
		}
		pos.ep = square
	}
	return pos, nil
}

// apply returns the position after playing move. It handles captures,
// promotions, castling rook movement, en passant, and castling-right updates.
func (pos *position) apply(move chessMove) *position {
	next := *pos
	board := &next.board
	piece := board[move.from]
	board[move.from] = 0

	if move.enPassant {
		captured := (move.from & 0xF0) | (move.to & 0x07)
		board[captured] = 0
	}
	if move.promo != 0 {
		board[move.to] = move.promo | (piece & colorBlack)
	} else {
		board[move.to] = piece
	}

	if move.castle {
		if pos.side == 'w' {
			if move.to == squareG1 {
				board[squareF1], board[squareH1] = board[squareH1], 0
			} else {
				board[squareD1], board[squareA1] = board[squareA1], 0
			}
		} else {
			if move.to == squareG8 {
				board[squareF8], board[squareH8] = board[squareH8], 0
			} else {
				board[squareD8], board[squareA8] = board[squareA8], 0
			}
		}
	}

	if pieceType(piece) == pieceKing {
		if pos.side == 'w' {
			next.castling &^= castleWhiteKing | castleWhiteQueen
		} else {
			next.castling &^= castleBlackKing | castleBlackQueen
		}
	}
	for _, square := range [...]int{move.from, move.to} {
		switch square {
		case squareA1:
			next.castling &^= castleWhiteQueen
		case squareH1:
			next.castling &^= castleWhiteKing
		case squareA8:
			next.castling &^= castleBlackQueen
		case squareH8:
			next.castling &^= castleBlackKing
		}
	}

	next.ep = -1
	if pieceType(piece) == piecePawn {
		delta := move.to - move.from
		if delta == 32 || delta == -32 {
			next.ep = (move.from + move.to) / 2
		}
	}
	next.side = opposite(pos.side)
	return &next
}

// attackedBy reports whether byColor attacks square.
func (pos *position) attackedBy(square int, byColor byte) bool {
	// Pawns.
	if byColor == 'w' {
		for _, offset := range [...]int{15, 17} {
			from := square + offset
			if onBoard(from) && pos.board[from] == piecePawn {
				return true
			}
		}
	} else {
		for _, offset := range [...]int{-15, -17} {
			from := square + offset
			if onBoard(from) && pos.board[from] == piecePawn|colorBlack {
				return true
			}
		}
	}

	// Knights.
	for _, offset := range knightOffsets {
		from := square + offset
		if !onBoard(from) {
			continue
		}
		piece := pos.board[from]
		if piece != 0 && pieceColor(piece) == byColor && pieceType(piece) == pieceKnight {
			return true
		}
	}

	// Adjacent king.
	for _, offset := range kingDirs {
		from := square + offset
		if !onBoard(from) {
			continue
		}
		piece := pos.board[from]
		if piece != 0 && pieceColor(piece) == byColor && pieceType(piece) == pieceKing {
			return true
		}
	}

	// Rook / queen.
	for _, dir := range rookDirs {
		for from := square + dir; onBoard(from); from += dir {
			piece := pos.board[from]
			if piece == 0 {
				continue
			}
			if pieceColor(piece) == byColor && (pieceType(piece) == pieceRook || pieceType(piece) == pieceQueen) {
				return true
			}
			break
		}
	}

	// Bishop / queen.
	for _, dir := range bishopDirs {
		for from := square + dir; onBoard(from); from += dir {
			piece := pos.board[from]
			if piece == 0 {
				continue
			}
			if pieceColor(piece) == byColor && (pieceType(piece) == pieceBishop || pieceType(piece) == pieceQueen) {
				return true
			}
			break
		}
	}
	return false
}

// kingAttacked reports whether side's king is in check (a missing king counts
// as check so malformed positions are rejected).
func (pos *position) kingAttacked(side byte) bool {
	for square := 0; square < 128; square++ {
		if !onBoard(square) {
			continue
		}
		piece := pos.board[square]
		if piece != 0 && pieceColor(piece) == side && pieceType(piece) == pieceKing {
			return pos.attackedBy(square, opposite(side))
		}
	}
	return true
}

func (pos *position) canLand(from, to int, piece byte) bool {
	if !onBoard(to) {
		return false
	}
	target := pos.board[to]
	return target == 0 || pieceColor(target) != pieceColor(piece)
}

// pseudoMoves generates every move that follows the movement rules but may
// leave the mover's own king in check.
func (pos *position) pseudoMoves() []chessMove {
	var moves []chessMove
	for from := 0; from < 128; from++ {
		if !onBoard(from) {
			continue
		}
		piece := pos.board[from]
		if piece == 0 || pieceColor(piece) != pos.side {
			continue
		}
		switch pieceType(piece) {
		case piecePawn:
			moves = append(moves, pos.pawnMoves(from, piece)...)
		case pieceKnight:
			for _, offset := range knightOffsets {
				to := from + offset
				if pos.canLand(from, to, piece) {
					moves = append(moves, chessMove{from: from, to: to})
				}
			}
		case pieceBishop:
			moves = append(moves, pos.slideMoves(from, piece, bishopDirs[:])...)
		case pieceRook:
			moves = append(moves, pos.slideMoves(from, piece, rookDirs[:])...)
		case pieceQueen:
			moves = append(moves, pos.slideMoves(from, piece, rookDirs[:])...)
			moves = append(moves, pos.slideMoves(from, piece, bishopDirs[:])...)
		case pieceKing:
			for _, offset := range kingDirs {
				to := from + offset
				if pos.canLand(from, to, piece) {
					moves = append(moves, chessMove{from: from, to: to})
				}
			}
			moves = append(moves, pos.castleMoves(from)...)
		}
	}
	return moves
}

func (pos *position) slideMoves(from int, piece byte, dirs []int) []chessMove {
	var moves []chessMove
	for _, dir := range dirs {
		for to := from + dir; onBoard(to); to += dir {
			target := pos.board[to]
			if target == 0 {
				moves = append(moves, chessMove{from: from, to: to})
				continue
			}
			if pieceColor(target) != pieceColor(piece) {
				moves = append(moves, chessMove{from: from, to: to})
			}
			break
		}
	}
	return moves
}

func (pos *position) pawnMoves(from int, piece byte) []chessMove {
	var moves []chessMove
	dir := -16
	startRank := 6
	promoRank := 0
	if pieceColor(piece) == 'b' {
		dir = 16
		startRank = 1
		promoRank = 7
	}

	one := from + dir
	if onBoard(one) && pos.board[one] == 0 {
		if one>>4 == promoRank {
			moves = appendPromotions(moves, from, one)
		} else {
			moves = append(moves, chessMove{from: from, to: one})
			two := from + 2*dir
			if from>>4 == startRank && onBoard(two) && pos.board[two] == 0 {
				moves = append(moves, chessMove{from: from, to: two})
			}
		}
	}

	for _, side := range [...]int{-1, 1} {
		to := from + dir + side
		if !onBoard(to) {
			continue
		}
		if pos.ep == to {
			moves = append(moves, chessMove{from: from, to: to, enPassant: true})
			continue
		}
		target := pos.board[to]
		if target == 0 || pieceColor(target) == pieceColor(piece) {
			continue
		}
		if to>>4 == promoRank {
			moves = appendPromotions(moves, from, to)
		} else {
			moves = append(moves, chessMove{from: from, to: to})
		}
	}
	return moves
}

func appendPromotions(moves []chessMove, from, to int) []chessMove {
	for _, promo := range [...]byte{pieceQueen, pieceRook, pieceBishop, pieceKnight} {
		moves = append(moves, chessMove{from: from, to: to, promo: promo})
	}
	return moves
}

func (pos *position) castleMoves(from int) []chessMove {
	if pos.kingAttacked(pos.side) {
		return nil
	}
	enemy := opposite(pos.side)
	var moves []chessMove

	if pos.side == 'w' {
		if from != squareE1 || pos.board[squareE1] != pieceKing {
			return nil
		}
		if pos.castling&castleWhiteKing != 0 &&
			pos.board[squareH1] == pieceRook &&
			pos.board[squareF1] == 0 && pos.board[squareG1] == 0 &&
			!pos.attackedBy(squareF1, enemy) && !pos.attackedBy(squareG1, enemy) {
			moves = append(moves, chessMove{from: squareE1, to: squareG1, castle: true})
		}
		if pos.castling&castleWhiteQueen != 0 &&
			pos.board[squareA1] == pieceRook &&
			pos.board[squareB1] == 0 && pos.board[squareC1] == 0 && pos.board[squareD1] == 0 &&
			!pos.attackedBy(squareD1, enemy) && !pos.attackedBy(squareC1, enemy) {
			moves = append(moves, chessMove{from: squareE1, to: squareC1, castle: true})
		}
		return moves
	}

	if from != squareE8 || pos.board[squareE8] != (pieceKing|colorBlack) {
		return nil
	}
	if pos.castling&castleBlackKing != 0 &&
		pos.board[squareH8] == pieceRook|colorBlack &&
		pos.board[squareF8] == 0 && pos.board[squareG8] == 0 &&
		!pos.attackedBy(squareF8, enemy) && !pos.attackedBy(squareG8, enemy) {
		moves = append(moves, chessMove{from: squareE8, to: squareG8, castle: true})
	}
	if pos.castling&castleBlackQueen != 0 &&
		pos.board[squareA8] == pieceRook|colorBlack &&
		pos.board[squareB8] == 0 && pos.board[squareC8] == 0 && pos.board[squareD8] == 0 &&
		!pos.attackedBy(squareD8, enemy) && !pos.attackedBy(squareC8, enemy) {
		moves = append(moves, chessMove{from: squareE8, to: squareC8, castle: true})
	}
	return moves
}

// legalMoves filters pseudo-legal moves that leave the mover in check.
func (pos *position) legalMoves() []chessMove {
	pseudo := pos.pseudoMoves()
	legal := make([]chessMove, 0, len(pseudo))
	for _, move := range pseudo {
		next := pos.apply(move)
		if !next.kingAttacked(pos.side) {
			legal = append(legal, move)
		}
	}
	return legal
}

// sanDescriptor is the parsed shape of a SAN token.
type sanDescriptor struct {
	piece    byte
	fromFile int // file index 0..7, -1 when unset
	fromRank int // rank index 0..7, -1 when unset
	to       int
	promo    byte
	capture  bool
	hasMark  bool // whether the token carried an explicit capture mark
	castle   int  // 0 none, 1 king side, 2 queen side
}

func promotionPiece(char byte) byte {
	switch char {
	case 'Q', 'q':
		return pieceQueen
	case 'R', 'r':
		return pieceRook
	case 'B', 'b':
		return pieceBishop
	case 'N', 'n':
		return pieceKnight
	default:
		return 0
	}
}

func isPromotionLetter(char byte) bool {
	return char == 'Q' || char == 'R' || char == 'B' || char == 'N' ||
		char == 'q' || char == 'r' || char == 'b' || char == 'n'
}

// parseSAN turns a single SAN token (already stripped of annotations) into a
// descriptor used to match legal moves.
func parseSAN(token string) (sanDescriptor, error) {
	desc := sanDescriptor{fromFile: -1, fromRank: -1}
	s := strings.TrimSpace(token)
	for len(s) > 0 && strings.IndexByte("+#!?", s[len(s)-1]) >= 0 {
		s = s[:len(s)-1]
	}
	if s == "" {
		return desc, errors.New("empty SAN token")
	}

	normalized := strings.ToUpper(strings.ReplaceAll(s, "0", "O"))
	switch normalized {
	case "O-O":
		desc.piece = pieceKing
		desc.castle = 1
		return desc, nil
	case "O-O-O":
		desc.piece = pieceKing
		desc.castle = 2
		return desc, nil
	}

	// Promotion suffix: "e8=Q" or the loose "e8Q" form.
	if index := strings.IndexByte(s, '='); index >= 0 {
		promo := promotionPiece(s[index+1])
		if promo == 0 {
			return desc, fmt.Errorf("invalid promotion in %q", token)
		}
		desc.promo = promo
		s = s[:index]
	} else if len(s) >= 3 && isPromotionLetter(s[len(s)-1]) && s[len(s)-2] >= '1' && s[len(s)-2] <= '8' {
		desc.promo = promotionPiece(s[len(s)-1])
		s = s[:len(s)-1]
	}

	if len(s) < 2 {
		return desc, fmt.Errorf("invalid SAN token %q", token)
	}
	dest, err := parseSquare(s[len(s)-2:])
	if err != nil {
		return desc, fmt.Errorf("invalid SAN token %q", token)
	}
	desc.to = dest
	prefix := s[:len(s)-2]

	if strings.HasSuffix(prefix, "x") {
		desc.capture = true
		desc.hasMark = true
		prefix = prefix[:len(prefix)-1]
	} else if strings.HasSuffix(prefix, ":") {
		desc.capture = true
		desc.hasMark = true
		prefix = prefix[:len(prefix)-1]
	}

	if prefix != "" {
		switch prefix[0] {
		case 'K':
			desc.piece = pieceKing
			prefix = prefix[1:]
		case 'Q':
			desc.piece = pieceQueen
			prefix = prefix[1:]
		case 'R':
			desc.piece = pieceRook
			prefix = prefix[1:]
		case 'B':
			desc.piece = pieceBishop
			prefix = prefix[1:]
		case 'N':
			desc.piece = pieceKnight
			prefix = prefix[1:]
		default:
			desc.piece = piecePawn
		}
	} else {
		desc.piece = piecePawn
	}

	for i := 0; i < len(prefix); i++ {
		char := prefix[i]
		switch {
		case char >= 'a' && char <= 'h':
			if desc.fromFile >= 0 {
				return desc, fmt.Errorf("invalid disambiguation in %q", token)
			}
			desc.fromFile = int(char - 'a')
		case char >= '1' && char <= '8':
			if desc.fromRank >= 0 {
				return desc, fmt.Errorf("invalid disambiguation in %q", token)
			}
			desc.fromRank = int('8' - char)
		default:
			return desc, fmt.Errorf("invalid SAN token %q", token)
		}
	}
	if desc.capture && desc.piece == piecePawn && desc.fromFile < 0 {
		// Pawn captures always disambiguate by file, so an explicit capture
		// without a file is malformed.
		return desc, fmt.Errorf("invalid pawn capture %q", token)
	}
	return desc, nil
}

func (pos *position) matchesDescriptor(move chessMove, desc sanDescriptor) bool {
	piece := pos.board[move.from]
	if pieceType(piece) != desc.piece {
		return false
	}
	if desc.castle != 0 {
		if !move.castle {
			return false
		}
		if desc.castle == 1 && move.to != squareG1 && move.to != squareG8 {
			return false
		}
		if desc.castle == 2 && move.to != squareC1 && move.to != squareC8 {
			return false
		}
	} else {
		if move.castle || move.to != desc.to {
			return false
		}
	}
	if desc.promo != 0 {
		if move.promo != desc.promo {
			return false
		}
	} else if move.promo != 0 {
		return false
	}
	if desc.hasMark {
		captured := pos.board[move.to] != 0 || move.enPassant
		if captured != desc.capture {
			return false
		}
	}
	if desc.fromFile >= 0 && move.from&7 != desc.fromFile {
		return false
	}
	if desc.fromRank >= 0 && move.from>>4 != desc.fromRank {
		return false
	}
	return true
}

func (pos *position) findSANMove(desc sanDescriptor, token string) (chessMove, error) {
	var matches []chessMove
	for _, move := range pos.legalMoves() {
		if pos.matchesDescriptor(move, desc) {
			matches = append(matches, move)
		}
	}
	switch len(matches) {
	case 0:
		return chessMove{}, fmt.Errorf("illegal move %q", token)
	case 1:
		return matches[0], nil
	default:
		return chessMove{}, fmt.Errorf("ambiguous move %q", token)
	}
}

var (
	fenHeaderPattern = regexp.MustCompile(`(?m)^\[\s*FEN\s+"([^"]*)"\s*\]`)
	nagPattern       = regexp.MustCompile(`\$\d+`)
)

// pgnToUCI converts the PGN main line to UCI moves, mirroring
// chess.js `history({verbose:true})` mapped to from+to+promotion.
func pgnToUCI(pgn string) ([]string, error) {
	fen := startFEN
	if match := fenHeaderPattern.FindStringSubmatch(pgn); len(match) == 2 {
		if candidate := strings.TrimSpace(match[1]); candidate != "" {
			fen = candidate
		}
	}
	pos, err := parseFEN(fen)
	if err != nil {
		return nil, err
	}

	clean := strings.Join(strings.Fields(nagPattern.ReplaceAllString(stripPGNAnnotations(pgn), " ")), " ")
	tokens := strings.Fields(clean)
	moves := make([]string, 0, len(tokens))
	for _, raw := range tokens {
		token := trimMoveNumber(raw)
		if token == "" {
			continue
		}
		if isPGNResult(token) {
			break
		}
		if token == "e.p." || token == "ep" {
			continue
		}
		desc, err := parseSAN(token)
		if err != nil {
			return nil, err
		}
		move, err := pos.findSANMove(desc, token)
		if err != nil {
			return nil, err
		}
		moves = append(moves, squareName(move.from)+squareName(move.to)+promoName(move.promo))
		pos = pos.apply(move)
	}
	return moves, nil
}

// stripPGNAnnotations removes headers, comments, variations, and recursive
// annotations, leaving the main-line move text.
func stripPGNAnnotations(pgn string) string {
	var builder strings.Builder
	depth := 0
	for i := 0; i < len(pgn); i++ {
		char := pgn[i]
		switch {
		case char == '{':
			for i < len(pgn) && pgn[i] != '}' {
				i++
			}
		case char == ';':
			for i < len(pgn) && pgn[i] != '\n' {
				i++
			}
		case char == '[':
			for i < len(pgn) && pgn[i] != ']' {
				i++
			}
		case char == '(':
			depth++
		case char == ')':
			if depth > 0 {
				depth--
			}
		default:
			if depth == 0 {
				builder.WriteByte(char)
			}
		}
	}
	return builder.String()
}

// trimMoveNumber drops a leading "12." / "12..." from a token.
func trimMoveNumber(token string) string {
	index := 0
	for index < len(token) && token[index] >= '0' && token[index] <= '9' {
		index++
	}
	if index == 0 {
		return token
	}
	if index < len(token) && token[index] == '.' {
		for index < len(token) && token[index] == '.' {
			index++
		}
		return token[index:]
	}
	if index == len(token) {
		return ""
	}
	return token
}

func isPGNResult(token string) bool {
	switch token {
	case "1-0", "0-1", "1/2-1/2", "*":
		return true
	default:
		return false
	}
}
