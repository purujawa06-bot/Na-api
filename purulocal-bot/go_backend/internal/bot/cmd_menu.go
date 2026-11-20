package bot

import (
	"strings"

	botcmd "purulocal-bot/internal/bot/cmd"
)

// BuildMenuText membangun teks menu otomatis dari metadata fitur terdaftar
// dan custom command. Diimplementasikan untuk cmd.BotAPI.
func (m *Manager) BuildMenuText() string {
	cfg := m.Config()
	botName := strings.TrimSpace(cfg.BotName)
	if botName == "" {
		botName = "PuruBot"
	}
	var b strings.Builder
	b.WriteString("╭─〔 " + botName + " 〕\n")
	b.WriteString("│\n")

	// Fitur builtin dari registry, dikelompokkan per kategori (urut registrasi/kemunculan)
	catOrder, groups := botcmd.MenuItems()
	for _, cat := range catOrder {
		items := groups[cat]
		if len(items) == 0 {
			continue
		}
		b.WriteString("├─ " + menuSmallCaps(cat) + "\n")
		for _, f := range items {
			// tampilkan command utama saja (alias tidak ditampilkan terpisah)
			label := "│  • ." + strings.ToLower(strings.TrimSpace(f.Command))
			// untuk command grup on/off atau set teks, tampilkan hint penggunaan ringkas
			switch strings.ToLower(f.Command) {
			case "antilink", "welcome", "goodbye":
				label += " on/off"
			case "setwelcome", "setgoodbye", "tagall", "hidetag":
				label += " <text>"
			case "upsw":
				label += " <text>"
			case "vip":
				label += " <kode>"
			}
			b.WriteString(label + "\n")
		}
		b.WriteString("│\n")
	}

	// Custom commands (aktif) per kategori
	if m.customCmds != nil {
		type ccat struct {
			label string
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
				catMap[key] = &ccat{label: menuSmallCaps(cat)}
			}
			catMap[key].items = append(catMap[key].items, "│  • ."+cmdName)
		}
		for _, key := range order {
			cc := catMap[key]
			b.WriteString("├─ " + cc.label + "\n")
			for _, line := range cc.items {
				b.WriteString(line + "\n")
			}
			b.WriteString("│\n")
		}
	}

	b.WriteString("╰────────────")
	return b.String()
}
