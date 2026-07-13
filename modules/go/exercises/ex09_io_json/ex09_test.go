package ex09iojson

import (
	"bytes"
	"encoding/json"
	"io"
	"strings"
	"testing"
)

// --- Часть 1. CountingWriter ---

func TestCountingWriterBasic(t *testing.T) {
	var dst bytes.Buffer
	cw := NewCountingWriter(&dst)
	if cw == nil {
		t.Fatal("NewCountingWriter returned nil")
	}

	n, err := cw.Write([]byte("hello\nworld\n"))
	if err != nil {
		t.Fatalf("Write returned unexpected error: %v", err)
	}
	if n != 12 {
		t.Errorf("Write n = %d, want 12", n)
	}
	// Содержимое должно дойти до вложенного writer без изменений.
	if dst.String() != "hello\nworld\n" {
		t.Errorf("wrapped writer got %q, want %q", dst.String(), "hello\nworld\n")
	}
	if cw.Bytes() != 12 {
		t.Errorf("Bytes() = %d, want 12", cw.Bytes())
	}
	if cw.Lines() != 2 {
		t.Errorf("Lines() = %d, want 2", cw.Lines())
	}
}

func TestCountingWriterAccumulatesAcrossWrites(t *testing.T) {
	var dst bytes.Buffer
	cw := NewCountingWriter(&dst)

	chunks := []string{"a\n", "bb", "\nccc\n", ""}
	for _, ch := range chunks {
		if _, err := cw.Write([]byte(ch)); err != nil {
			t.Fatalf("Write(%q) error: %v", ch, err)
		}
	}
	// Всего байт: 2 + 2 + 5 + 0 = 9; всего '\n': 3.
	if cw.Bytes() != 9 {
		t.Errorf("Bytes() = %d, want 9", cw.Bytes())
	}
	if cw.Lines() != 3 {
		t.Errorf("Lines() = %d, want 3", cw.Lines())
	}
	if dst.String() != "a\nbb\nccc\n" {
		t.Errorf("wrapped writer = %q, want %q", dst.String(), "a\nbb\nccc\n")
	}
}

func TestCountingWriterNoNewlines(t *testing.T) {
	var dst bytes.Buffer
	cw := NewCountingWriter(&dst)
	if _, err := cw.Write([]byte("no newlines here")); err != nil {
		t.Fatalf("Write error: %v", err)
	}
	if cw.Bytes() != 16 {
		t.Errorf("Bytes() = %d, want 16", cw.Bytes())
	}
	if cw.Lines() != 0 {
		t.Errorf("Lines() = %d, want 0", cw.Lines())
	}
}

func TestCountingWriterImplementsWriterInterface(t *testing.T) {
	// Контракт: *CountingWriter должен подходить везде, где ждут io.Writer.
	var dst bytes.Buffer
	var w io.Writer = NewCountingWriter(&dst)
	if _, err := io.WriteString(w, "via io.Writer\n"); err != nil {
		t.Fatalf("io.WriteString error: %v", err)
	}
	if dst.String() != "via io.Writer\n" {
		t.Errorf("wrapped = %q, want %q", dst.String(), "via io.Writer\n")
	}
}

// shortWriter принимает максимум limit байт за всё время, затем возвращает
// io.ErrShortWrite, записав лишь часть переданного среза. Нужен, чтобы проверить
// контракт io.Writer при частичной записи: счётчик байт обязан учитывать ровно
// то, что РЕАЛЬНО ушло во вложенный writer.
type shortWriter struct {
	buf   bytes.Buffer
	limit int
}

func (s *shortWriter) Write(p []byte) (int, error) {
	space := s.limit - s.buf.Len()
	if space <= 0 {
		return 0, io.ErrShortWrite
	}
	if len(p) <= space {
		return s.buf.Write(p)
	}
	n, _ := s.buf.Write(p[:space])
	return n, io.ErrShortWrite
}

func TestCountingWriterPartialWrite(t *testing.T) {
	// Вложенный writer примет только первые 4 байта из "ab\ncd\n" (6 байт).
	sw := &shortWriter{limit: 4}
	cw := NewCountingWriter(sw)

	n, err := cw.Write([]byte("ab\ncd\n"))
	if err == nil {
		t.Fatalf("Write returned nil error, want short-write error")
	}
	if n != 4 {
		t.Errorf("Write n = %d, want 4 (bytes actually accepted)", n)
	}
	// Счётчики обязаны отражать только записанные 4 байта ("ab\nc"): 4 байта, 1 '\n'.
	if cw.Bytes() != 4 {
		t.Errorf("Bytes() = %d, want 4 (only accepted bytes counted)", cw.Bytes())
	}
	if cw.Lines() != 1 {
		t.Errorf("Lines() = %d, want 1 (newlines among accepted bytes)", cw.Lines())
	}
	if sw.buf.String() != "ab\nc" {
		t.Errorf("inner writer = %q, want %q", sw.buf.String(), "ab\nc")
	}
}

// --- Часть 2. DecodeRecords (NDJSON) ---

func TestDecodeRecords(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  []Record
	}{
		{
			name:  "two records",
			input: "{\"id\":1,\"name\":\"Alice\"}\n{\"id\":2,\"name\":\"Bob\"}\n",
			want:  []Record{{ID: 1, Name: "Alice"}, {ID: 2, Name: "Bob"}},
		},
		{
			name:  "single record no trailing newline",
			input: "{\"id\":7,\"name\":\"Carol\"}",
			want:  []Record{{ID: 7, Name: "Carol"}},
		},
		{
			name:  "blank input yields empty slice",
			input: "",
			want:  []Record{},
		},
		{
			name:  "records separated by multiple whitespace",
			input: "{\"id\":1,\"name\":\"A\"}\n\n{\"id\":2,\"name\":\"B\"}\n",
			want:  []Record{{ID: 1, Name: "A"}, {ID: 2, Name: "B"}},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := DecodeRecords(strings.NewReader(tc.input))
			if err != nil {
				t.Fatalf("DecodeRecords returned unexpected error: %v", err)
			}
			if got == nil {
				t.Fatalf("DecodeRecords returned nil slice, want non-nil")
			}
			if len(got) != len(tc.want) {
				t.Fatalf("DecodeRecords len = %d (%+v), want %d (%+v)", len(got), got, len(tc.want), tc.want)
			}
			for i := range tc.want {
				if got[i] != tc.want[i] {
					t.Errorf("record[%d] = %+v, want %+v", i, got[i], tc.want[i])
				}
			}
		})
	}
}

func TestDecodeRecordsMalformed(t *testing.T) {
	// Вторая строка — битый JSON: ожидаем ошибку.
	input := "{\"id\":1,\"name\":\"Alice\"}\n{not json}\n"
	_, err := DecodeRecords(strings.NewReader(input))
	if err == nil {
		t.Fatal("DecodeRecords on malformed input returned nil error, want error")
	}
}

func TestDecodeRecordsStreaming(t *testing.T) {
	// Поток из многих объектов: проверяем, что разбор идёт по одному и не теряет записи.
	var sb strings.Builder
	const n = 1000
	for i := 0; i < n; i++ {
		enc := json.NewEncoder(&sb)
		if err := enc.Encode(Record{ID: i, Name: "x"}); err != nil {
			t.Fatalf("setup encode error: %v", err)
		}
	}
	got, err := DecodeRecords(strings.NewReader(sb.String()))
	if err != nil {
		t.Fatalf("DecodeRecords error: %v", err)
	}
	if len(got) != n {
		t.Fatalf("decoded %d records, want %d", len(got), n)
	}
	if got[0].ID != 0 || got[n-1].ID != n-1 {
		t.Errorf("order/content mismatch: first=%+v last=%+v", got[0], got[n-1])
	}
}

// --- Часть 3. Temperature (кастомный JSON) ---

func TestTemperatureMarshal(t *testing.T) {
	tests := []struct {
		name string
		in   Temperature
		want string
	}{
		{"positive", Temperature(21.5), `"21.5C"`},
		{"zero", Temperature(0), `"0C"`},
		{"negative", Temperature(-3.5), `"-3.5C"`},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			b, err := json.Marshal(tc.in)
			if err != nil {
				t.Fatalf("Marshal error: %v", err)
			}
			if string(b) != tc.want {
				t.Errorf("Marshal = %s, want %s", b, tc.want)
			}
		})
	}
}

func TestTemperatureUnmarshal(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want Temperature
	}{
		{"positive", `"21.5C"`, Temperature(21.5)},
		{"zero", `"0C"`, Temperature(0)},
		{"negative", `"-3.5C"`, Temperature(-3.5)},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var got Temperature
			if err := json.Unmarshal([]byte(tc.in), &got); err != nil {
				t.Fatalf("Unmarshal error: %v", err)
			}
			if got != tc.want {
				t.Errorf("Unmarshal = %v, want %v", float64(got), float64(tc.want))
			}
		})
	}
}

func TestTemperatureUnmarshalInvalid(t *testing.T) {
	invalid := []string{
		`"hotC"`,  // не число перед суффиксом
		`"21.5"`,  // нет суффикса C
		`21.5`,    // не строка, а голое число
		`"21.5F"`, // неверный суффикс
	}
	for _, in := range invalid {
		t.Run(in, func(t *testing.T) {
			var got Temperature
			if err := json.Unmarshal([]byte(in), &got); err == nil {
				t.Errorf("Unmarshal(%s) = nil error, want error", in)
			}
		})
	}
}

func TestTemperatureRoundTrip(t *testing.T) {
	// Сериализация и обратный разбор должны сохранить значение.
	for _, v := range []Temperature{0, 21.5, -3.5, 100, 36.6} {
		b, err := json.Marshal(v)
		if err != nil {
			t.Fatalf("Marshal(%v) error: %v", float64(v), err)
		}
		var back Temperature
		if err := json.Unmarshal(b, &back); err != nil {
			t.Fatalf("Unmarshal(%s) error: %v", b, err)
		}
		if back != v {
			t.Errorf("round-trip: %v -> %s -> %v", float64(v), b, float64(back))
		}
	}
}

// TestTemperatureInStruct проверяет, что кастомные методы работают и для поля
// структуры (json вызывает их через интерфейсы Marshaler/Unmarshaler).
func TestTemperatureInStruct(t *testing.T) {
	type Reading struct {
		Sensor string      `json:"sensor"`
		Temp   Temperature `json:"temp"`
	}
	in := Reading{Sensor: "s1", Temp: Temperature(18.5)}
	b, err := json.Marshal(in)
	if err != nil {
		t.Fatalf("Marshal error: %v", err)
	}
	if !strings.Contains(string(b), `"18.5C"`) {
		t.Errorf("Marshal = %s, want temp as \"18.5C\"", b)
	}
	var out Reading
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatalf("Unmarshal error: %v", err)
	}
	if out != in {
		t.Errorf("round-trip struct: got %+v, want %+v", out, in)
	}
}
