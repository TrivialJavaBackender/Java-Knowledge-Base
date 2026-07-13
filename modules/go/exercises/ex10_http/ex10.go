// Package ex10http — упражнение по теме «net/http»: REST-обработчики поверх
// стандартного ServeMux 1.22 + middleware, с потокобезопасным хранилищем в памяти.
//
// # Задача
//
// Собери небольшой REST-сервис «items» целиком на стандартной библиотеке. Нужны
// две вещи: потокобезопасное хранилище Store и конструктор NewServer, который
// регистрирует CRUD-маршруты на http.ServeMux и оборачивает их middleware.
//
// Никаких сторонних роутеров и зависимостей — только net/http, ServeMux 1.22
// (метод + шаблон + wildcard {id}), encoding/json, sync.
//
// # Модель
//
// Item — это запись с двумя полями:
//
//	type Item struct {
//	    ID   string `json:"id"`
//	    Name string `json:"name"`
//	}
//
// # Хранилище Store
//
// Store — in-memory хранилище items, безопасное для конкурентного доступа из
// множества горутин (помни: net/http вызывает обработчики конкурентно). Используй
// sync.RWMutex: чтения (Get/List) под RLock, изменения (Put/Delete) под Lock.
//
// Методы (сигнатуры обязательны — на них опираются тесты):
//
//	func NewStore() *Store
//	func (s *Store) Get(id string) (Item, bool)   // ok=false, если нет
//	func (s *Store) Put(it Item)                   // вставка ИЛИ перезапись по it.ID
//	func (s *Store) Delete(id string) bool         // true, если что-то удалили
//	func (s *Store) List() []Item                  // снимок всех items (порядок не важен)
//
// # HTTP API: NewServer(store *Store) http.Handler
//
// NewServer создаёт http.ServeMux, регистрирует на нём маршруты ниже, оборачивает
// получившийся обработчик в middleware WithRequestID и возвращает http.Handler.
// Тела запросов/ответов — JSON (Content-Type ответа: "application/json").
//
// Маршруты (синтаксис шаблонов 1.22 — метод + путь + wildcard):
//
//	GET    /items        — вернуть JSON-массив всех items, статус 200.
//	                       Пустое хранилище → 200 и JSON-массив (не null).
//
//	GET    /items/{id}   — вернуть item по id (r.PathValue("id")).
//	                       Есть → 200 + JSON item. Нет → 404.
//
//	PUT    /items/{id}   — создать или заменить item с этим id.
//	                       Тело: JSON {"name": "..."} (поле id из тела игнорируй —
//	                       источник истины id это путь). Сохрани Item{ID: id, Name: name}.
//	                       Невалидный JSON в теле → 400.
//	                       Если item с таким id РАНЕЕ не существовал → 201 Created
//	                       и JSON созданного item. Если существовал (перезапись) →
//	                       200 и JSON обновлённого item.
//
//	DELETE /items/{id}   — удалить item по id.
//	                       Удалили → 204 No Content (без тела).
//	                       Не было такого id → 404.
//
// Следи за порядком записи: сначала заголовки, потом WriteHeader(код), потом тело.
// Для путей ошибок удобен http.Error.
//
// # Middleware WithRequestID
//
//	func WithRequestID(next http.Handler) http.Handler
//
// Оборачивает next так, что КАЖДЫЙ ответ получает заголовок "X-Request-ID" с
// непустым значением (любой уникальный/псевдоуникальный идентификатор запроса).
// Заголовок должен присутствовать на всех ответах, включая 404 и 400. Помни:
// заголовок ответа надо установить ДО того, как обработчик вызовет WriteHeader.
//
// # Ограничения
//
//   - Только стандартная библиотека (net/http, encoding/json, sync, и что нужно
//     для генерации id). Никаких сторонних пакетов.
//   - Реализация — только в этом файле. Файл ex10_test.go менять не нужно.
//   - Конкурентная безопасность Store обязательна (тест может гонять запросы
//     параллельно; решение должно проходить `go test -race`).
//
// # Подсказок по реализации в коде нет — см. theory/NET_HTTP.md.
package ex10http

import (
	"net/http"
	"sync"
)

// Item — запись хранилища. Сериализуется в JSON ровно с этими ключами.
type Item struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Store — потокобезопасное in-memory хранилище items.
type Store struct {
	mu    sync.RWMutex
	items map[string]Item
}

// NewStore создаёт пустое готовое к работе хранилище.
func NewStore() *Store {
	panic("TODO: implement")
}

// Get возвращает item по id и признак наличия.
func (s *Store) Get(id string) (Item, bool) {
	panic("TODO: implement")
}

// Put вставляет новый или перезаписывает существующий item по it.ID.
func (s *Store) Put(it Item) {
	panic("TODO: implement")
}

// Delete удаляет item по id; возвращает true, если запись существовала.
func (s *Store) Delete(id string) bool {
	panic("TODO: implement")
}

// List возвращает снимок всех items (порядок не гарантирован).
func (s *Store) List() []Item {
	panic("TODO: implement")
}

// NewServer регистрирует CRUD-маршруты /items на ServeMux, оборачивает их в
// WithRequestID и возвращает готовый http.Handler.
func NewServer(store *Store) http.Handler {
	panic("TODO: implement")
}

// WithRequestID добавляет каждому ответу заголовок X-Request-ID с непустым значением.
func WithRequestID(next http.Handler) http.Handler {
	panic("TODO: implement")
}
