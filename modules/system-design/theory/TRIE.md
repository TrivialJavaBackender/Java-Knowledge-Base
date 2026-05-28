# Trie (префиксное дерево)

Древовидная структура для запросов по префиксу. Каждый узел — символ; путь от корня до узла = строка. Идеален для автодополнения, проверки орфографии, IP-маршрутизации.

---

## Структура

```
        (root)
       /  |   \
      a   b    c
     /|   |    |
    p t   a    a
    |  \  |    |
    p   e t    r
    |   |  
    l   r
    |
    e
```

`apple`, `app`, `ate`, `bat`, `car`.

### Узел

```python
class TrieNode:
    children: dict  # char → TrieNode
    is_end_of_word: bool
    metadata: any  # frequency, score, etc.
```

### Операции

```python
def insert(word):
    node = root
    for ch in word:
        if ch not in node.children:
            node.children[ch] = TrieNode()
        node = node.children[ch]
    node.is_end_of_word = True

def search(word) → bool:
    node = root
    for ch in word:
        if ch not in node.children:
            return False
        node = node.children[ch]
    return node.is_end_of_word

def starts_with(prefix) → list[str]:
    node = root
    for ch in prefix:
        if ch not in node.children:
            return []
        node = node.children[ch]
    return collect_all_words(node, prefix)
```

### Сложность

- Вставка / Поиск: `O(L)` где L = длина слова
- Память: `O(N × L × alphabet_size)` в худшем случае, значительно меньше при сжатии

---

## Автодополнение с ранжированием

Реальное автодополнение (строка поиска Google, Amazon) показывает **top-K наиболее популярных** вариантов, а не все.

### Подход 1 — top-K на узел

Каждый узел хранит заранее вычисленные top-K подсказки для своего префикса.

```python
class TrieNode:
    children: dict
    top_k: list[str]  # pre-sorted by frequency, top K
```

При запросе `"app"`:
- Переходим к узлу для "app"
- Возвращаем `node.top_k` — мгновенно

**Компромисс:**
- ✓ O(L) время запроса + O(K) возврат результатов — очень быстро
- ✗ Память: каждый узел хранит top-K (дёшево при K=10)
- ✗ Стоимость обновления: при изменении частоты может потребоваться обновить top-K в нескольких узлах (вдоль пути)

### Подход 2 — поиск с последующим ранжированием

Trie возвращает все варианты, затем внешний ранжировщик сортирует их:

```python
suggestions = trie.starts_with("app")  # all
ranked = sort(suggestions, key=frequency_lookup, descending=True)[:10]
```

- ✓ Минимальное потребление памяти
- ✗ Медленно при большом числе вариантов (поиск по «r» — миллионы результатов)

### Подход 3 — комбинированный: top-K для популярных префиксов

Кэшируем top-K только для популярных префиксов (первые 2–3 символа). В остальных случаях — полный поиск.

---

## Сжатый Trie (Radix / Patricia)

**Идея:** если у узла единственный потомок — объединяем их.

```
Standard:           Compressed:
   a                   a
   |                   |
   p                   pp
   |                   ↙ ↘
   p                  le er
  ↙ ↘                (apple)(apper — hypothetical)
 l   ...
 |
 e
```

- ✓ Меньше узлов — меньше памяти
- ✓ Более быстрый обход
- ✗ Вставка / удаление сложнее (нужно разбиение/слияние)

**Применение:** таблицы IP-маршрутизации (ядро Linux использует Patricia trie), маршрутизация URL в веб-фреймворках.

---

## Использования

### Автодополнение / typeahead

Основной сценарий использования. Google search, Amazon, YouTube — все так работают.

### Проверка орфографии

«Найти слова с редакционным расстоянием 1 от неправильно написанного». Trie + динамическое программирование по Trie.

### IP-маршрутизация (CIDR, поиск наидлиннейшего совпадающего префикса)

Таблица маршрутизации — набор CIDR-префиксов (`192.168.0.0/16`, `10.0.0.0/8`, ...). Для каждого пакета ищем **наиболее длинный совпадающий префикс**.

Patricia trie по битам.

### Поиск слов / Boggle

Находим все слова в сетке. Trie + DFS.

### Маршрутизация URL

Веб-фреймворк сопоставляет `/users/:id/posts` → маршрутизатор использует trie (или radix trie) по сегментам пути.

---

## Распределённое автодополнение (масштаб)

Trie на одном узле:
- Память: ~ 1 ГБ для 10M слов
- Пропускная способность: ~ 100K запросов/с на одно ядро

**Масштабирование:**

### Шардирование по префиксу

```
Shard 1: prefixes a-d
Shard 2: prefixes e-h
...
```

Маршрутизатор отправляет запрос к нужному шарду на основе префикса.

### Репликация для чтения

Trie неизменяем (перестраивается ежедневно / ежечасно). Много реплик для чтения, blue-green развёртывание.

### Гибрид: in-memory trie + Redis cache

- Горячие префиксы кэшируются в памяти приложения
- При промахе — загружаем из Redis (где живёт полный trie)

### Пограничные узлы / CDN

Подсказки автодополнения кэшируются на пограничных узлах CDN (TTL ~1 минута). Устаревшие данные допустимы для typeahead.

---

## Альтернативы

### Suffix tree / suffix array

Для поиска подстроки (не только префикса). Стоимость построения O(N), поиска O(M) (M = длина шаблона).

### DAWG (Directed Acyclic Word Graph)

Минимизированный trie — объединяет также и суффиксы. Более компактен, но сложнее в обновлении.

### Инвертированный индекс (Lucene / Elasticsearch)

Сложнее, поддерживает полнотекстовый поиск (токенизация, стемминг, ранжирование). Автодополнение — частный случай (токенизатор edge-ngram).

### Предвычисленные top-K таблицы

`HashMap<prefix, top_k_list>` для часто запрашиваемых префиксов (1–3 символа). Просто, хорошо работает для высоконагруженных префиксов.

### Bloom filter + DB

Bloom filter «есть ли варианты?» → если да, смотрим в Redis. Снижает нагрузку на БД при промахах.

---

## Реальные примеры

- **Google Search Autocomplete** — кастомный trie + ML-ранжирование + персонализация
- **Amazon Search** — trie + буст по категориям товаров
- **Twitter typeahead** — trie поверх Elasticsearch
- **LinkedIn typeahead** — Cleo (внутренняя разработка, открытый исходный код)
- **Elasticsearch Completion Suggester** — на базе FST (Finite State Transducer — сжатый вариант trie)

---

## Советы по реализации

- **Символы vs Unicode** — для не-ASCII (кириллица, emoji, CJK) дочерние узлы Trie = `Map<Int, TrieNode>` (Unicode codepoints) или меньший алфавит (нормализация Unicode)
- **Регистронезависимость** — нормализуем к нижнему регистру перед вставкой/поиском
- **Стоп-слова** — исключаем «the», «a», «an» если не нужны
- **Стемминг** — «running» → «run» перед вставкой (Snowball stemmer)
- **Нечёткий поиск** — DFS с бюджетом редакционного расстояния (медленно для больших данных; лучше BK-tree или LSH)

---

## Показатели производительности

| Операция | Задержка | Память |
|-----------|---------|--------|
| Вставка 1M слов | ~ 1 с | ~ 200 МБ |
| Вставка 10M слов | ~ 15 с | ~ 2 ГБ |
| Единичный поиск (5 символов) | < 1 µs | — |
| Поиск top-K (K=10) | 1–5 µs | — |
| Пропускная способность | 100K–1M операций/с на одно ядро | — |

→ Trie на одном узле легко обрабатывает миллионы слов. Шардирование нужно только при > 100M уникальных слов.

---

## Источники

- *Introduction to Algorithms* (CLRS) — basic trie chapter
- [Algorithms textbook (Sedgewick, Wayne) — Tries section](https://algs4.cs.princeton.edu/52trie/)
- [LinkedIn Cleo open source typeahead engine](https://github.com/linkedin/cleo)
- [Elasticsearch Completion Suggester](https://www.elastic.co/guide/en/elasticsearch/reference/current/search-suggesters.html#completion-suggester)
- [Lucene FST (Finite State Transducer)](https://lucene.apache.org/core/9_8_0/core/org/apache/lucene/util/fst/package-summary.html)
- [Patricia Trie / Radix Tree (Wikipedia)](https://en.wikipedia.org/wiki/Radix_tree)
- *Algorithms on Strings, Trees, and Sequences* (Dan Gusfield) — academic deep dive
