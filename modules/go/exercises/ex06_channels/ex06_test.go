package ex06channels

import (
	"reflect"
	"sort"
	"sync"
	"testing"
	"time"
)

// withTimeout запускает fn в отдельной горутине и проваливает тест, если она не
// завершилась за d. Так мы ловим взаимоблокировку и утечку горутины: если Merge
// или Pipeline зависнут на send/receive в закрытый/нечитаемый канал, тест не
// повиснет навсегда, а упадёт с понятным сообщением.
//
// Внутри fn используем t.Errorf (а не Fatalf): FailNow/Fatal нельзя звать из
// не-тестовой горутины. Errorf помечает тест упавшим корректно из любой горутины.
func withTimeout(t *testing.T, d time.Duration, fn func()) {
	t.Helper()
	done := make(chan struct{})
	go func() {
		defer close(done)
		fn()
	}()
	select {
	case <-done:
	case <-time.After(d):
		t.Fatalf("не уложились в %v — вероятна взаимоблокировка или зависший send/receive", d)
	}
}

// drain полностью вычитывает канал в срез. Если канал не закрыт, drain зависнет —
// поэтому вызывается только под withTimeout.
func drain(ch <-chan int) []int {
	out := []int{}
	for v := range ch {
		out = append(out, v)
	}
	return out
}

// chanFrom строит канал из среза и закрывает его после отправки всех значений.
func chanFrom(vals ...int) <-chan int {
	ch := make(chan int, len(vals))
	for _, v := range vals {
		ch <- v
	}
	close(ch)
	return ch
}

// sorted возвращает отсортированную копию (порядок fan-in недетерминирован).
// Всегда непустой срез — чтобы reflect.DeepEqual с []int{} не путался с nil.
func sorted(in []int) []int {
	out := append([]int{}, in...)
	sort.Ints(out)
	return out
}

func TestMerge(t *testing.T) {
	tests := []struct {
		name string
		ins  [][]int
		want []int
	}{
		{name: "no sources", ins: nil, want: []int{}},
		{name: "single empty source", ins: [][]int{{}}, want: []int{}},
		{name: "single source", ins: [][]int{{1, 2, 3}}, want: []int{1, 2, 3}},
		{name: "two sources", ins: [][]int{{1, 2}, {3, 4}}, want: []int{1, 2, 3, 4}},
		{
			name: "three sources uneven",
			ins:  [][]int{{1}, {2, 3, 4, 5}, {6, 7}},
			want: []int{1, 2, 3, 4, 5, 6, 7},
		},
		{
			name: "some empty some not",
			ins:  [][]int{{}, {10, 20}, {}, {30}},
			want: []int{10, 20, 30},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			withTimeout(t, 2*time.Second, func() {
				chans := make([]<-chan int, 0, len(tt.ins))
				for _, vals := range tt.ins {
					chans = append(chans, chanFrom(vals...))
				}
				got := sorted(drain(Merge(chans...)))
				if !reflect.DeepEqual(got, tt.want) {
					t.Errorf("Merge = %v, want %v", got, tt.want)
				}
			})
		})
	}
}

// TestMergeClosesOutput проверяет, что выходной канал ЗАКРЫВАЕТСЯ после исчерпания
// всех источников (а не просто перестаёт слать). Если бы Merge забыл close, range
// ниже завис бы — и сработал бы таймаут.
func TestMergeClosesOutput(t *testing.T) {
	withTimeout(t, 2*time.Second, func() {
		out := Merge(chanFrom(1, 2), chanFrom(3))
		count := 0
		for range out {
			count++
		}
		if count != 3 {
			t.Errorf("получено %d значений до закрытия, want 3", count)
			return
		}
		// Канал уже закрыт: повторный receive обязан вернуть zero value + ok=false
		// немедленно, без блокировки.
		if v, ok := <-out; ok {
			t.Errorf("после закрытия ok=true (v=%d), ожидалось ok=false", v)
		}
	})
}

// TestMergeConcurrentSources даёт источникам реальную задержку, чтобы они работали
// параллельно. Запуск под -race выявит гонку при склейке в общий канал.
func TestMergeConcurrentSources(t *testing.T) {
	withTimeout(t, 3*time.Second, func() {
		mk := func(base, n int) <-chan int {
			ch := make(chan int)
			go func() {
				defer close(ch)
				for i := 0; i < n; i++ {
					time.Sleep(time.Millisecond)
					ch <- base + i
				}
			}()
			return ch
		}
		want := []int{0, 1, 2, 100, 101, 200, 201, 202}
		got := sorted(drain(Merge(mk(0, 3), mk(100, 2), mk(200, 3))))
		if !reflect.DeepEqual(got, want) {
			t.Errorf("Merge(concurrent) = %v, want %v", got, want)
		}
	})
}

func TestPipeline(t *testing.T) {
	tests := []struct {
		name string
		in   []int
		want []int
	}{
		{name: "empty", in: []int{}, want: []int{}},
		{name: "squares", in: []int{1, 2, 3, 4}, want: []int{1, 4, 9, 16}},
		{name: "with zero and negative", in: []int{-2, 0, 5}, want: []int{4, 0, 25}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			withTimeout(t, 2*time.Second, func() {
				got := drain(Pipeline(chanFrom(tt.in...)))
				// Pipeline сохраняет порядок (одна последовательная цепочка стадий).
				if !reflect.DeepEqual(got, tt.want) {
					t.Errorf("Pipeline = %v, want %v", got, tt.want)
				}
			})
		})
	}
}

// TestPipelineClosesOutput — выходной канал Pipeline должен закрываться после
// закрытия входного.
func TestPipelineClosesOutput(t *testing.T) {
	withTimeout(t, 2*time.Second, func() {
		out := Pipeline(chanFrom(2, 3))
		<-out
		<-out
		if v, ok := <-out; ok {
			t.Errorf("Pipeline не закрыл выход: получили v=%d, ok=true", v)
		}
	})
}

func TestFirstResponse(t *testing.T) {
	withTimeout(t, 2*time.Second, func() {
		slow := func(v string, d time.Duration) <-chan string {
			ch := make(chan string, 1)
			go func() {
				time.Sleep(d)
				ch <- v
			}()
			return ch
		}
		// Самый быстрый источник определяет результат.
		got := FirstResponse(
			slow("slow", 200*time.Millisecond),
			slow("fast", 10*time.Millisecond),
			slow("medium", 80*time.Millisecond),
		)
		if got != "fast" {
			t.Errorf("FirstResponse = %q, want %q", got, "fast")
		}
	})
}

// TestFirstResponseSingle — с единственным источником возвращается его значение.
func TestFirstResponseSingle(t *testing.T) {
	withTimeout(t, 2*time.Second, func() {
		ch := make(chan string, 1)
		ch <- "only"
		if got := FirstResponse(ch); got != "only" {
			t.Errorf("FirstResponse = %q, want %q", got, "only")
		}
	})
}

// TestFirstResponseNoLeakAfterWin — даже если проигравшие источники продолжают
// слать значения, FirstResponse должен вернуться сразу после первого. Источники
// здесь буферизованы, поэтому их горутины не зависнут и тест-процесс не утечёт.
func TestFirstResponseNoLeakAfterWin(t *testing.T) {
	var wg sync.WaitGroup
	mk := func(v string, d time.Duration) <-chan string {
		ch := make(chan string, 1) // буфер 1 — отправитель не залипнет
		wg.Add(1)
		go func() {
			defer wg.Done()
			time.Sleep(d)
			ch <- v
		}()
		return ch
	}
	withTimeout(t, 2*time.Second, func() {
		got := FirstResponse(mk("a", 5*time.Millisecond), mk("b", 150*time.Millisecond))
		if got != "a" {
			t.Errorf("FirstResponse = %q, want %q", got, "a")
		}
	})
	wg.Wait() // убеждаемся, что фоновые отправители завершились, а не повисли
}
