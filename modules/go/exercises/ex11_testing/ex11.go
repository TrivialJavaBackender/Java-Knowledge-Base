// Package ex11testing — ИНВЕРТИРОВАННОЕ упражнение: код уже написан и корректен,
// тесты пишешь ТЫ.
//
// # Задача
//
// Ниже три полностью реализованные функции с интересными краевыми случаями. Менять
// их НЕ нужно — твоя работа в файле ex11_test.go: покрыть их тестами в идиоматичном
// для Go стиле. Скелет теста уже компилируется и проходит один smoke-кейс; дополни
// его сам по TODO-ориентирам.
//
// Что нужно сделать (см. подробные TODO в ex11_test.go):
//
//  1. Table-driven тесты с подтестами t.Run — для каждой функции срез структур-кейсов
//     и цикл по ним. Покрой краевые случаи (пустой вход, ничьи, невалидный ввод,
//     юникод/руны). Имя кейса — человекочитаемое.
//
//  2. Высокое покрытие. Прогоняй `go test -cover ./ex11_testing/` и добивайся, чтобы
//     были задеты все ветки (особенно ветки ошибок в RomanToInt и логика разрешения
//     ничьей в WordStats). `go tool cover -html` подсветит непокрытое.
//
//  3. Бенчмарк. Добавь хотя бы один Benchmark... (например, BenchmarkWordStats) с
//     циклом по b.N. Не забудь про sink-переменную, чтобы компилятор не выкинул вызов.
//     Запуск: `go test -bench=. -benchmem ./ex11_testing/`.
//
//  4. (Опционально) Fuzz-цель Fuzz... — отличный кандидат IsPalindrome или RomanToInt
//     (валидный разбор → инвариант). Используй f.Add для seed и f.Fuzz для проверки.
//     Запуск: `go test -fuzz=Fuzz -fuzztime=10s ./ex11_testing/`.
//
//  5. (Опционально) Пример-документация Example... с комментарием // Output: — он
//     одновременно тест и godoc-пример.
//
// Только стандартная библиотека. Теория: ../theory/TESTING_GO.md.
package ex11testing

import (
	"errors"
	"sort"
	"strings"
	"unicode"
)

// Stats — результат разбора текста функцией WordStats.
type Stats struct {
	Total      int    // всего слов (с повторами)
	Unique     int    // число различных слов
	MostCommon string // самое частое слово; при равной частоте — наименьшее лексикографически
}

// WordStats разбивает text на слова по пробельным символам, приводит каждое слово к
// нижнему регистру и считает статистику.
//
// Краевые случаи, которые стоит покрыть тестами:
//   - пустой/пробельный вход → Total=0, Unique=0, MostCommon=""
//   - регистр игнорируется: "Go go GO" → одно уникальное слово "go", Total=3
//   - стабильное разрешение ничьей: при равной частоте MostCommon — лексикографически
//     наименьшее слово (детерминированно, не зависит от порядка обхода map)
func WordStats(text string) Stats {
	words := strings.Fields(text) // делит по любым пробельным, отбрасывает пустые
	st := Stats{Total: len(words)}
	if len(words) == 0 {
		return st // Unique=0, MostCommon="" — нулевые значения
	}

	counts := make(map[string]int, len(words))
	for _, w := range words {
		counts[strings.ToLower(w)]++
	}
	st.Unique = len(counts)

	// Ищем максимум частоты со стабильным разрешением ничьей: среди слов с одинаковой
	// (максимальной) частотой берём лексикографически наименьшее. Обход map в Go
	// рандомизирован, поэтому нельзя просто «первое встреченное» — нужен явный
	// разрешитель ничьей, иначе результат был бы недетерминированным.
	best, bestN := "", -1
	for w, n := range counts {
		if n > bestN || (n == bestN && w < best) {
			best, bestN = w, n
		}
	}
	st.MostCommon = best
	return st
}

// IsPalindrome сообщает, является ли s палиндромом, игнорируя регистр и все символы,
// кроме букв и цифр. Корректно работает с многобайтовыми рунами (не байтами).
//
// Краевые случаи для тестов:
//   - пустая строка и строка из одних знаков препинания считаются палиндромом (true)
//   - "A man, a plan, a canal: Panama" → true
//   - регистр игнорируется: "Ololo" → true
//   - юникод: "Аргентина манит негра" (без пробелов/регистра) → true;
//     одиночная многобайтовая руна "ф" → true
func IsPalindrome(s string) bool {
	// Собираем только буквы/цифры в нижнем регистре как срез рун (не байт!), чтобы
	// корректно сравнивать многобайтовые символы.
	runes := make([]rune, 0, len(s))
	for _, r := range s { // range по строке итерирует РУНАМИ, а не байтами
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			runes = append(runes, unicode.ToLower(r))
		}
	}
	for i, j := 0, len(runes)-1; i < j; i, j = i+1, j-1 {
		if runes[i] != runes[j] {
			return false
		}
	}
	return true
}

// ErrInvalidRoman возвращается RomanToInt для синтаксически некорректного ввода.
var ErrInvalidRoman = errors.New("invalid roman numeral")

var romanValue = map[rune]int{
	'I': 1, 'V': 5, 'X': 10, 'L': 50, 'C': 100, 'D': 500, 'M': 1000,
}

// RomanToInt разбирает римское число (заглавные буквы I, V, X, L, C, D, M) в целое
// в диапазоне 1..3999. Применяет субтрактивное правило (IV=4, IX=9, …). Для пустой
// строки, неизвестного символа или входа, не дающего канонического числа, возвращает
// 0 и ErrInvalidRoman.
//
// Краевые случаи для тестов:
//   - "I"=1, "IV"=4, "IX"=9, "LVIII"=58, "MCMXCIV"=1994, "MMMCMXCIX"=3999
//   - "" → ошибка; "A"/"IIX" (неизвестный символ / не каноничное) → ошибка
//   - валидация круговая: разбор должен совпасть с обратным IntToRoman (см. инвариант
//     для возможной Fuzz-цели)
func RomanToInt(s string) (int, error) {
	if s == "" {
		return 0, ErrInvalidRoman
	}
	total := 0
	prev := 0
	for _, r := range s {
		cur, ok := romanValue[r]
		if !ok {
			return 0, ErrInvalidRoman // неизвестный символ
		}
		if prev < cur {
			// субтрактивная пара: ранее прибавленное prev надо было вычесть —
			// корректируем на 2*prev (один раз прибавили, теперь убираем дважды).
			total += cur - 2*prev
		} else {
			total += cur
		}
		prev = cur
	}
	if total < 1 || total > 3999 {
		return 0, ErrInvalidRoman
	}
	// Каноничность: единственная корректная запись числа — та, что даёт IntToRoman.
	// Это отсекает "IIII", "VV", "IIX" и прочие невалидные формы.
	if IntToRoman(total) != s {
		return 0, ErrInvalidRoman
	}
	return total, nil
}

// IntToRoman — обратное преобразование (1..3999) → каноничная римская запись.
// Используется RomanToInt для валидации каноничности и удобен как инвариант для Fuzz.
func IntToRoman(n int) string {
	if n < 1 || n > 3999 {
		return ""
	}
	vals := []int{1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1}
	syms := []string{"M", "CM", "D", "CD", "C", "XC", "L", "XL", "X", "IX", "V", "IV", "I"}
	var b strings.Builder
	for i, v := range vals {
		for n >= v {
			b.WriteString(syms[i])
			n -= v
		}
	}
	return b.String()
}

// sortedKeys — маленький хелпер: отсортированные ключи map (на случай, если в тестах
// или Example понадобится детерминированный порядок). Не обязателен к использованию.
func sortedKeys(m map[string]int) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
