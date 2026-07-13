package ex04errors

import (
	"errors"
	"strconv"
	"strings"
	"testing"
)

func TestValidateUser(t *testing.T) {
	tests := []struct {
		name    string
		argName string
		argAge  int
		wantErr bool
		wantIs  error  // sentinel, который должен находиться в цепочке (nil — не проверять)
		wantFld string // ожидаемое ValidationError.Field (пусто — не проверять)
	}{
		{name: "valid", argName: "Alice", argAge: 30, wantErr: false},
		{name: "valid zero age", argName: "Bob", argAge: 0, wantErr: false},
		{name: "empty name", argName: "", argAge: 30, wantErr: true, wantIs: ErrEmptyName, wantFld: "name"},
		{name: "negative age", argName: "Carol", argAge: -1, wantErr: true, wantIs: ErrNegativeAge, wantFld: "age"},
		{name: "name checked first", argName: "", argAge: -5, wantErr: true, wantIs: ErrEmptyName, wantFld: "name"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateUser(tc.argName, tc.argAge)

			if tc.wantErr == (err == nil) {
				t.Fatalf("ValidateUser(%q, %d) error = %v, wantErr = %v", tc.argName, tc.argAge, err, tc.wantErr)
			}
			if !tc.wantErr {
				return
			}

			// errors.Is должен находить sentinel сквозь обёртку ValidationError.
			if tc.wantIs != nil && !errors.Is(err, tc.wantIs) {
				t.Errorf("errors.Is(err, %v) = false, want true (err = %v)", tc.wantIs, err)
			}

			// errors.As должен извлекать *ValidationError и давать доступ к Field.
			var ve *ValidationError
			if !errors.As(err, &ve) {
				t.Fatalf("errors.As(err, *ValidationError) = false, want true (err = %v)", err)
			}
			if tc.wantFld != "" && ve.Field != tc.wantFld {
				t.Errorf("ValidationError.Field = %q, want %q", ve.Field, tc.wantFld)
			}

			// Сообщение должно упоминать имя поля (контракт Error()).
			if !strings.Contains(err.Error(), ve.Field) {
				t.Errorf("Error() = %q, должно содержать имя поля %q", err.Error(), ve.Field)
			}
		})
	}
}

func TestValidationErrorUnwrap(t *testing.T) {
	ve := &ValidationError{Field: "name", Err: ErrEmptyName}
	if got := errors.Unwrap(ve); !errors.Is(got, ErrEmptyName) {
		t.Errorf("errors.Unwrap returned %v, want chain to ErrEmptyName", got)
	}
}

func TestParseRecord(t *testing.T) {
	tests := []struct {
		name     string
		line     string
		want     Record
		wantErr  bool
		wantIs   error // sentinel в цепочке (nil — не проверять)
		wantNum  bool  // ожидается *strconv.NumError в цепочке
		wantVErr bool  // ожидается *ValidationError в цепочке
	}{
		{name: "ok", line: "Alice,30", want: Record{Name: "Alice", Age: 30}},
		{name: "ok zero age", line: "Bob,0", want: Record{Name: "Bob", Age: 0}},
		{name: "too few fields", line: "Alice", wantErr: true, wantIs: ErrMalformedRecord},
		{name: "too many fields", line: "Alice,30,extra", wantErr: true, wantIs: ErrMalformedRecord},
		{name: "bad age", line: "Alice,thirty", wantErr: true, wantNum: true},
		{name: "empty name", line: ",30", wantErr: true, wantIs: ErrEmptyName, wantVErr: true},
		{name: "negative age", line: "Carol,-3", wantErr: true, wantIs: ErrNegativeAge, wantVErr: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ParseRecord(tc.line)

			if tc.wantErr == (err == nil) {
				t.Fatalf("ParseRecord(%q) error = %v, wantErr = %v", tc.line, err, tc.wantErr)
			}
			if !tc.wantErr {
				if got != tc.want {
					t.Errorf("ParseRecord(%q) = %+v, want %+v", tc.line, got, tc.want)
				}
				return
			}

			if tc.wantIs != nil && !errors.Is(err, tc.wantIs) {
				t.Errorf("errors.Is(err, %v) = false, want true (err = %v)", tc.wantIs, err)
			}
			if tc.wantNum {
				var ne *strconv.NumError
				if !errors.As(err, &ne) {
					t.Errorf("errors.As(err, *strconv.NumError) = false, want true (err = %v)", err)
				}
			}
			if tc.wantVErr {
				var ve *ValidationError
				if !errors.As(err, &ve) {
					t.Errorf("errors.As(err, *ValidationError) = false, want true (err = %v)", err)
				}
			}
		})
	}
}
