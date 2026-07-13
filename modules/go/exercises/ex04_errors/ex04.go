// Package ex04errors — упражнение по ошибкам Go: кастомные типы, оборачивание,
// errors.Is / errors.As.
//
// # Задача
//
// Реализуй валидацию пользователя и парсинг текстовой записи так, чтобы вызывающий
// код мог программно распознавать причину сбоя через стандартные errors.Is / errors.As
// (НЕ сравнивая строки сообщений). Ключевая идея — ошибки как значения и цепочка
// обёрток: внешняя ошибка добавляет контекст, но исходная (sentinel) остаётся
// достижимой по цепочке.
//
// # Что нужно сделать
//
//  1. Sentinel-ошибки (уже объявлены ниже, не меняй их идентификаторы):
//     ErrEmptyName    — имя пустое.
//     ErrNegativeAge  — возраст отрицательный.
//     ErrMalformedRecord — строка записи имеет неверный формат.
//
//  2. Тип ValidationError (поля уже объявлены, не меняй их):
//     - реализуй метод Error() string — человекочитаемое сообщение, включающее
//     имя поля (Field) и текст вложенной ошибки (Err);
//     - реализуй метод Unwrap() error — возвращает Err, чтобы errors.Is / errors.As
//     проходили цепочку до sentinel.
//     Метод-receiver — указатель (*ValidationError): это важно для errors.As.
//
//  3. func ValidateUser(name string, age int) error
//     - имя пустое       → *ValidationError{Field: "name", Err: ErrEmptyName};
//     - возраст < 0       → *ValidationError{Field: "age",  Err: ErrNegativeAge};
//     - оба валидны       → nil.
//     Проверяй имя раньше возраста (при нескольких нарушениях возвращается первое).
//     Sentinel оборачивается в ValidationError так, чтобы errors.Is(err, ErrEmptyName)
//     и errors.As(err, &ve) (ve *ValidationError) оба возвращали true.
//
//  4. func ParseRecord(line string) (Record, error)
//     Формат строки: "name,age" (ровно два поля через запятую), например "Alice,30".
//     - неверное число полей → оберни поясняющий текст вокруг причины через %w;
//     в тестах эта причина — ErrMalformedRecord;
//     - возраст не парсится как целое число → оберни ошибку strconv так, чтобы
//     errors.As(err, &ne) (ne *strconv.NumError) возвращал true (т.е. используй %w);
//     - данные не проходят ValidateUser → верни эту ошибку с добавленным контекстом
//     так, чтобы errors.Is(err, ErrEmptyName) / errors.Is(err, ErrNegativeAge) и
//     errors.As(err, &ve) (ve *ValidationError) продолжали работать сквозь обёртку;
//     - всё хорошо → Record{Name, Age}, nil.
//
// # Подсказок по реализации в коде нет — см. theory/ERRORS_PANIC.md.
//
// Реализация должна жить только в этом файле. Тесты (ex04_test.go) менять не нужно.
package ex04errors

import (
	"errors"
)

// Sentinel-ошибки. НЕ переименовывай и не удаляй.
var (
	ErrEmptyName       = errors.New("name is empty")
	ErrNegativeAge     = errors.New("age is negative")
	ErrMalformedRecord = errors.New("malformed record")
)

// Record — распарсенная запись пользователя.
type Record struct {
	Name string
	Age  int
}

// ValidationError — ошибка валидации одного поля. Оборачивает причину (sentinel)
// в поле Err и сообщает, какое поле невалидно, в поле Field.
// НЕ меняй имена и типы полей.
type ValidationError struct {
	Field string
	Err   error
}

// Error реализует интерфейс error.
func (e *ValidationError) Error() string {
	panic("TODO: implement")
}

// Unwrap возвращает вложенную ошибку для errors.Is / errors.As.
func (e *ValidationError) Unwrap() error {
	panic("TODO: implement")
}

// ValidateUser проверяет имя и возраст, возвращая *ValidationError с обёрнутым
// sentinel при нарушении, либо nil.
func ValidateUser(name string, age int) error {
	panic("TODO: implement")
}

// ParseRecord парсит строку "name,age" в Record, оборачивая ошибки парсинга и
// валидации с контекстом (сохраняя причину через %w).
func ParseRecord(line string) (Record, error) {
	panic("TODO: implement")
}
