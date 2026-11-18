package cmd

import "strings"

func init() {
	Register(&Feature{
		Meta: Meta{
			ID:         "builtin:vip",
			Name:       "VIP Redeem",
			Command:    "vip",
			Category:   "Utama",
			ShowInMenu: true,
		},
		Run: func(req Request, api BotAPI) (Result, bool) {
			code := strings.ToUpper(strings.TrimSpace(req.Args))
			if len(code) != 4 {
				return Result{Reply: "*VIP*\nGunakan: *.vip* <kode 4 karakter>"}, true
			}
			exp, remain, err := api.RedeemVIP(req.UserKey, code)
			_ = exp
			if err != nil {
				return Result{Reply: "*Gagal Redeem VIP*\n" + err.Error()}, true
			}
			return Result{Reply: "*VIP Aktif*\n*Sisa:* " + formatDurationSec(remain)}, true
		},
	})
}

func formatDurationSec(sec int64) string {
	if sec <= 0 {
		return "0 detik"
	}
	d := sec / 86400
	h := (sec % 86400) / 3600
	m := (sec % 3600) / 60
	s := sec % 60
	out := ""
	if d > 0 {
		out += itoa64(d) + " hari "
	}
	if h > 0 {
		out += itoa64(h) + " jam "
	}
	if m > 0 {
		out += itoa64(m) + " menit "
	}
	if s > 0 && d == 0 {
		out += itoa64(s) + " detik"
	}
	return strings.TrimSpace(out)
}

func itoa64(n int64) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
