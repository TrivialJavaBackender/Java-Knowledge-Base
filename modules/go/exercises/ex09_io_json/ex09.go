// Package ex09iojson — упражнение по io и encoding/json: обёртка над io.Writer,
// потоковый разбор NDJSON через json.Decoder и кастомные MarshalJSON/UnmarshalJSON.
//
// # Задача
//
// Три независимых части. Все объявления (типы, поля, сигнатуры) уже даны ниже —
// менять их НЕ нужно, реализуй только тела. Подсказок по реализации в коде нет.
//
// ## Часть 1. CountingWriter (контракт io.Writer)
//
// Тип CountingWriter оборачивает другой io.Writer и попутно ведёт учёт того, что
// через него прошло, не мешая основному потоку записи (паттерн «декоратор»).
//
//   - NewCountingWriter(w io.Writer) *CountingWriter
//     Создаёт обёртку над w.
//
//   - (*CountingWriter) Write(p []byte) (int, error)
//     Реализует io.Writer: пишет p в обёрнутый writer и обновляет счётчики.
//     Должен соблюдать контракт io.Writer. Вернуть число РЕАЛЬНО записанных во
//     вложенный writer байт и его ошибку. Bytes() увеличивается ровно на число
//     записанных байт (даже при частичной записи с ошибкой). Lines() увеличивается
//     на число байт '\n' среди ЗАПИСАННЫХ байт. Не «теряй» и не «выдумывай» байты:
//     счётчики обязаны сходиться с тем, что фактически ушло во вложенный writer.
//
//   - (*CountingWriter) Bytes() int — сколько всего байт записано.
//
//   - (*CountingWriter) Lines() int — сколько всего символов перевода строки записано.
//
// ## Часть 2. DecodeRecords (потоковый NDJSON)
//
//   - DecodeRecords(r io.Reader) ([]Record, error)
//     Вход — поток в формате NDJSON: по одному JSON-объекту Record на строку
//     (например, строка {"id":1,"name":"Alice"}, затем {"id":2,"name":"Bob"}).
//     Читай ПОТОКОВО через json.Decoder (по объекту за Decode), не загружая весь
//     вход в память и не разбивая строки вручную. Верни срез всех разобранных
//     записей в порядке появления. Пустой вход (0 объектов) даёт НЕ-nil пустой
//     срез ([]Record{}) и nil-ошибку. Первый же некорректный объект — останови
//     разбор и верни ошибку (уже накопленные записи возвращать не обязательно).
//     Конец потока — это нормальное завершение, а не ошибка.
//
// ## Часть 3. Temperature (кастомный JSON)
//
// Тип Temperature хранит температуру как число (float64), но в JSON должен
// выглядеть как СТРОКА с суффиксом "C": значение 21.5 ⇄ "21.5C".
//
//   - (Temperature) MarshalJSON() ([]byte, error)
//     Сериализует в JSON-строку вида "<число>C". Число форматируй так, чтобы
//     round-trip сохранял значение (см. тесты: 21.5 → "21.5C", 0 → "0C",
//     -3.5 → "-3.5C"). Результат — корректный JSON (строка в кавычках).
//
//   - (*Temperature) UnmarshalJSON(b []byte) error
//     Принимает JSON-строку вида "<число>C", отрезает суффикс "C", парсит число
//     и записывает его в получатель. Получатель — указатель (это важно: метод
//     должен изменить значение). На вход, который не является JSON-строкой или
//     не оканчивается на "C" / не парсится как число, верни ошибку.
//
// # Подсказок по реализации в коде нет — см. theory/STDLIB_CORE.md.
//
// Реализация должна жить только в этом файле. Тесты (ex09_test.go) менять не нужно.
//
// Запуск:
//
//	cd modules/go/exercises && go test ./ex09_io_json/
package ex09iojson

import (
	"io"
)

// CountingWriter — декоратор над io.Writer, считающий записанные байты и строки.
// НЕ меняй имена и типы полей.
type CountingWriter struct {
	w     io.Writer
	bytes int
	lines int
}

// NewCountingWriter оборачивает w.
func NewCountingWriter(w io.Writer) *CountingWriter {
	panic("TODO: implement")
}

// Write пишет p во вложенный writer и обновляет счётчики байт и строк.
func (c *CountingWriter) Write(p []byte) (int, error) {
	panic("TODO: implement")
}

// Bytes возвращает суммарное число записанных байт.
func (c *CountingWriter) Bytes() int {
	panic("TODO: implement")
}

// Lines возвращает суммарное число записанных символов перевода строки.
func (c *CountingWriter) Lines() int {
	panic("TODO: implement")
}

// Record — одна запись потока NDJSON.
// НЕ меняй имена и типы полей и теги.
type Record struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

// DecodeRecords потоково разбирает NDJSON из r в срез Record.
func DecodeRecords(r io.Reader) ([]Record, error) {
	panic("TODO: implement")
}

// Temperature хранит температуру в градусах; в JSON — строка с суффиксом "C".
type Temperature float64

// MarshalJSON сериализует температуру как JSON-строку "<число>C".
func (t Temperature) MarshalJSON() ([]byte, error) {
	panic("TODO: implement")
}

// UnmarshalJSON разбирает JSON-строку "<число>C" обратно в Temperature.
func (t *Temperature) UnmarshalJSON(b []byte) error {
	panic("TODO: implement")
}
