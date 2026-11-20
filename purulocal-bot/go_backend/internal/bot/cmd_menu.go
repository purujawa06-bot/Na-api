package bot

import (
	"sort"
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

	// Custom commands (aktif) per kategori (urut abjad, lalu jumlah item paling sedikit)
	if m.customCmds != nil {
		type ccat struct {
			name  string
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
				catMap[key] = &ccat{name: cat, label: menuSmallCaps(cat)}
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
			b.WriteString("├─ " + cc.label + "\n")
			for _, cmdName := range cc.items {
				b.WriteString("│  • ." + cmdName + "\n")
			}
			b.WriteString("│\n")
		}
	}

	b.WriteString("╰────────────")
	return b.String()
}
