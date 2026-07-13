package ex12sync

import (
	"sync"
	"sync/atomic"
	"testing"
)

// --- SafeCache: базовое поведение ---

func TestSafeCacheGetSet(t *testing.T) {
	c := NewSafeCache[string, int]()

	if _, ok := c.Get("missing"); ok {
		t.Fatalf("Get на пустом кэше вернул ok=true, ожидалось false")
	}
	if n := c.Len(); n != 0 {
		t.Fatalf("Len пустого кэша = %d, want 0", n)
	}

	c.Set("a", 1)
	c.Set("b", 2)

	if v, ok := c.Get("a"); !ok || v != 1 {
		t.Fatalf("Get(\"a\") = (%d, %v), want (1, true)", v, ok)
	}
	if v, ok := c.Get("b"); !ok || v != 2 {
		t.Fatalf("Get(\"b\") = (%d, %v), want (2, true)", v, ok)
	}
	if n := c.Len(); n != 2 {
		t.Fatalf("Len = %d, want 2", n)
	}
}

func TestSafeCacheOverwrite(t *testing.T) {
	c := NewSafeCache[string, int]()
	c.Set("k", 1)
	c.Set("k", 99) // перезапись существующего ключа
	if v, ok := c.Get("k"); !ok || v != 99 {
		t.Fatalf("после перезаписи Get(\"k\") = (%d, %v), want (99, true)", v, ok)
	}
	if n := c.Len(); n != 1 {
		t.Fatalf("перезапись не должна увеличивать размер: Len = %d, want 1", n)
	}
}

func TestSafeCacheZeroValueResult(t *testing.T) {
	// Промах должен вернуть именно zero value типа V (здесь "" для string).
	c := NewSafeCache[int, string]()
	if v, ok := c.Get(42); ok || v != "" {
		t.Fatalf("Get промах = (%q, %v), want (\"\", false)", v, ok)
	}
}

// --- SafeCache: конкурентность (проверяется под -race) ---

// TestSafeCacheConcurrentWriters запускает много горутин-писателей: каждая пишет свой
// диапазон ключей. Под -race незащищённый доступ к внутренней map будет пойман.
func TestSafeCacheConcurrentWriters(t *testing.T) {
	const goroutines = 100
	const perG = 50

	c := NewSafeCache[int, int]()
	var wg sync.WaitGroup
	for g := 0; g < goroutines; g++ {
		wg.Add(1)
		go func(base int) {
			defer wg.Done()
			for i := 0; i < perG; i++ {
				key := base*perG + i
				c.Set(key, key*key)
			}
		}(g)
	}
	wg.Wait()

	if n := c.Len(); n != goroutines*perG {
		t.Fatalf("после конкурентных записей Len = %d, want %d", n, goroutines*perG)
	}
	// Все значения должны быть на месте и корректны.
	for k := 0; k < goroutines*perG; k++ {
		if v, ok := c.Get(k); !ok || v != k*k {
			t.Fatalf("Get(%d) = (%d, %v), want (%d, true)", k, v, ok, k*k)
		}
	}
}

// TestSafeCacheConcurrentReadWrite смешивает читателей и писателей по одним и тем же
// ключам. Главная цель — поймать гонку «читатель видит map во время записи».
func TestSafeCacheConcurrentReadWrite(t *testing.T) {
	const writers = 50
	const readers = 50
	const iters = 200

	c := NewSafeCache[int, int]()
	for k := 0; k < 10; k++ {
		c.Set(k, 0) // заранее заполняем общие ключи
	}

	var wg sync.WaitGroup
	for w := 0; w < writers; w++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			for i := 0; i < iters; i++ {
				c.Set(i%10, id+i)
			}
		}(w)
	}
	for r := 0; r < readers; r++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < iters; i++ {
				_, _ = c.Get(i % 10)
				_ = c.Len()
			}
		}()
	}
	wg.Wait()

	// Все 10 общих ключей обязаны присутствовать (значения недетерминированы).
	for k := 0; k < 10; k++ {
		if _, ok := c.Get(k); !ok {
			t.Fatalf("ключ %d пропал после конкурентного доступа", k)
		}
	}
}

// --- Memoize: базовое поведение ---

func TestMemoizeReturnsCorrectValues(t *testing.T) {
	memo := Memoize(func(x int) int { return x * 2 })
	for _, x := range []int{0, 1, 5, -3, 1000} {
		if got := memo(x); got != x*2 {
			t.Fatalf("memo(%d) = %d, want %d", x, got, x*2)
		}
	}
}

// TestMemoizeCachesResult — повторный вызов с тем же аргументом не зовёт fn снова.
func TestMemoizeCachesResult(t *testing.T) {
	var calls int64
	memo := Memoize(func(x int) int {
		atomic.AddInt64(&calls, 1)
		return x + 100
	})

	for i := 0; i < 10; i++ {
		if got := memo(7); got != 107 {
			t.Fatalf("memo(7) = %d, want 107", got)
		}
	}
	if c := atomic.LoadInt64(&calls); c != 1 {
		t.Fatalf("fn вызвана %d раз для одного аргумента, want 1", c)
	}

	// Разные аргументы — каждый считается ровно по разу.
	atomic.StoreInt64(&calls, 0)
	for _, x := range []int{1, 2, 3, 1, 2, 3} {
		_ = memo(x)
	}
	if c := atomic.LoadInt64(&calls); c != 3 {
		t.Fatalf("для 3 уникальных аргументов fn вызвана %d раз, want 3", c)
	}
}

// --- Memoize: конкурентность и single-flight (проверяется под -race) ---

// TestMemoizeSingleFlight — сто горутин одновременно зовут обёртку с ОДНИМ аргументом.
// Базовая fn должна выполниться ровно один раз (single-flight). Барьер startGate
// заставляет горутины стартовать максимально синхронно, обостряя гонку.
func TestMemoizeSingleFlight(t *testing.T) {
	const goroutines = 100

	var calls int64
	memo := Memoize(func(x int) int {
		atomic.AddInt64(&calls, 1)
		// Небольшая «работа», увеличивающая окно гонки без time.Sleep.
		s := 0
		for i := 0; i < 1000; i++ {
			s += i
		}
		return x*x + s - s
	})

	startGate := make(chan struct{})
	results := make([]int, goroutines)
	var wg sync.WaitGroup
	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			<-startGate // ждём общего старта
			results[idx] = memo(9)
		}(i)
	}
	close(startGate) // отпускаем всех одновременно
	wg.Wait()

	if c := atomic.LoadInt64(&calls); c != 1 {
		t.Fatalf("single-flight нарушен: fn вызвана %d раз, want 1", c)
	}
	for idx, got := range results {
		if got != 81 {
			t.Fatalf("горутина %d получила %d, want 81", idx, got)
		}
	}
}

// TestMemoizeConcurrentDistinctArgs — много горутин зовут обёртку с РАЗНЫМИ аргументами
// одновременно. Каждый уникальный аргумент должен посчитаться ровно раз, результаты —
// корректны. Ловит гонки на общем кэше memoize при параллельной записи разных ключей.
func TestMemoizeConcurrentDistinctArgs(t *testing.T) {
	const goroutines = 100
	const repeats = 5 // каждый аргумент зовётся из repeats горутин

	var calls int64
	memo := Memoize(func(x int) int {
		atomic.AddInt64(&calls, 1)
		return x * 3
	})

	var wg sync.WaitGroup
	for r := 0; r < repeats; r++ {
		for arg := 0; arg < goroutines; arg++ {
			wg.Add(1)
			go func(a int) {
				defer wg.Done()
				if got := memo(a); got != a*3 {
					t.Errorf("memo(%d) = %d, want %d", a, got, a*3)
				}
			}(arg)
		}
	}
	wg.Wait()

	if c := atomic.LoadInt64(&calls); c != goroutines {
		t.Fatalf("fn вызвана %d раз для %d уникальных аргументов, want %d",
			c, goroutines, goroutines)
	}
}
