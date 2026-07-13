package ex08generics

import (
	"slices"
	"strconv"
	"testing"
)

func TestMap(t *testing.T) {
	t.Run("int to int doubling", func(t *testing.T) {
		got := Map([]int{1, 2, 3}, func(x int) int { return x * 2 })
		want := []int{2, 4, 6}
		if !slices.Equal(got, want) {
			t.Errorf("Map = %v, want %v", got, want)
		}
	})

	t.Run("int to string", func(t *testing.T) {
		got := Map([]int{1, 2, 3}, strconv.Itoa)
		want := []string{"1", "2", "3"}
		if !slices.Equal(got, want) {
			t.Errorf("Map = %v, want %v", got, want)
		}
	})

	t.Run("empty input yields non-nil empty", func(t *testing.T) {
		got := Map([]int{}, func(x int) int { return x })
		if got == nil {
			t.Fatalf("Map of empty returned nil, want non-nil empty slice")
		}
		if len(got) != 0 {
			t.Errorf("Map of empty len = %d, want 0", len(got))
		}
	})

	t.Run("nil input yields non-nil empty", func(t *testing.T) {
		var in []int
		got := Map(in, func(x int) int { return x })
		if got == nil {
			t.Fatalf("Map of nil returned nil, want non-nil empty slice")
		}
		if len(got) != 0 {
			t.Errorf("Map of nil len = %d, want 0", len(got))
		}
	})

	t.Run("does not mutate input", func(t *testing.T) {
		in := []int{1, 2, 3}
		_ = Map(in, func(x int) int { return x + 100 })
		if !slices.Equal(in, []int{1, 2, 3}) {
			t.Errorf("Map mutated input: %v", in)
		}
	})
}

func TestFilter(t *testing.T) {
	tests := []struct {
		name string
		in   []int
		pred func(int) bool
		want []int
	}{
		{"evens", []int{1, 2, 3, 4, 5, 6}, func(x int) bool { return x%2 == 0 }, []int{2, 4, 6}},
		{"none match", []int{1, 3, 5}, func(x int) bool { return x%2 == 0 }, []int{}},
		{"all match", []int{2, 4}, func(x int) bool { return x%2 == 0 }, []int{2, 4}},
		{"empty input", []int{}, func(x int) bool { return true }, []int{}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := Filter(tc.in, tc.pred)
			if got == nil {
				t.Fatalf("Filter returned nil, want non-nil slice")
			}
			if !slices.Equal(got, tc.want) {
				t.Errorf("Filter = %v, want %v", got, tc.want)
			}
		})
	}

	t.Run("nil input yields non-nil empty", func(t *testing.T) {
		var in []string
		got := Filter(in, func(s string) bool { return true })
		if got == nil || len(got) != 0 {
			t.Errorf("Filter of nil = %v, want non-nil empty", got)
		}
	})

	t.Run("does not mutate input", func(t *testing.T) {
		in := []int{1, 2, 3, 4}
		_ = Filter(in, func(x int) bool { return x > 2 })
		if !slices.Equal(in, []int{1, 2, 3, 4}) {
			t.Errorf("Filter mutated input: %v", in)
		}
	})
}

func TestReduce(t *testing.T) {
	t.Run("sum of ints", func(t *testing.T) {
		got := Reduce([]int{1, 2, 3, 4}, 0, func(acc, x int) int { return acc + x })
		if got != 10 {
			t.Errorf("Reduce sum = %d, want 10", got)
		}
	})

	t.Run("concatenation into string", func(t *testing.T) {
		got := Reduce([]int{1, 2, 3}, "", func(acc string, x int) string {
			return acc + strconv.Itoa(x)
		})
		if got != "123" {
			t.Errorf("Reduce concat = %q, want %q", got, "123")
		}
	})

	t.Run("left fold order matters (subtraction)", func(t *testing.T) {
		// ((((100-1)-2)-3) = 94 — проверяет, что свёртка идёт слева направо.
		got := Reduce([]int{1, 2, 3}, 100, func(acc, x int) int { return acc - x })
		if got != 94 {
			t.Errorf("Reduce sub = %d, want 94", got)
		}
	})

	t.Run("empty returns init unchanged", func(t *testing.T) {
		got := Reduce([]int{}, 42, func(acc, x int) int { return acc + x })
		if got != 42 {
			t.Errorf("Reduce empty = %d, want 42", got)
		}
	})

	t.Run("nil returns init unchanged", func(t *testing.T) {
		var in []int
		got := Reduce(in, 7, func(acc, x int) int { return acc + x })
		if got != 7 {
			t.Errorf("Reduce nil = %d, want 7", got)
		}
	})
}

func TestSet(t *testing.T) {
	t.Run("add contains len with duplicates", func(t *testing.T) {
		s := NewSet[int]()
		if s == nil {
			t.Fatal("NewSet returned nil")
		}
		s.Add(1)
		s.Add(2)
		s.Add(2) // дубликат
		s.Add(3)

		if s.Len() != 3 {
			t.Errorf("Len = %d, want 3", s.Len())
		}
		for _, v := range []int{1, 2, 3} {
			if !s.Contains(v) {
				t.Errorf("Contains(%d) = false, want true", v)
			}
		}
		if s.Contains(99) {
			t.Errorf("Contains(99) = true, want false")
		}
	})

	t.Run("empty set", func(t *testing.T) {
		s := NewSet[string]()
		if s.Len() != 0 {
			t.Errorf("empty Len = %d, want 0", s.Len())
		}
		if s.Contains("x") {
			t.Errorf("empty Contains = true, want false")
		}
		items := s.Items()
		if items == nil {
			t.Fatal("Items of empty set returned nil, want non-nil empty")
		}
		if len(items) != 0 {
			t.Errorf("Items of empty len = %d, want 0", len(items))
		}
	})

	t.Run("items returns all unique elements", func(t *testing.T) {
		s := NewSet[int]()
		for _, v := range []int{3, 1, 2, 3, 1} {
			s.Add(v)
		}
		got := s.Items()
		slices.Sort(got) // порядок не специфицирован — сортируем для детерминизма
		want := []int{1, 2, 3}
		if !slices.Equal(got, want) {
			t.Errorf("Items (sorted) = %v, want %v", got, want)
		}
	})

	t.Run("works with string elements", func(t *testing.T) {
		s := NewSet[string]()
		s.Add("a")
		s.Add("b")
		s.Add("a")
		if s.Len() != 2 {
			t.Errorf("Len = %d, want 2", s.Len())
		}
		got := s.Items()
		slices.Sort(got)
		if !slices.Equal(got, []string{"a", "b"}) {
			t.Errorf("Items (sorted) = %v, want [a b]", got)
		}
	})
}

func TestMaxInts(t *testing.T) {
	tests := []struct {
		name string
		in   []int
		want int
	}{
		{"ascending", []int{1, 2, 3}, 3},
		{"descending", []int{3, 2, 1}, 3},
		{"max in middle", []int{1, 9, 2}, 9},
		{"single", []int{42}, 42},
		{"negatives", []int{-5, -1, -10}, -1},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := Max(tc.in)
			if err != nil {
				t.Fatalf("Max returned unexpected error: %v", err)
			}
			if got != tc.want {
				t.Errorf("Max = %d, want %d", got, tc.want)
			}
		})
	}
}

func TestMaxStrings(t *testing.T) {
	got, err := Max([]string{"apple", "pear", "banana"})
	if err != nil {
		t.Fatalf("Max returned unexpected error: %v", err)
	}
	if got != "pear" {
		t.Errorf("Max = %q, want %q", got, "pear")
	}
}

func TestMaxFloats(t *testing.T) {
	got, err := Max([]float64{1.5, 2.25, 0.75})
	if err != nil {
		t.Fatalf("Max returned unexpected error: %v", err)
	}
	if got != 2.25 {
		t.Errorf("Max = %v, want 2.25", got)
	}
}

func TestMaxEmpty(t *testing.T) {
	got, err := Max([]int{})
	if err == nil {
		t.Errorf("Max of empty returned nil error, want non-nil error")
	}
	if got != 0 {
		t.Errorf("Max of empty value = %d, want zero value 0", got)
	}

	var nilSlice []string
	gotS, errS := Max(nilSlice)
	if errS == nil {
		t.Errorf("Max of nil returned nil error, want non-nil error")
	}
	if gotS != "" {
		t.Errorf("Max of nil value = %q, want zero value \"\"", gotS)
	}
}
