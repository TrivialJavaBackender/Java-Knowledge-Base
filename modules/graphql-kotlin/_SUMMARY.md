# GraphQL Kotlin — Semantic Summary

## Core Model
- Schema = typed contract between client and server; clients request exactly the fields they need
- Resolver = function responsible for one field; each field resolved independently
- DataLoader = per-request batching layer; aggregates field-level loads into one batch call

## Key Concepts
- **Schema**: SDL types (scalar/object/enum/interface/union/input); non-null (`!`); Query/Mutation/Subscription root types
- **Resolvers**: one function per field; resolved depth-first per query; partial response = some fields resolved, some with errors
- **graphql-kotlin**: code-first (Kotlin classes → schema); `@GraphQLQuery`/`@GraphQLMutation`; suspend resolvers for non-blocking IO
- **Context**: `GraphQLContext` carries per-request state (auth, locale, DataLoader registry); injected via function parameter
- **Custom scalars**: `@GraphQLScalar` + `Coercing<>` interface; needed for Date/UUID/Money types
- **DataLoader**: KotlinDataLoader<K, V>; `batchLoadSuspend()` called once per batch per request; resolves N+1
- **Federation**: Apollo Federation v2; `@key` marks entity identifier; `@external` declares fields from other subgraphs; `@requires` for computed fields; entity resolver (`__resolveReference`) fetches entity by key
- **Error handling**: `DataFetcherExceptionHandler` for custom error formatting; partial response allowed (data + errors coexist)

## Important Invariants
- DataLoader batches within a single request only — not across requests
- `@key` fields must uniquely identify the entity in the owning subgraph
- suspend resolvers must NOT call `runBlocking` (blocks carrier thread in coroutine context)
- Global DataLoader instance breaks per-request isolation (stale data, cross-request leakage)
- Federation `__resolveReference` is called with the `@key` field value only — must not assume other fields are available
- Subscription resolvers return `Flow<T>`, not a single value

## Common Pitfalls
- N+1 without DataLoader: each resolver independently queries DB for related entities
- Global DataLoader: register per-request in DataLoaderRegistry, not as Spring singleton
- Missing `@key` on federated type → entity cannot be resolved by router
- Blocking IO in resolver on Default dispatcher → starves CPU thread pool
- Returning exceptions instead of errors → unformatted stacktrace in response

## Related Modules
- `spring-frameworks` — Spring Boot integration, @Controller, suspend support, Security filter chain for GraphQL endpoint
- `system-design` — JWT/OAuth2 for GraphQL endpoint protection; Saga/Outbox for mutation side effects
