package bot

import (
	"fmt"
	"sort"
	"strings"
	"time"

	botcmd "purulocal-bot/internal/bot/cmd"
)

// BuildMenuText membangun teks menu otomatis dari metadata fitur terdaftar
// dan custom command. Diimplementasikan untuk cmd.BotAPI.
func (m *Manager) BuildMenuText() string {
	cfg := m.Config()
	botName := strings.TrimSpace(cfg.BotName)
	if botName == "" {
		botName = "puruLocal Bot"
	}

	loc, err := time.LoadLocation("Asia/Jakarta")
	if err != nil {
		loc = time.FixedZone("WIB", 7*3600)
	}
	now := time.Now().In(loc)

	ucap := menuUcap(now.Hour())
	week := menuWeekday(now.Weekday())
	weton := menuWeton(now)
	date := menuDateID(now)
	clock := now.Format("15:04:05")
	uptime := menuUptime(time.Since(m.startedAt))

	var b strings.Builder

	// Header ala Elaina-MD
	b.WriteString("Hai,\n")
	b.WriteString(fmt.Sprintf("_%s *Kak!*_\n\n", ucap))
	b.WriteString("┏❏──「 *INFO* 」───⬣\n")
	b.WriteString(fmt.Sprintf("│○ *Bot:* %s\n", botName))
	b.WriteString("│○ *Library:* whatsmeow (Go)\n")
	b.WriteString("│○ *Function:* Assistant\n")
	b.WriteString("┗––––––––––✦\n")
	b.WriteString(" \n")
	b.WriteString(fmt.Sprintf("┌  ◦ Uptime : %s\n", uptime))
	b.WriteString(fmt.Sprintf("│  ◦ Hari : %s %s\n", week, weton))
	b.WriteString(fmt.Sprintf("│  ◦ Waktu : %s\n", clock))
	b.WriteString(fmt.Sprintf("│  ◦ Tanggal : %s\n", date))
	b.WriteString("│  ◦ Version : puruLocal\n")
	b.WriteString("└  ◦ Prefix Used : [ . / ]\n\n")
	b.WriteString("┏❏──「 *NOTE* 」───⬣\n")
	b.WriteString("│○ Jika menemukan bug atau\n")
	b.WriteString("│ ingin request fitur, hubungi\n")
	b.WriteString("│ owner bot.\n")
	b.WriteString("┗––––––––––✦\n\n")

	// Kategori builtin
	catOrder, groups := botcmd.MenuItems()
	for _, cat := range catOrder {
		items := groups[cat]
		if len(items) == 0 {
			continue
		}
		b.WriteString(fmt.Sprintf("*〘 %s 〙*\n", cat))
		b.WriteString("╔══════════════\n")
		for _, f := range items {
			cmd := strings.ToLower(strings.TrimSpace(f.Command))
			label := "." + cmd
			switch cmd {
			case "antilink", "welcome", "goodbye":
				label += " on/off"
			case "setwelcome", "setgoodbye", "tagall", "hidetag":
				label += " <text>"
			case "upsw":
				label += " <text>"
			case "vip":
				label += " <kode>"
			}
			b.WriteString("╟ " + label + "\n")
		}
		b.WriteString("╚════════════════\n\n")
	}

	// Custom commands (aktif) per kategori
	if m.customCmds != nil {
		type ccat struct {
			name  string
			items []string
		}
		catMap := map[string]*ccat{}
		order := []string{}
		for _, c := range m.customCmds.List() {
			if !c.Enabled || strings.TrimSpace(c.Command) == "" {
				continue
			}
			cmdName := strings.ToLower(strings.TrimSpace(c.Command))
			cat := strings.TrimSpace(c.Category)
			if cat == "" {
				cat = "Custom"
			}
			key := strings.ToUpper(cat)
			if _, ok := catMap[key]; !ok {
				order = append(order, key)
				catMap[key] = &ccat{name: cat}
			}
			catMap[key].items = append(catMap[key].items, cmdName)
		}
		sort.Slice(order, func(i, j int) bool {
			ci, cj := strings.ToLower(catMap[order[i]].name), strings.ToLower(catMap[order[j]].name)
			if ci != cj {
				return ci < cj
			}
			return len(catMap[order[i]].items) < len(catMap[order[j]].items)
		})
		for _, key := range order {
			cc := catMap[key]
			sort.Slice(cc.items, func(i, j int) bool { return cc.items[i] < cc.items[j] })
			b.WriteString(fmt.Sprintf("*〘 %s 〙*\n", cc.name))
			b.WriteString("╔══════════════\n")
			for _, cmdName := range cc.items {
				b.WriteString("╟ ." + cmdName + "\n")
			}
			b.WriteString("╚════════════════\n\n")
		}
	}

	b.WriteString(fmt.Sprintf("*%s %s, %s*\n", week, weton, date))
	b.WriteString(fmt.Sprintf("*Waktu Server:* %s WIB", clock))
	return b.String()
}

func menuUcap(hour int) string {
	switch {
	case hour >= 4 && hour < 11:
		return "Selamat Pagi"
	case hour >= 11 && hour < 15:
		return "Selamat Siang"
	case hour >= 15 && hour < 18:
		return "Selamat Sore"
	case hour >= 18:
		return "Selamat Malam"
	default:
		return "Selamat Dini Hari"
	}
}

func menuWeekday(wd time.Weekday) string {
	names := []string{"Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"}
	if int(wd) >= 0 && int(wd) < len(names) {
		return names[wd]
	}
	return ""
}

func menuWeton(t time.Time) string {
	// Formula kompatibel dengan Elaina-MD: ((d*1)+d.getTimezoneOffset())/84600000 % 5
	// getTimezoneOffset() untuk WIB = -420 menit, jadi + (-420*60000)
	ms := t.UnixMilli()
	_, offsetSec := t.Zone()
	offsetMin := offsetSec / 60
	// JS getTimezoneOffset returns UTC-local in minutes; for WIB (+7) it's -420
	jsOffset := -offsetMin
	idx := ((ms + int64(jsOffset)*60000) / 84600000) % 5
	if idx < 0 {
		idx += 5
	}
	wetons := []string{"Pahing", "Pon", "Wage", "Kliwon", "Legi"}
	return wetons[idx]
}

func menuDateID(t time.Time) string {
	months := []string{"", "Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"}
	m := int(t.Month())
	month := ""
	if m >= 1 && m < len(months) {
		month = months[m]
	}
	return fmt.Sprintf("%d %s %d", t.Day(), month, t.Year())
}

func menuUptime(d time.Duration) string {
	if d < 0 {
		d = 0
	}
	totalSec := int(d.Seconds())
	days := totalSec / 86400
	hours := (totalSec % 86400) / 3600
	mins := (totalSec % 3600) / 60
	secs := totalSec % 60
	if days > 0 {
		return fmt.Sprintf("%dd %dh %dm %ds", days, hours, mins, secs)
	}
	if hours > 0 {
		return fmt.Sprintf("%dh %dm %ds", hours, mins, secs)
	}
	if mins > 0 {
		return fmt.Sprintf("%dm %ds", mins, secs)
	}
	return fmt.Sprintf("%ds", secs)
}
