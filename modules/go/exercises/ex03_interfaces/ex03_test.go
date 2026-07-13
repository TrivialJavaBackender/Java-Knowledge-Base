package ex03interfaces

import (
	"fmt"
	"math"
	"strings"
	"testing"
)

const eps = 1e-9

func approxEqual(a, b float64) bool {
	return math.Abs(a-b) <= eps
}

func TestShapeArea(t *testing.T) {
	tests := []struct {
		name string
		s    Shape
		want float64
	}{
		{"rectangle", Rectangle{Width: 3, Height: 4}, 12},
		{"rectangle unit", Rectangle{Width: 1, Height: 1}, 1},
		{"circle", Circle{Radius: 5}, math.Pi * 25},
		{"circle zero", Circle{Radius: 0}, 0},
		{"triangle 3-4-5", Triangle{A: 3, B: 4, C: 5}, 6},
		{"triangle equilateral side 2", Triangle{A: 2, B: 2, C: 2}, math.Sqrt(3)},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := tc.s.Area()
			if !approxEqual(got, tc.want) {
				t.Errorf("Area() = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestShapePerimeter(t *testing.T) {
	tests := []struct {
		name string
		s    Shape
		want float64
	}{
		{"rectangle", Rectangle{Width: 3, Height: 4}, 14},
		{"circle", Circle{Radius: 5}, 2 * math.Pi * 5},
		{"triangle 3-4-5", Triangle{A: 3, B: 4, C: 5}, 12},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := tc.s.Perimeter()
			if !approxEqual(got, tc.want) {
				t.Errorf("Perimeter() = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestTotalArea(t *testing.T) {
	tests := []struct {
		name   string
		shapes []Shape
		want   float64
	}{
		{"nil slice", nil, 0},
		{"empty slice", []Shape{}, 0},
		{"single", []Shape{Rectangle{Width: 2, Height: 3}}, 6},
		{
			name: "mixed polymorphic",
			shapes: []Shape{
				Rectangle{Width: 3, Height: 4}, // 12
				Circle{Radius: 1},              // pi
				Triangle{A: 3, B: 4, C: 5},     // 6
			},
			want: 12 + math.Pi + 6,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := TotalArea(tc.shapes)
			if !approxEqual(got, tc.want) {
				t.Errorf("TotalArea() = %v, want %v", got, tc.want)
			}
		})
	}
}

// TestRectangleStringer проверяет, что Rectangle реализует fmt.Stringer
// и его представление непустое и осмысленное (содержит оба измерения).
func TestRectangleStringer(t *testing.T) {
	var s fmt.Stringer = Rectangle{Width: 3, Height: 4}
	got := s.String()
	if got == "" {
		t.Fatal("String() вернул пустую строку")
	}
	if !strings.Contains(got, "3") || !strings.Contains(got, "4") {
		t.Errorf("String() = %q, ожидались оба измерения (3 и 4)", got)
	}
}

func TestDescribe(t *testing.T) {
	tests := []struct {
		name string
		in   any
		want string
	}{
		{"nil", nil, "nil"},
		{"int", 42, "int: 42"},
		{"int zero", 0, "int: 0"},
		{"int negative", -7, "int: -7"},
		{"string", "hi", "string: hi"},
		{"empty string", "", "string: "},
		{"shape rectangle", Rectangle{Width: 3, Height: 4}, "shape area=12.00"},
		{"shape circle", Circle{Radius: 5}, fmt.Sprintf("shape area=%.2f", math.Pi*25)},
		{"shape triangle", Triangle{A: 3, B: 4, C: 5}, "shape area=6.00"},
		{"default bool", true, "unknown: bool"},
		{"default float64", 3.14, "unknown: float64"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := Describe(tc.in)
			if got != tc.want {
				t.Errorf("Describe(%#v) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}
