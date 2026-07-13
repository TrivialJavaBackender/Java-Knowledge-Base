package ex10http

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// do выполняет один запрос против обработчика через ResponseRecorder.
func do(t *testing.T, h http.Handler, method, target, body string) *httptest.ResponseRecorder {
	t.Helper()
	var r *http.Request
	if body == "" {
		r = httptest.NewRequest(method, target, nil)
	} else {
		r = httptest.NewRequest(method, target, strings.NewReader(body))
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, r)
	return rec
}

// decodeItem разбирает JSON-тело ответа в Item.
func decodeItem(t *testing.T, rec *httptest.ResponseRecorder) Item {
	t.Helper()
	var it Item
	if err := json.Unmarshal(rec.Body.Bytes(), &it); err != nil {
		t.Fatalf("не удалось разобрать JSON item: %v (тело: %q)", err, rec.Body.String())
	}
	return it
}

func TestStoreBasics(t *testing.T) {
	s := NewStore()

	if _, ok := s.Get("missing"); ok {
		t.Fatalf("Get несуществующего вернул ok=true")
	}
	if s.Delete("missing") {
		t.Fatalf("Delete несуществующего вернул true")
	}
	if got := s.List(); len(got) != 0 {
		t.Fatalf("List пустого хранилища: len=%d, want 0", len(got))
	}

	s.Put(Item{ID: "a", Name: "Alpha"})
	it, ok := s.Get("a")
	if !ok || it.Name != "Alpha" {
		t.Fatalf("после Put: Get(a)=%+v ok=%v, want Name=Alpha ok=true", it, ok)
	}

	// Перезапись по тому же id.
	s.Put(Item{ID: "a", Name: "Alpha2"})
	it, _ = s.Get("a")
	if it.Name != "Alpha2" {
		t.Fatalf("после перезаписи Name=%q, want Alpha2", it.Name)
	}
	if got := s.List(); len(got) != 1 {
		t.Fatalf("после перезаписи List len=%d, want 1", len(got))
	}

	if !s.Delete("a") {
		t.Fatalf("Delete существующего вернул false")
	}
	if _, ok := s.Get("a"); ok {
		t.Fatalf("после Delete элемент всё ещё доступен")
	}
}

func TestListEmptyReturnsJSONArray(t *testing.T) {
	srv := NewServer(NewStore())
	rec := do(t, srv, http.MethodGet, "/items", "")

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /items пустого: статус=%d, want 200", rec.Code)
	}
	body := strings.TrimSpace(rec.Body.String())
	if body != "[]" {
		t.Fatalf("GET /items пустого: тело=%q, want []", body)
	}
}

func TestGetMissingReturns404(t *testing.T) {
	srv := NewServer(NewStore())
	rec := do(t, srv, http.MethodGet, "/items/nope", "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("GET отсутствующего: статус=%d, want 404", rec.Code)
	}
}

func TestPutCreatesThenUpdates(t *testing.T) {
	srv := NewServer(NewStore())

	// Первый PUT — создание → 201.
	rec := do(t, srv, http.MethodPut, "/items/42", `{"name":"Foo"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("PUT новый: статус=%d, want 201", rec.Code)
	}
	it := decodeItem(t, rec)
	if it.ID != "42" || it.Name != "Foo" {
		t.Fatalf("PUT новый: тело=%+v, want {ID:42 Name:Foo}", it)
	}

	// Второй PUT того же id — перезапись → 200.
	rec = do(t, srv, http.MethodPut, "/items/42", `{"name":"Bar"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT существующего: статус=%d, want 200", rec.Code)
	}
	it = decodeItem(t, rec)
	if it.Name != "Bar" {
		t.Fatalf("PUT существующего: Name=%q, want Bar", it.Name)
	}

	// GET должен вернуть обновлённое значение.
	rec = do(t, srv, http.MethodGet, "/items/42", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("GET после PUT: статус=%d, want 200", rec.Code)
	}
	if it = decodeItem(t, rec); it.Name != "Bar" {
		t.Fatalf("GET после PUT: Name=%q, want Bar", it.Name)
	}
}

func TestPutIgnoresBodyID(t *testing.T) {
	// id берётся из пути, а не из тела: тело с "id":"other" не должно перебить путь.
	srv := NewServer(NewStore())
	rec := do(t, srv, http.MethodPut, "/items/path-id", `{"id":"other","name":"X"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("PUT: статус=%d, want 201", rec.Code)
	}
	if it := decodeItem(t, rec); it.ID != "path-id" {
		t.Fatalf("PUT: ID=%q, want path-id (id из пути, не из тела)", it.ID)
	}
	// По пути из тела ничего не создалось.
	rec = do(t, srv, http.MethodGet, "/items/other", "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("GET /items/other: статус=%d, want 404", rec.Code)
	}
}

func TestPutBadJSONReturns400(t *testing.T) {
	srv := NewServer(NewStore())
	rec := do(t, srv, http.MethodPut, "/items/1", `{not json`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("PUT с битым JSON: статус=%d, want 400", rec.Code)
	}
}

func TestDeleteLifecycle(t *testing.T) {
	srv := NewServer(NewStore())

	// Удаление отсутствующего → 404.
	rec := do(t, srv, http.MethodDelete, "/items/x", "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("DELETE отсутствующего: статус=%d, want 404", rec.Code)
	}

	// Создаём, затем удаляем → 204 без тела.
	do(t, srv, http.MethodPut, "/items/x", `{"name":"X"}`)
	rec = do(t, srv, http.MethodDelete, "/items/x", "")
	if rec.Code != http.StatusNoContent {
		t.Fatalf("DELETE существующего: статус=%d, want 204", rec.Code)
	}
	if strings.TrimSpace(rec.Body.String()) != "" {
		t.Fatalf("DELETE: тело непустое (%q), want пусто (204)", rec.Body.String())
	}

	// Повторное удаление → снова 404.
	rec = do(t, srv, http.MethodDelete, "/items/x", "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("повторный DELETE: статус=%d, want 404", rec.Code)
	}
}

func TestListReturnsAllItems(t *testing.T) {
	srv := NewServer(NewStore())
	do(t, srv, http.MethodPut, "/items/a", `{"name":"A"}`)
	do(t, srv, http.MethodPut, "/items/b", `{"name":"B"}`)
	do(t, srv, http.MethodPut, "/items/c", `{"name":"C"}`)

	rec := do(t, srv, http.MethodGet, "/items", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /items: статус=%d, want 200", rec.Code)
	}
	var items []Item
	if err := json.Unmarshal(rec.Body.Bytes(), &items); err != nil {
		t.Fatalf("не удалось разобрать список: %v (тело %q)", err, rec.Body.String())
	}
	if len(items) != 3 {
		t.Fatalf("len(items)=%d, want 3", len(items))
	}
	names := map[string]bool{}
	for _, it := range items {
		names[it.Name] = true
	}
	for _, want := range []string{"A", "B", "C"} {
		if !names[want] {
			t.Fatalf("в списке нет item с Name=%q (получено %+v)", want, items)
		}
	}
}

func TestContentTypeJSON(t *testing.T) {
	srv := NewServer(NewStore())
	do(t, srv, http.MethodPut, "/items/1", `{"name":"One"}`)
	rec := do(t, srv, http.MethodGet, "/items/1", "")
	if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "application/json") {
		t.Fatalf("Content-Type=%q, want содержит application/json", ct)
	}
}

func TestMiddlewareSetsRequestID(t *testing.T) {
	srv := NewServer(NewStore())

	// Заголовок X-Request-ID должен присутствовать на всех ответах.
	cases := []struct {
		method, target, body string
	}{
		{http.MethodGet, "/items", ""},               // 200
		{http.MethodGet, "/items/missing", ""},       // 404
		{http.MethodPut, "/items/1", `{"name":"x"}`}, // 201
		{http.MethodPut, "/items/2", `{bad`},         // 400
	}
	for _, c := range cases {
		rec := do(t, srv, c.method, c.target, c.body)
		if id := rec.Header().Get("X-Request-ID"); id == "" {
			t.Fatalf("%s %s: заголовок X-Request-ID пуст, want непустой (статус %d)",
				c.method, c.target, rec.Code)
		}
	}
}

func TestConcurrentAccess(t *testing.T) {
	// Гоняем смешанную нагрузку на общий сервер из многих горутин.
	// Под `go test -race` ловит незащищённый доступ к Store.
	srv := NewServer(NewStore())
	const workers = 16
	done := make(chan struct{})
	for w := 0; w < workers; w++ {
		go func(id string) {
			for i := 0; i < 50; i++ {
				do(t, srv, http.MethodPut, "/items/"+id, `{"name":"v"}`)
				do(t, srv, http.MethodGet, "/items/"+id, "")
				do(t, srv, http.MethodGet, "/items", "")
				do(t, srv, http.MethodDelete, "/items/"+id, "")
			}
			done <- struct{}{}
		}(string(rune('a' + w)))
	}
	for w := 0; w < workers; w++ {
		<-done
	}
}
