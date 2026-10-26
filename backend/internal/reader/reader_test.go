package reader

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/purujawa06-bot/na-api/backend/internal/htmlx"
)

func TestParseFlatJSObject(t *testing.T) {
	input := `{id:'12345',series:'One Piece',jumlahgambar:12,hasNext:true,thumbnail:'https:\/\/x\/y.jpg',empty:null}`
	got := parseFlatJSObject(input)
	if got["id"] != "12345" || got["series"] != "One Piece" || got["jumlahgambar"] != float64(12) || got["hasNext"] != true {
		t.Fatalf("unexpected parse: %#v", got)
	}
	if got["thumbnail"] != "https://x/y.jpg" || got["empty"] != nil {
		t.Fatalf("unexpected parse: %#v", got)
	}
}

func TestParseBgeList(t *testing.T) {
	document := `<html><body>
	<div class="bge">
	  <div class="bgei"><img src="https://img/cover.jpg"></div>
	  <div class="kan">
	    <div class="judul2">12k pembaca</div>
	    <a href="/manga/one-piece/"><h3>One Piece</h3></a>
	    <p>Sinopsis singkat</p>
	    <div class="new1"><a href="/manga/one-piece-chapter-1/"><span>Awal</span><span>Chapter 1</span></a></div>
	    <div class="new1"><a href="/manga/one-piece-chapter-100/"><span>Terbaru:</span><span>Chapter 100</span></a></div>
	  </div>
	  <div class="tpe1_inf">Manga Action Adventure</div>
	</div>
	</body></html>`
	root, err := htmlx.Parse(document)
	if err != nil {
		t.Fatal(err)
	}
	items := parseBgeList(root)
	if len(items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(items))
	}
	item := items[0]
	if item.Slug != "one-piece" || item.Title != "One Piece" || item.Cover != "https://img/cover.jpg" {
		t.Fatalf("unexpected item: %#v", item)
	}
	if item.Type != "Manga" || item.Theme != "Action Adventure" || item.Readers != "12k" || item.Synopsis != "Sinopsis singkat" {
		t.Fatalf("unexpected item: %#v", item)
	}
	if item.Chapters.First == nil || item.Chapters.First.Title != "Chapter 1" || item.Chapters.First.URL != komikuHost+"/manga/one-piece-chapter-1/" {
		t.Fatalf("unexpected first chapter: %#v", item.Chapters.First)
	}
	if item.Chapters.Latest == nil || item.Chapters.Latest.Title != "Chapter 100" {
		t.Fatalf("unexpected latest chapter: %#v", item.Chapters.Latest)
	}
}

func TestParseLisCards(t *testing.T) {
	document := `<html><body>
	<div id="rank-mingguan">
	  <article class="ls4">
	    <div class="rank-num">1</div>
	    <a href="/manga/x/"><h3>X</h3></a>
	    <img data-src="https://img/x.jpg">
	    <div class="ls2t">Manga</div>
	    <div class="ls2l">Chapter 5</div>
	  </article>
	</div>
	</body></html>`
	root, err := htmlx.Parse(document)
	if err != nil {
		t.Fatal(err)
	}
	cards := parseLisCards(root, "rank-mingguan", "ls4")
	if len(cards) != 1 {
		t.Fatalf("expected 1 card, got %d", len(cards))
	}
	card := cards[0]
	if card.Rank != float64(1) || card.Slug != "x" || card.Title != "X" || card.Cover != "https://img/x.jpg" {
		t.Fatalf("unexpected card: %#v", card)
	}
	if card.Meta != "Manga" || card.LatestChapter != "Chapter 5" || card.URL != komikuHost+"/manga/x/" {
		t.Fatalf("unexpected card: %#v", card)
	}
}

func TestCleanDramaboxBook(t *testing.T) {
	var raw map[string]any
	payload := `{"bookId":"41000105764","bookName":"Cinta","bookNameEn":"Love",
	"introduction":"Sinopsis","cover":"https://img/c.jpg","labels":["a"],
	"ratings":4.5,"viewCountDisplay":"1M","chapterCount":80,
	"typeOneName":"Romance","typeTwoName":"Drama"}`
	decoder := json.NewDecoder(strings.NewReader(payload))
	decoder.UseNumber()
	if err := decoder.Decode(&raw); err != nil {
		t.Fatal(err)
	}
	book := cleanDramaboxBook(raw, "in")
	if book.ID != "41000105764" || book.Title != "Cinta" || book.URL != dramaboxHost+"/in/drama/41000105764/Love" {
		t.Fatalf("unexpected book: %#v", book)
	}
	if len(book.Genre) != 2 || len(book.Tags) != 1 {
		t.Fatalf("unexpected collections: %#v", book)
	}
	encoded, err := json.Marshal(book)
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded["episodes"] != float64(80) || decoded["ratings"] != 4.5 {
		t.Fatalf("unexpected numeric encoding: %s", encoded)
	}
}

func TestCleanDramaboxEpisode(t *testing.T) {
	var raw map[string]any
	payload := `{"id":578668219,"name":"Ep 1","index":1,"unlock":true,"duration":120,
	"chapterPrice":0,"utime":"2024-01-01","mp4":"https://v/x.mp4?Expires=1700000000"}`
	decoder := json.NewDecoder(strings.NewReader(payload))
	decoder.UseNumber()
	if err := decoder.Decode(&raw); err != nil {
		t.Fatal(err)
	}
	episode := cleanDramaboxEpisode(raw)
	if !episode.Unlock || episode.VideoURL != "https://v/x.mp4?Expires=1700000000" || episode.Price != json.Number("0") {
		t.Fatalf("unexpected episode: %#v", episode)
	}
}
