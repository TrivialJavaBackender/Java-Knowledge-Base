package ex07workerpool

import (
	"context"
	"errors"
	"runtime"
	"sync/atomic"
	"testing"
	"time"
)

// makeJobs создаёт n заданий с возрастающими ID.
func makeJobs(n int) []Job {
	jobs := make([]Job, n)
	for i := range jobs {
		jobs[i] = Job{ID: i}
	}
	return jobs
}

// doubler — детерминированная функция обработки: Result.Value = Job.ID * 2.
func doubler(_ context.Context, j Job) (Result, error) {
	return Result{JobID: j.ID, Value: j.ID * 2}, nil
}

func TestProcessAllSuccess(t *testing.T) {
	const n = 50
	results, err := ProcessAll(context.Background(), makeJobs(n), 4, doubler)
	if err != nil {
		t.Fatalf("ProcessAll вернул ошибку: %v", err)
	}
	if len(results) != n {
		t.Fatalf("len(results) = %d, want %d", len(results), n)
	}

	// Порядок результатов не гарантирован — проверяем как множество по JobID.
	got := make(map[int]int, n)
	for _, r := range results {
		got[r.JobID] = r.Value
	}
	if len(got) != n {
		t.Fatalf("различных JobID = %d, want %d (дубликаты или пропуски)", len(got), n)
	}
	for i := 0; i < n; i++ {
		if v, ok := got[i]; !ok || v != i*2 {
			t.Errorf("для JobID=%d получили (%d, ok=%v), want %d", i, v, ok, i*2)
		}
	}
}

func TestProcessAllEmpty(t *testing.T) {
	results, err := ProcessAll(context.Background(), nil, 4, doubler)
	if err != nil {
		t.Fatalf("ProcessAll(nil) вернул ошибку: %v", err)
	}
	if len(results) != 0 {
		t.Fatalf("len(results) = %d, want 0", len(results))
	}
}

// TestProcessAllConcurrency проверяет, что одновременно работает НЕ больше
// workers воркеров (ограничение параллелизма соблюдается).
func TestProcessAllConcurrency(t *testing.T) {
	const workers = 3
	const n = 30

	var inFlight int32 // текущее число одновременно работающих
	var maxSeen int32  // максимум одновременно работающих

	fn := func(_ context.Context, j Job) (Result, error) {
		cur := atomic.AddInt32(&inFlight, 1)
		for {
			old := atomic.LoadInt32(&maxSeen)
			if cur <= old || atomic.CompareAndSwapInt32(&maxSeen, old, cur) {
				break
			}
		}
		time.Sleep(5 * time.Millisecond) // удерживаем слот, чтобы пересечься во времени
		atomic.AddInt32(&inFlight, -1)
		return Result{JobID: j.ID, Value: j.ID}, nil
	}

	if _, err := ProcessAll(context.Background(), makeJobs(n), workers, fn); err != nil {
		t.Fatalf("ProcessAll вернул ошибку: %v", err)
	}
	if got := atomic.LoadInt32(&maxSeen); got > workers {
		t.Errorf("максимум одновременно работающих = %d, не должно превышать workers = %d", got, workers)
	}
}

// TestProcessAllError проверяет, что ошибка одного задания возвращается наружу.
func TestProcessAllError(t *testing.T) {
	sentinel := errors.New("boom")
	const failID = 7

	fn := func(_ context.Context, j Job) (Result, error) {
		if j.ID == failID {
			return Result{}, sentinel
		}
		return Result{JobID: j.ID, Value: j.ID}, nil
	}

	_, err := ProcessAll(context.Background(), makeJobs(40), 4, fn)
	if err == nil {
		t.Fatalf("ProcessAll должен был вернуть ошибку, получили nil")
	}
	if !errors.Is(err, sentinel) {
		t.Errorf("errors.Is(err, sentinel) = false, want true (err = %v)", err)
	}
}

// TestProcessAllCancel проверяет, что отмена контекста (через таймаут)
// останавливает обработку и ProcessAll возвращает ошибку контекста.
func TestProcessAllCancel(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()

	// Каждое задание дольше таймаута — без отмены тест тянулся бы секундами.
	fn := func(ctx context.Context, j Job) (Result, error) {
		select {
		case <-ctx.Done():
			return Result{}, ctx.Err()
		case <-time.After(500 * time.Millisecond):
			return Result{JobID: j.ID, Value: j.ID}, nil
		}
	}

	start := time.Now()
	_, err := ProcessAll(ctx, makeJobs(100), 4, fn)
	elapsed := time.Since(start)

	if err == nil {
		t.Fatalf("ProcessAll должен был вернуть ошибку при отмене, получили nil")
	}
	if !errors.Is(err, context.DeadlineExceeded) && !errors.Is(err, context.Canceled) {
		t.Errorf("ожидали ошибку контекста, получили: %v", err)
	}
	// Должны выйти примерно по таймауту, а не дожидаться всех 100 заданий.
	if elapsed > 300*time.Millisecond {
		t.Errorf("ProcessAll не остановился вовремя: elapsed = %v", elapsed)
	}
}

// TestProcessAllCancelMidway отменяет контекст вручную во время работы.
func TestProcessAllCancelMidway(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())

	var done int32
	fn := func(ctx context.Context, j Job) (Result, error) {
		// Отменяем после того, как несколько заданий уже запустилось.
		if atomic.AddInt32(&done, 1) == 5 {
			cancel()
		}
		select {
		case <-ctx.Done():
			return Result{}, ctx.Err()
		case <-time.After(20 * time.Millisecond):
			return Result{JobID: j.ID, Value: j.ID}, nil
		}
	}

	_, err := ProcessAll(ctx, makeJobs(200), 4, fn)
	cancel() // на случай, если порог не достигнут (idempotent)
	if err == nil {
		t.Fatalf("ProcessAll должен был вернуть ошибку при ручной отмене")
	}
	if !errors.Is(err, context.Canceled) {
		t.Errorf("ожидали context.Canceled, получили: %v", err)
	}
}

// TestProcessAllNoGoroutineLeak проверяет отсутствие утечки горутин:
// число горутин после возврата должно вернуться к базовому уровню.
func TestProcessAllNoGoroutineLeak(t *testing.T) {
	runtime.GC()
	settle()
	before := runtime.NumGoroutine()

	// Прогон с успехом.
	if _, err := ProcessAll(context.Background(), makeJobs(100), 8, doubler); err != nil {
		t.Fatalf("успешный прогон вернул ошибку: %v", err)
	}

	// Прогон с ошибкой (ранний выход не должен оставлять висящих горутин).
	sentinel := errors.New("x")
	failing := func(_ context.Context, j Job) (Result, error) {
		if j.ID == 3 {
			return Result{}, sentinel
		}
		time.Sleep(time.Millisecond)
		return Result{JobID: j.ID, Value: j.ID}, nil
	}
	_, _ = ProcessAll(context.Background(), makeJobs(100), 8, failing)

	// Прогон с отменой по таймауту.
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	slow := func(ctx context.Context, j Job) (Result, error) {
		select {
		case <-ctx.Done():
			return Result{}, ctx.Err()
		case <-time.After(time.Second):
			return Result{JobID: j.ID, Value: j.ID}, nil
		}
	}
	_, _ = ProcessAll(ctx, makeJobs(100), 8, slow)
	cancel()

	settle()
	after := runtime.NumGoroutine()

	// Небольшой допуск на фоновые системные горутины планировщика.
	if after > before+2 {
		t.Errorf("утечка горутин: было %d, стало %d (после трёх прогонов)", before, after)
	}
}

// settle даёт планировщику завершить горутины, помеченные на выход.
func settle() {
	for i := 0; i < 50; i++ {
		runtime.Gosched()
		time.Sleep(2 * time.Millisecond)
	}
}
