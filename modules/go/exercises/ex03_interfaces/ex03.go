// Package ex03interfaces — упражнение по интерфейсам, полиморфизму и type switch.
//
// # Задача
//
// Реализуй геометрические фигуры через интерфейс и напиши обобщённую обработку
// значений произвольного типа через type switch.
//
// ## Часть 1. Интерфейс Shape и реализации
//
// Тип Shape (объявлен ниже) описывает фигуру методами Area() и Perimeter(),
// оба возвращают float64. Реализуй этот интерфейс тремя типами:
//
//   - Rectangle с полями Width, Height (float64).
//   - Circle с полем Radius (float64).
//   - Triangle, заданный длинами трёх сторон A, B, C (float64).
//     Площадь — по формуле Герона.
//
// Договорённости (контракт):
//   - Все размеры считаются неотрицательными; валидацию входных данных
//     делать НЕ нужно — тесты подают корректные значения.
//   - Для Circle используй math.Pi.
//   - Каждая фигура должна удовлетворять интерфейсу Shape. Выбери receiver так,
//     чтобы значения фигур (а не только указатели) можно было класть в []Shape.
//
// Дополнительно реализуй у Rectangle метод String() string, делающий тип
// совместимым с fmt.Stringer. Формат текстового представления выбери сам —
// он проверяется на непустоту и на наличие обоих измерений (через смысл, см. тест).
//
// ## Часть 2. TotalArea
//
// Реализуй функцию TotalArea(shapes []Shape) float64 — сумму площадей всех
// фигур среза. Для пустого (или nil) среза результат — 0.
//
// ## Часть 3. Describe — type switch
//
// Реализуй функцию Describe(v any) string, возвращающую человекочитаемое
// описание значения в зависимости от его ДИНАМИЧЕСКОГО типа. Ветки (используй
// type switch) и точные ожидаемые строки:
//
//	v == nil (nil-интерфейс)   -> "nil"
//	int                        -> "int: <значение>"           напр. "int: 42"
//	string                     -> "string: <значение>"        напр. "string: hi"
//	Shape                      -> "shape area=<площадь>"       площадь форматируется
//	                              как %.2f, напр. "shape area=78.54"
//	всё остальное (default)    -> "unknown: <%T>"              напр. "unknown: bool"
//
// Требования к Describe:
//   - Ветку Shape размести так, чтобы Rectangle/Circle/Triangle (любая фигура)
//     попадали именно в неё, а не в default.
//   - Ветка nil должна срабатывать на нетипизированный nil-интерфейс.
//   - Для default используй глагол форматирования, печатающий имя типа.
//
// Подсказок по реализации в коде нет — пиши сам. Запуск:
//
//	cd modules/go/exercises && go test ./ex03_interfaces/
package ex03interfaces

// Shape — геометрическая фигура. Менять интерфейс не нужно.
type Shape interface {
	Area() float64
	Perimeter() float64
}

// Rectangle — прямоугольник со сторонами Width и Height.
type Rectangle struct {
	Width  float64
	Height float64
}

// Circle — круг радиуса Radius.
type Circle struct {
	Radius float64
}

// Triangle — треугольник, заданный длинами сторон A, B, C.
type Triangle struct {
	A float64
	B float64
	C float64
}

// Area возвращает площадь прямоугольника.
func (r Rectangle) Area() float64 {
	panic("TODO: implement")
}

// Perimeter возвращает периметр прямоугольника.
func (r Rectangle) Perimeter() float64 {
	panic("TODO: implement")
}

// String возвращает текстовое представление прямоугольника (fmt.Stringer).
func (r Rectangle) String() string {
	panic("TODO: implement")
}

// Area возвращает площадь круга.
func (c Circle) Area() float64 {
	panic("TODO: implement")
}

// Perimeter возвращает длину окружности.
func (c Circle) Perimeter() float64 {
	panic("TODO: implement")
}

// Area возвращает площадь треугольника (формула Герона).
func (t Triangle) Area() float64 {
	panic("TODO: implement")
}

// Perimeter возвращает периметр треугольника.
func (t Triangle) Perimeter() float64 {
	panic("TODO: implement")
}

// TotalArea возвращает суммарную площадь всех фигур среза.
func TotalArea(shapes []Shape) float64 {
	panic("TODO: implement")
}

// Describe возвращает описание значения по его динамическому типу (type switch).
func Describe(v any) string {
	panic("TODO: implement")
}
