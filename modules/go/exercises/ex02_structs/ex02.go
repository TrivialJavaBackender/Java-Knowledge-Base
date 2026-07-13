// Package ex02structs — упражнение по теме «Типы, структуры, методы».
//
// Цель — на практике прочувствовать разницу между value receiver и pointer
// receiver, а также продвижение методов через встраивание (embedding).
// Реализуй типы и методы строго по контракту ниже. Тесты в ex02_test.go
// менять не нужно — твоя задача сделать их зелёными.
//
// # Тип Money — деньги в минорных единицах (центах)
//
// Money хранит сумму как целое число минорных единиц (поле Cents) и код
// валюты (поле Currency, например "USD", "EUR"). Хранение во float запрещено —
// деньги считаются в центах, целыми.
//
// Все методы Money — с VALUE receiver: Money считается неизменяемым значением.
// Метод НЕ должен мутировать получателя; арифметика возвращает НОВОЕ значение.
//
//	(m Money) Add(other Money) (Money, error)
//	    Возвращает новую Money — сумму m и other.
//	    Если валюты не совпадают — возвращает нулевую Money и ошибку
//	    ErrCurrencyMismatch. Сам получатель m остаётся неизменным.
//
//	(m Money) Sub(other Money) (Money, error)
//	    Возвращает новую Money — разность (m минус other).
//	    Если валюты не совпадают — нулевая Money и ErrCurrencyMismatch.
//	    Результат может быть отрицательным (это допустимо для Money).
//
//	(m Money) IsZero() bool
//	    true, если Cents == 0 (валюта не учитывается).
//
//	(m Money) String() string
//	    Каноничное представление "<целые>.<две цифры> <валюта>".
//	    Примеры: Money{1234,"USD"}      -> "12.34 USD"
//	             Money{5,"USD"}         -> "0.05 USD"
//	             Money{-1234,"EUR"}     -> "-12.34 EUR"
//	             Money{-5,"EUR"}        -> "-0.05 EUR"
//	             Money{0,"USD"}         -> "0.00 USD"
//	    Дробная часть всегда из двух цифр; знак "-" ставится перед целой частью.
//
// # Тип Ledger — учёт баланса по одной валюте
//
// Ledger хранит текущий баланс (поле Balance типа Money). Его методы МУТИРУЮТ
// баланс, поэтому все они — с POINTER receiver.
//
//	(l *Ledger) Deposit(amount Money) error
//	    Прибавляет amount к балансу.
//	    Если валюта amount не совпадает с валютой баланса — ErrCurrencyMismatch,
//	    баланс при этом НЕ меняется.
//	    Особый случай: если баланс нулевой (Balance.Cents == 0) и валюта баланса
//	    пустая (""), Deposit принимает валюту amount (инициализирует счёт).
//
//	(l *Ledger) Withdraw(amount Money) error
//	    Вычитает amount из баланса.
//	    Если валюта не совпадает — ErrCurrencyMismatch, баланс не меняется.
//	    Если средств недостаточно (amount.Cents > Balance.Cents) — возвращает
//	    ErrInsufficientFunds, баланс НЕ меняется. Уходить в минус нельзя.
//
//	(l *Ledger) Current() Money
//	    Возвращает текущий баланс (копию).
//
// # Тип Account — счёт клиента (демонстрация встраивания)
//
// Account ВСТРАИВАЕТ Ledger (анонимное поле) и добавляет поле Holder (string —
// имя владельца). За счёт встраивания методы Ledger (Deposit, Withdraw,
// Current) ПРОДВИГАЮТСЯ в Account и должны вызываться напрямую: acc.Deposit(...),
// acc.Withdraw(...), acc.Current(). Никаких собственных методов Deposit/Withdraw/
// Current у Account объявлять НЕ нужно — они приходят из встроенного Ledger.
//
//	NewAccount(holder, currency string) *Account
//	    Конструктор: возвращает указатель на Account с заданным владельцем
//	    и нулевым балансом в валюте currency (Balance == Money{0, currency}).
package ex02structs

import "errors"

// ErrCurrencyMismatch — операция над денежными суммами в разных валютах.
var ErrCurrencyMismatch = errors.New("currency mismatch")

// ErrInsufficientFunds — попытка снять больше, чем есть на балансе.
var ErrInsufficientFunds = errors.New("insufficient funds")

// Money — денежная сумма в минорных единицах (центах).
type Money struct {
	Cents    int64
	Currency string
}

// Ledger — учёт баланса по одной валюте.
type Ledger struct {
	Balance Money
}

// Account — счёт клиента со встроенным Ledger.
type Account struct {
	Ledger
	Holder string
}

func (m Money) Add(other Money) (Money, error) {
	panic("TODO: implement")
}

func (m Money) Sub(other Money) (Money, error) {
	panic("TODO: implement")
}

func (m Money) IsZero() bool {
	panic("TODO: implement")
}

func (m Money) String() string {
	panic("TODO: implement")
}

func (l *Ledger) Deposit(amount Money) error {
	panic("TODO: implement")
}

func (l *Ledger) Withdraw(amount Money) error {
	panic("TODO: implement")
}

func (l *Ledger) Current() Money {
	panic("TODO: implement")
}

func NewAccount(holder, currency string) *Account {
	panic("TODO: implement")
}
