package ex05collections

import (
	"reflect"
	"slices"
	"testing"
)

func TestDedup(t *testing.T) {
	tests := []struct {
		name string
		in   []int
		want []int
	}{
		{name: "mixed duplicates", in: []int{1, 2, 1, 3, 2, 3}, want: []int{1, 2, 3}},
		{name: "all same", in: []int{5, 5, 5}, want: []int{5}},
		{name: "no duplicates", in: []int{4, 3, 2, 1}, want: []int{4, 3, 2, 1}},
		{name: "adjacent dups", in: []int{1, 1, 2, 2, 3, 3}, want: []int{1, 2, 3}},
		{name: "single", in: []int{42}, want: []int{42}},
		{name: "empty", in: []int{}, want: []int{}},
		{name: "nil", in: nil, want: []int{}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := Dedup(tc.in)

			if got == nil {
				t.Fatalf("Dedup(%v) returned nil, want non-nil empty slice", tc.in)
			}
			if !slices.Equal(got, tc.want) {
				t.Errorf("Dedup(%v) = %v, want %v", tc.in, got, tc.want)
			}
		})
	}
}

// TestDedupDoesNotMutateInput ловит реализацию, которая делает append/сортировку
// поверх входного backing-массива и портит данные вызывающей стороны.
func TestDedupDoesNotMutateInput(t *testing.T) {
	in := []int{3, 1, 3, 2, 1}
	backup := slices.Clone(in)

	_ = Dedup(in)

	if !slices.Equal(in, backup) {
		t.Errorf("Dedup изменил входной слайс: было %v, стало %v", backup, in)
	}
}

func TestGroupByParity(t *testing.T) {
	tests := []struct {
		name string
		in   []int
		want map[string][]int
	}{
		{
			name: "mixed",
			in:   []int{1, 2, 3, 4, 5},
			want: map[string][]int{"even": {2, 4}, "odd": {1, 3, 5}},
		},
		{
			name: "only even",
			in:   []int{2, 4, 6},
			want: map[string][]int{"even": {2, 4, 6}, "odd": {}},
		},
		{
			name: "only odd",
			in:   []int{1, 3},
			want: map[string][]int{"even": {}, "odd": {1, 3}},
		},
		{
			name: "zero is even",
			in:   []int{0, -1, -2, -3},
			want: map[string][]int{"even": {0, -2}, "odd": {-1, -3}},
		},
		{
			name: "nil input",
			in:   nil,
			want: map[string][]int{"even": {}, "odd": {}},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := GroupByParity(tc.in)

			if got == nil {
				t.Fatalf("GroupByParity(%v) returned nil map", tc.in)
			}
			// Оба ключа обязаны присутствовать.
			for _, key := range []string{"even", "odd"} {
				if _, ok := got[key]; !ok {
					t.Fatalf("GroupByParity(%v): отсутствует ключ %q", tc.in, key)
				}
				if got[key] == nil {
					t.Errorf("GroupByParity(%v)[%q] == nil, want non-nil слайс", tc.in, key)
				}
			}
			if len(got) != 2 {
				t.Errorf("GroupByParity(%v): %d ключей, want ровно 2", tc.in, len(got))
			}
			for _, key := range []string{"even", "odd"} {
				if !slices.Equal(got[key], tc.want[key]) {
					t.Errorf("GroupByParity(%v)[%q] = %v, want %v", tc.in, key, got[key], tc.want[key])
				}
			}
		})
	}
}

func TestRemoveAt(t *testing.T) {
	t.Run("int middle", func(t *testing.T) {
		got := RemoveAt([]int{10, 20, 30, 40}, 1)
		if !slices.Equal(got, []int{10, 30, 40}) {
			t.Errorf("RemoveAt = %v, want [10 30 40]", got)
		}
	})
	t.Run("first", func(t *testing.T) {
		got := RemoveAt([]int{10, 20, 30}, 0)
		if !slices.Equal(got, []int{20, 30}) {
			t.Errorf("RemoveAt = %v, want [20 30]", got)
		}
	})
	t.Run("last", func(t *testing.T) {
		got := RemoveAt([]int{10, 20, 30}, 2)
		if !slices.Equal(got, []int{10, 20}) {
			t.Errorf("RemoveAt = %v, want [10 20]", got)
		}
	})
	t.Run("strings", func(t *testing.T) {
		got := RemoveAt([]string{"a", "b", "c"}, 1)
		if !slices.Equal(got, []string{"a", "c"}) {
			t.Errorf("RemoveAt = %v, want [a c]", got)
		}
	})
	t.Run("out of range panics", func(t *testing.T) {
		defer func() {
			if recover() == nil {
				t.Errorf("RemoveAt с индексом вне диапазона должен паниковать")
			}
		}()
		_ = RemoveAt([]int{1, 2, 3}, 5)
	})
}

// TestRemoveAtDoesNotMutateInput ловит классический aliasing-баг: наивная реализация
// через append(s[:i], s[i+1:]...) сдвигает хвост ПРЯМО в backing-массиве входного
// слайса. Тогда сам входной слайс s, который ещё держит вызывающая сторона, тихо
// портится (последний элемент дублируется на предпоследнюю позицию). Корректная
// реализация работает на собственной памяти и вход не трогает.
func TestRemoveAtDoesNotMutateInput(t *testing.T) {
	in := []int{10, 20, 30, 40, 50}
	before := slices.Clone(in)

	got := RemoveAt(in, 1) // удаляем '20'
	if !slices.Equal(got, []int{10, 30, 40, 50}) {
		t.Fatalf("RemoveAt(in, 1) = %v, want [10 30 40 50]", got)
	}

	// Входной слайс должен остаться нетронутым (len и все элементы).
	if !slices.Equal(in, before) {
		t.Errorf("RemoveAt изменил входной слайс через общий backing-массив: было %v, стало %v",
			before, in)
	}
}

// TestRemoveAtResultIsIndependent проверяет, что результат не делит backing-массив
// со входом: последующий append в результат не должен «протекать» во вход.
func TestRemoveAtResultIsIndependent(t *testing.T) {
	in := []int{1, 2, 3, 4}
	before := slices.Clone(in)

	got := RemoveAt(in, 0) // [2 3 4]
	got = append(got, 999) // если backing общий — затрёт элемент входа

	if !slices.Equal(in, before) {
		t.Errorf("append в результат RemoveAt испортил вход (общий backing-массив): было %v, стало %v",
			before, in)
	}
}

func TestWordLengths(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want map[string]int
	}{
		{name: "simple", in: "go is fun", want: map[string]int{"go": 2, "is": 2, "fun": 3}},
		{
			name: "extra spaces and tabs",
			in:   "  hello\t\t world \n",
			want: map[string]int{"hello": 5, "world": 5},
		},
		{name: "empty", in: "", want: map[string]int{}},
		{name: "only spaces", in: "   \t\n  ", want: map[string]int{}},
		// Не-ASCII: длина по рунам, а не по байтам.
		// "привет" — 6 рун, но 12 байтов; "мир" — 3 руны, 6 байтов.
		{name: "cyrillic", in: "привет мир", want: map[string]int{"привет": 6, "мир": 3}},
		// "naïve" — 5 рун ('ï' = 2 байта), "café" — 4 руны ('é' = 2 байта).
		{name: "latin diacritics", in: "naïve café", want: map[string]int{"naïve": 5, "café": 4}},
		// Эмодзи занимает 4 байта, но это одна руна.
		{name: "emoji word", in: "hi 🚀", want: map[string]int{"hi": 2, "🚀": 1}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := WordLengths(tc.in)

			if got == nil {
				t.Fatalf("WordLengths(%q) returned nil map", tc.in)
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("WordLengths(%q) = %v, want %v", tc.in, got, tc.want)
			}
		})
	}
}
