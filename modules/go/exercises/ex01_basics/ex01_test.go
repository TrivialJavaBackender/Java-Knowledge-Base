package ex01basics

import "testing"

func equalMaps(a, b map[string]int) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if b[k] != v {
			return false
		}
	}
	return true
}

func TestWordFrequency(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want map[string]int
	}{
		{"empty", "", map[string]int{}},
		{"only spaces", "   \t\n  ", map[string]int{}},
		{"single word", "hello", map[string]int{"hello": 1}},
		{"repeats and case", "the cat the dog THE bird",
			map[string]int{"the": 3, "cat": 1, "dog": 1, "bird": 1}},
		{"mixed whitespace", "a\tb\nc  a", map[string]int{"a": 2, "b": 1, "c": 1}},
		{"leading and trailing ws", "  go  go  ", map[string]int{"go": 2}},
		{"punctuation is part of word", "a, a, b!", map[string]int{"a,": 2, "b!": 1}},
		{"case folding ascii only", "Go GO gO go", map[string]int{"go": 4}},
		{"cr separators", "x\r\ry", map[string]int{"x": 1, "y": 1}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := WordFrequency(tt.in)
			if got == nil {
				t.Fatalf("WordFrequency(%q) returned nil map, want non-nil", tt.in)
			}
			if !equalMaps(got, tt.want) {
				t.Errorf("WordFrequency(%q) = %v, want %v", tt.in, got, tt.want)
			}
		})
	}
}

func TestMinMaxSum(t *testing.T) {
	tests := []struct {
		name             string
		in               []int
		wantMin, wantMax int
		wantSum          int
		wantErr          bool
	}{
		{"basic", []int{3, 1, 4, 1, 5}, 1, 5, 14, false},
		{"single", []int{-7}, -7, -7, -7, false},
		{"negatives", []int{-3, -1, -2}, -3, -1, -6, false},
		{"mixed sign", []int{-10, 0, 10}, -10, 10, 0, false},
		{"all equal", []int{4, 4, 4}, 4, 4, 12, false},
		{"two elems", []int{2, 9}, 2, 9, 11, false},
		{"empty", []int{}, 0, 0, 0, true},
		{"nil", nil, 0, 0, 0, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			min, max, sum, err := MinMaxSum(tt.in)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("MinMaxSum(%v): expected error, got nil", tt.in)
				}
				return
			}
			if err != nil {
				t.Fatalf("MinMaxSum(%v): unexpected error %v", tt.in, err)
			}
			if min != tt.wantMin || max != tt.wantMax || sum != tt.wantSum {
				t.Errorf("MinMaxSum(%v) = (min=%d, max=%d, sum=%d), want (min=%d, max=%d, sum=%d)",
					tt.in, min, max, sum, tt.wantMin, tt.wantMax, tt.wantSum)
			}
		})
	}
}

func TestParseIntStrict(t *testing.T) {
	tests := []struct {
		name    string
		in      string
		want    int
		wantErr bool
	}{
		{"plain", "42", 42, false},
		{"zero", "0", 0, false},
		{"negative", "-123", -123, false},
		{"explicit plus", "+7", 7, false},
		{"leading zeros", "007", 7, false},
		{"negative zero", "-0", 0, false},
		{"plus zero", "+0", 0, false},
		{"large within range", "1000000", 1000000, false},
		{"empty", "", 0, true},
		{"only plus", "+", 0, true},
		{"only minus", "-", 0, true},
		{"trailing letter", "12a", 0, true},
		{"leading space", " 5", 0, true},
		{"inner space", "- 5", 0, true},
		{"float", "3.14", 0, true},
		{"double sign", "--5", 0, true},
		{"sign in middle", "1-2", 0, true},
		{"thousands separator", "1_000", 0, true},
		{"letters", "abc", 0, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseIntStrict(tt.in)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("ParseIntStrict(%q): expected error, got nil (value %d)", tt.in, got)
				}
				if got != 0 {
					t.Errorf("ParseIntStrict(%q): on error want value 0, got %d", tt.in, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("ParseIntStrict(%q): unexpected error %v", tt.in, err)
			}
			if got != tt.want {
				t.Errorf("ParseIntStrict(%q) = %d, want %d", tt.in, got, tt.want)
			}
		})
	}
}
