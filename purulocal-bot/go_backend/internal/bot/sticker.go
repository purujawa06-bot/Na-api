package bot

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/draw"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"strings"

	"github.com/HugoSmits86/nativewebp"
	xdraw "golang.org/x/image/draw"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
)

func (m *Manager) handleStickerCommand(ctx context.Context, evt *events.Message, cfg Config) error {
	imgMsg := m.findImageForSticker(evt)
	if imgMsg == nil {
		_ = m.sendReply(ctx, evt, "Kirim atau reply gambar dengan caption .s atau .sticker")
		return nil
	}

	m.mu.RLock()
	c := m.client
	m.mu.RUnlock()
	if c == nil {
		return errors.New("client not ready")
	}

	data, err := c.Download(ctx, imgMsg)
	if err != nil {
		_ = m.sendReply(ctx, evt, "Gagal mengunduh gambar: "+err.Error())
		return nil
	}
	if len(data) == 0 {
		_ = m.sendReply(ctx, evt, "Gambar kosong atau tidak dapat diunduh.")
		return nil
	}

	pack := strings.TrimSpace(cfg.StickerPack)
	author := strings.TrimSpace(cfg.StickerAuthor)
	if pack == "" {
		pack = strings.TrimSpace(cfg.BotName)
		if pack == "" {
			pack = "puruLocal"
		}
	}
	if author == "" {
		author = strings.TrimSpace(cfg.OwnerName)
		if author == "" {
			author = "puruLocal Bot"
		}
	}

	webpData, err := makeStickerWebP(data, pack, author)
	if err != nil {
		_ = m.sendReply(ctx, evt, "Gagal membuat sticker: "+err.Error())
		return nil
	}

	uploaded, err := c.Upload(ctx, webpData, whatsmeow.MediaImage)
	if err != nil {
		_ = m.sendReply(ctx, evt, "Gagal upload sticker: "+err.Error())
		return nil
	}

	sticker := &waE2E.StickerMessage{
		URL:           proto.String(uploaded.URL),
		DirectPath:    proto.String(uploaded.DirectPath),
		MediaKey:      uploaded.MediaKey,
		Mimetype:      proto.String("image/webp"),
		FileEncSHA256: uploaded.FileEncSHA256,
		FileSHA256:    uploaded.FileSHA256,
		FileLength:    proto.Uint64(uint64(len(webpData))),
		IsAnimated:    proto.Bool(false),
		StickerSentTS: proto.Int64(evt.Info.Timestamp.UnixMilli()),
		Height:        proto.Uint32(512),
		Width:         proto.Uint32(512),
		ContextInfo:   buildReplyContext(evt),
	}
	_, err = c.SendMessage(ctx, evt.Info.Chat, &waE2E.Message{StickerMessage: sticker})
	if err != nil {
		_ = m.sendReply(ctx, evt, "Gagal mengirim sticker: "+err.Error())
		return nil
	}
	return nil
}

func (m *Manager) findImageForSticker(evt *events.Message) *waE2E.ImageMessage {
	msg := evt.Message
	if msg == nil {
		return nil
	}
	// 1) image langsung dengan caption command
	if img := msg.GetImageMessage(); img != nil {
		return img
	}
	// 2) reply ke image: quoted message di context info
	if ci := extractIncomingContextInfo(msg); ci != nil {
		if q := ci.GetQuotedMessage(); q != nil {
			if img := q.GetImageMessage(); img != nil {
				return img
			}
		}
	}
	return nil
}

func makeStickerWebP(src []byte, pack, author string) ([]byte, error) {
	img, _, err := image.Decode(bytes.NewReader(src))
	if err != nil {
		return nil, fmt.Errorf("decode gambar: %w", err)
	}
	canvas := image.NewNRGBA(image.Rect(0, 0, 512, 512))
	// transparan default (zero value NRGBA)
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= 0 || h <= 0 {
		return nil, errors.New("ukuran gambar tidak valid")
	}
	scale := 512.0 / float64(w)
	if float64(h)*scale > 512.0 {
		scale = 512.0 / float64(h)
	}
	nw := int(float64(w) * scale)
	nh := int(float64(h) * scale)
	if nw < 1 {
		nw = 1
	}
	if nh < 1 {
		nh = 1
	}
	offX := (512 - nw) / 2
	offY := (512 - nh) / 2
	dstRect := image.Rect(offX, offY, offX+nw, offY+nh)
	xdraw.CatmullRom.Scale(canvas, dstRect, img, b, draw.Over, nil)

	var buf bytes.Buffer
	if err := nativewebp.Encode(&buf, canvas, &nativewebp.Options{UseExtendedFormat: true}); err != nil {
		return nil, fmt.Errorf("encode webp: %w", err)
	}
	out := injectStickerExif(buf.Bytes(), pack, author)
	return out, nil
}

// injectStickerExif menambahkan EXIF chunk berisi metadata pack/author ke WebP (best-effort).
func injectStickerExif(webp []byte, pack, author string) []byte {
	exif := buildWAStickerExif(pack, author)
	if len(exif) == 0 || len(webp) < 12 {
		return webp
	}
	// pastikan ada VP8X; nativewebp dengan UseExtendedFormat menghasilkan VP8X
	if string(webp[0:4]) != "RIFF" || string(webp[8:12]) != "WEBP" {
		return webp
	}
	// set EXIF flag di VP8X jika chunk VP8X ada
	out := append([]byte(nil), webp...)
	if len(out) >= 30 && string(out[12:16]) == "VP8X" {
		out[20] |= 0x08 // EXIF flag
	}
	// sisipkan EXIF chunk setelah VP8X chunk (offset 30 = 12 RIFF hdr + 8 VP8X hdr + 10 payload)
	chunk := make([]byte, 8+len(exif))
	copy(chunk[0:4], []byte("EXIF"))
	binary.LittleEndian.PutUint32(chunk[4:8], uint32(len(exif)))
	copy(chunk[8:], exif)
	if len(exif)%2 == 1 {
		chunk = append(chunk, 0)
	}
	insertAt := 12
	if len(out) >= 30 && string(out[12:16]) == "VP8X" {
		vp8xSize := int(binary.LittleEndian.Uint32(out[16:20]))
		insertAt = 12 + 8 + vp8xSize
		if insertAt > len(out) {
			insertAt = len(out)
		}
	}
	res := make([]byte, 0, len(out)+len(chunk))
	res = append(res, out[:insertAt]...)
	res = append(res, chunk...)
	res = append(res, out[insertAt:]...)
	// update RIFF size
	if len(res) >= 8 {
		binary.LittleEndian.PutUint32(res[4:8], uint32(len(res)-8))
	}
	return res
}

func buildWAStickerExif(pack, author string) []byte {
	meta := map[string]any{
		"sticker-pack-id":         "com.purulocal.stickers",
		"sticker-pack-name":       pack,
		"sticker-pack-publisher":  author,
		"emojis":                  []string{},
		"android-app-store-link":  "",
		"ios-app-store-link":      "",
	}
	jb, err := json.Marshal(meta)
	if err != nil {
		jb = []byte(`{}`)
	}
	// Minimal EXIF/TIFF wrapper + JSON payload (best-effort untuk WA)
	// TIFF header: II*\0, offset to IFD0 = 8
	header := []byte{'I', 'I', 42, 0, 8, 0, 0, 0}
	// IFD0: 1 entry, tag 0x5741 (custom WA) undefined pointing to JSON, next IFD 0
	// entry: tag(2) type(2) count(4) value/offset(4)
	ifd := make([]byte, 2+12+4)
	binary.LittleEndian.PutUint16(ifd[0:2], 1)
	binary.LittleEndian.PutUint16(ifd[2:4], 0x5741)  // tag
	binary.LittleEndian.PutUint16(ifd[4:6], 0x0007)  // UNDEFINED
	binary.LittleEndian.PutUint32(ifd[6:10], uint32(len(jb)))
	// data offset = header(8)+ifd(18) = 26
	binary.LittleEndian.PutUint32(ifd[10:14], 26)
	binary.LittleEndian.PutUint32(ifd[14:18], 0)
	buf := append(header, ifd...)
	buf = append(buf, jb...)
	return buf
}
