package rpg

import "math"

type fishDef struct {
	ID    string
	Name  string
	RP    int
	MinKg float64
	MaxKg float64
}

// Nilai RP per ikan (server-authoritative, tidak percaya client).
var fishTable = map[string]fishDef{
	"teri":   {ID: "teri", Name: "Ikan Teri", RP: 2, MinKg: 0.20, MaxKg: 0.60},
	"mujair": {ID: "mujair", Name: "Mujair", RP: 5, MinKg: 0.30, MaxKg: 0.90},
	"lele":   {ID: "lele", Name: "Lele", RP: 9, MinKg: 0.50, MaxKg: 1.20},
	"nila":   {ID: "nila", Name: "Nila Merah", RP: 14, MinKg: 0.60, MaxKg: 1.40},
	"gurame": {ID: "gurame", Name: "Gurame", RP: 28, MinKg: 0.80, MaxKg: 1.80},
	"kakap":  {ID: "kakap", Name: "Kakap Putih", RP: 42, MinKg: 1.00, MaxKg: 2.20},
	"arwana": {ID: "arwana", Name: "Arwana Merah", RP: 90, MinKg: 1.20, MaxKg: 3.00},
	"koi":    {ID: "koi", Name: "Koi Emas", RP: 180, MinKg: 1.30, MaxKg: 3.50},
	"sandal": {ID: "sandal", Name: "Sandal Jepit", RP: 1, MinKg: 0.20, MaxKg: 0.50},
}

func xpToNext(level int) int {
	if level < 1 {
		level = 1
	}
	// Meningkat tiap level: 30, 50, 70, 90, ...
	return 20 + level*10
}

func levelFromTotalXP(totalXP int) (level int, xpInLevel int, need int) {
	if totalXP < 0 {
		totalXP = 0
	}
	level = 1
	remaining := totalXP
	for {
		need = xpToNext(level)
		if remaining < need {
			return level, remaining, need
		}
		remaining -= need
		level++
		if level > 9999 {
			return 9999, 0, xpToNext(9999)
		}
	}
}

func xpFromActiveSeconds(sec int) int {
	if sec < 0 {
		return 0
	}
	return sec / 600 // 1 XP per 10 menit
}

func clampInt(v, min, max int) int {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}

func clampFloat(v, min, max float64) float64 {
	return math.Max(min, math.Min(max, v))
}
