# Упражнения — CQL

Задания выполняются на живом кластере в контейнере. Поднять:

```bash
docker run -d --name cass -p 9042:9042 -e MAX_HEAP_SIZE=1G -e HEAP_NEWSIZE=256M cassandra:5.0
docker exec cass cqlsh -e "SELECT release_version FROM system.local;"   # готовность
```

Выполнить файл упражнения:

```bash
docker exec -i cass cqlsh < ex01_order_history/schema.cql
```

## Порядок

| # | Упражнение | Что проверяет |
|---|------------|---------------|
| 1 | [ex01_order_history](ex01_order_history/) | модель под три запроса, ключ партиции и кластеризации |
| 2 | [ex02_partition_sizing](ex02_partition_sizing/) | оценка размера партиции, бакетирование |
| 3 | [ex03_tombstones](ex03_tombstones/) | tombstone: воспроизвести, измерить, устранить |
| 4 | [ex04_consistency](ex04_consistency/) | уровни согласованности под требования доступности |
| 5 | [ex05_compaction](ex05_compaction/) | выбор стратегии compaction и TTL |
| 6 | [ex06_diagnose](ex06_diagnose/) | диагностика медленного чтения по трассировке |

Все задания используют сквозной пример модуля — историю заказов маркетплейса.

## Правила

- Решение — это **схема плюс запросы**, а не программа.
- Ни один запрос из условия не должен требовать `ALLOW FILTERING`.
- Каждое проектное решение нужно уметь обосновать: почему такой ключ партиции, почему такой
  порядок кластеризации, чем платим.
