package ex02structs

import (
	"errors"
	"testing"
)

func TestMoneyString(t *testing.T) {
	tests := []struct {
		name string
		in   Money
		want string
	}{
		{"dollars and cents", Money{1234, "USD"}, "12.34 USD"},
		{"only cents", Money{5, "USD"}, "0.05 USD"},
		{"whole units", Money{700, "EUR"}, "7.00 EUR"},
		{"zero", Money{0, "USD"}, "0.00 USD"},
		{"negative", Money{-1234, "EUR"}, "-12.34 EUR"},
		{"negative cents only", Money{-5, "EUR"}, "-0.05 EUR"},
		{"large", Money{123456789, "USD"}, "1234567.89 USD"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.in.String(); got != tt.want {
				t.Errorf("Money%v.String() = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestMoneyIsZero(t *testing.T) {
	tests := []struct {
		name string
		in   Money
		want bool
	}{
		{"zero usd", Money{0, "USD"}, true},
		{"zero empty currency", Money{0, ""}, true},
		{"positive", Money{1, "USD"}, false},
		{"negative", Money{-1, "USD"}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.in.IsZero(); got != tt.want {
				t.Errorf("Money%v.IsZero() = %v, want %v", tt.in, got, tt.want)
			}
		})
	}
}

func TestMoneyAdd(t *testing.T) {
	tests := []struct {
		name    string
		a, b    Money
		want    Money
		wantErr bool
	}{
		{"same currency", Money{1000, "USD"}, Money{234, "USD"}, Money{1234, "USD"}, false},
		{"add zero", Money{1000, "USD"}, Money{0, "USD"}, Money{1000, "USD"}, false},
		{"to negative result via add neg", Money{100, "USD"}, Money{-150, "USD"}, Money{-50, "USD"}, false},
		{"currency mismatch", Money{1000, "USD"}, Money{1, "EUR"}, Money{}, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := tt.a.Add(tt.b)
			if tt.wantErr {
				if !errors.Is(err, ErrCurrencyMismatch) {
					t.Fatalf("Add: expected ErrCurrencyMismatch, got %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("Add: unexpected error %v", err)
			}
			if got != tt.want {
				t.Errorf("Add = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestMoneySub(t *testing.T) {
	tests := []struct {
		name    string
		a, b    Money
		want    Money
		wantErr bool
	}{
		{"same currency", Money{1000, "USD"}, Money{234, "USD"}, Money{766, "USD"}, false},
		{"goes negative", Money{100, "USD"}, Money{250, "USD"}, Money{-150, "USD"}, false},
		{"currency mismatch", Money{1000, "USD"}, Money{1, "EUR"}, Money{}, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := tt.a.Sub(tt.b)
			if tt.wantErr {
				if !errors.Is(err, ErrCurrencyMismatch) {
					t.Fatalf("Sub: expected ErrCurrencyMismatch, got %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("Sub: unexpected error %v", err)
			}
			if got != tt.want {
				t.Errorf("Sub = %v, want %v", got, tt.want)
			}
		})
	}
}

// Value receiver не должен мутировать получателя: после Add/Sub исходное
// значение обязано остаться прежним.
func TestMoneyValueReceiverImmutable(t *testing.T) {
	m := Money{1000, "USD"}
	if _, err := m.Add(Money{500, "USD"}); err != nil {
		t.Fatalf("Add: unexpected error %v", err)
	}
	if m != (Money{1000, "USD"}) {
		t.Errorf("Add mutated receiver: m = %v, want {1000 USD}", m)
	}
	if _, err := m.Sub(Money{300, "USD"}); err != nil {
		t.Fatalf("Sub: unexpected error %v", err)
	}
	if m != (Money{1000, "USD"}) {
		t.Errorf("Sub mutated receiver: m = %v, want {1000 USD}", m)
	}
}

// Pointer receiver обязан менять оригинал.
func TestLedgerDepositMutates(t *testing.T) {
	l := &Ledger{Balance: Money{0, "USD"}}
	if err := l.Deposit(Money{1234, "USD"}); err != nil {
		t.Fatalf("Deposit: unexpected error %v", err)
	}
	if got := l.Current(); got != (Money{1234, "USD"}) {
		t.Errorf("after Deposit balance = %v, want {1234 USD}", got)
	}
	if err := l.Deposit(Money{766, "USD"}); err != nil {
		t.Fatalf("Deposit: unexpected error %v", err)
	}
	if got := l.Current(); got != (Money{2000, "USD"}) {
		t.Errorf("after second Deposit balance = %v, want {2000 USD}", got)
	}
}

func TestLedgerDepositInitializesEmptyCurrency(t *testing.T) {
	l := &Ledger{} // Balance == Money{0, ""}
	if err := l.Deposit(Money{500, "EUR"}); err != nil {
		t.Fatalf("Deposit into fresh ledger: unexpected error %v", err)
	}
	if got := l.Current(); got != (Money{500, "EUR"}) {
		t.Errorf("balance = %v, want {500 EUR}", got)
	}
}

func TestLedgerDepositCurrencyMismatch(t *testing.T) {
	l := &Ledger{Balance: Money{1000, "USD"}}
	err := l.Deposit(Money{1, "EUR"})
	if !errors.Is(err, ErrCurrencyMismatch) {
		t.Fatalf("expected ErrCurrencyMismatch, got %v", err)
	}
	if got := l.Current(); got != (Money{1000, "USD"}) {
		t.Errorf("balance changed on mismatch: %v, want {1000 USD}", got)
	}
}

func TestLedgerWithdraw(t *testing.T) {
	l := &Ledger{Balance: Money{1000, "USD"}}
	if err := l.Withdraw(Money{300, "USD"}); err != nil {
		t.Fatalf("Withdraw: unexpected error %v", err)
	}
	if got := l.Current(); got != (Money{700, "USD"}) {
		t.Errorf("after Withdraw balance = %v, want {700 USD}", got)
	}
}

func TestLedgerWithdrawExactBalance(t *testing.T) {
	l := &Ledger{Balance: Money{700, "USD"}}
	if err := l.Withdraw(Money{700, "USD"}); err != nil {
		t.Fatalf("Withdraw exact: unexpected error %v", err)
	}
	if got := l.Current(); got != (Money{0, "USD"}) {
		t.Errorf("after exact Withdraw balance = %v, want {0 USD}", got)
	}
}

func TestLedgerWithdrawInsufficient(t *testing.T) {
	l := &Ledger{Balance: Money{500, "USD"}}
	err := l.Withdraw(Money{501, "USD"})
	if !errors.Is(err, ErrInsufficientFunds) {
		t.Fatalf("expected ErrInsufficientFunds, got %v", err)
	}
	if got := l.Current(); got != (Money{500, "USD"}) {
		t.Errorf("balance changed on insufficient funds: %v, want {500 USD}", got)
	}
}

func TestLedgerWithdrawCurrencyMismatch(t *testing.T) {
	l := &Ledger{Balance: Money{1000, "USD"}}
	err := l.Withdraw(Money{1, "EUR"})
	if !errors.Is(err, ErrCurrencyMismatch) {
		t.Fatalf("expected ErrCurrencyMismatch, got %v", err)
	}
	if got := l.Current(); got != (Money{1000, "USD"}) {
		t.Errorf("balance changed on mismatch: %v, want {1000 USD}", got)
	}
}

// Встраивание: методы Ledger должны быть доступны на Account напрямую
// (продвижение методов), и менять встроенный Ledger.
func TestAccountPromotedMethods(t *testing.T) {
	acc := NewAccount("Ann", "USD")
	if acc.Holder != "Ann" {
		t.Fatalf("Holder = %q, want Ann", acc.Holder)
	}
	if got := acc.Current(); got != (Money{0, "USD"}) {
		t.Fatalf("fresh account balance = %v, want {0 USD}", got)
	}

	if err := acc.Deposit(Money{5000, "USD"}); err != nil { // продвинутый метод
		t.Fatalf("acc.Deposit: unexpected error %v", err)
	}
	if err := acc.Withdraw(Money{1500, "USD"}); err != nil { // продвинутый метод
		t.Fatalf("acc.Withdraw: unexpected error %v", err)
	}
	if got := acc.Current(); got != (Money{3500, "USD"}) {
		t.Errorf("balance = %v, want {3500 USD}", got)
	}

	// Изменения должны быть видны и через само встроенное поле Ledger.
	if got := acc.Ledger.Balance; got != (Money{3500, "USD"}) {
		t.Errorf("embedded Ledger.Balance = %v, want {3500 USD}", got)
	}

	// Overdraft через продвинутый Withdraw тоже обязан отклоняться.
	if err := acc.Withdraw(Money{999999, "USD"}); !errors.Is(err, ErrInsufficientFunds) {
		t.Errorf("expected ErrInsufficientFunds on overdraft, got %v", err)
	}
}
