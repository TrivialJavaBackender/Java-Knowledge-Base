# Spring Frameworks — Semantic Summary

## Core Model
- IoC container creates and wires Beans; application code declares dependencies, container injects them
- AOP proxies wrap Beans; method calls on the proxy trigger advice (cross-cutting logic)
- DispatcherServlet receives all HTTP; delegates to HandlerMapping → Handler → MessageConverter → response
- Filter Chain runs before DispatcherServlet; SecurityFilterChain is a specialized filter chain

## Key Concepts
- **DI / Core**: @Component / @Bean / @Autowired; singleton (default) vs prototype vs request/session scopes; @Conditional; circular dependency resolution limits
- **AOP**: @Aspect + @Around/@Before/@After; proxy-based (JDK dynamic or CGLIB); `this` inside class bypasses proxy
- **Boot**: Auto-Configuration via spring.factories / @AutoConfiguration; Starters aggregate dependencies; Actuator exposes health/metrics
- **MVC/REST**: @RestController + @RequestMapping; HandlerMethodArgumentResolver; @Valid + ConstraintValidator; @ExceptionHandler / @ControllerAdvice
- **Data JPA**: @Entity + @Repository; Spring Data derived queries; @Transactional (propagation: REQUIRED/REQUIRES_NEW/SUPPORTS; isolation); Hibernate L1 (session, always on), L2 (shared, explicit config), Query cache
- **Security**: SecurityFilterChain; Authentication (who) vs Authorization (what); SecurityContextHolder (ThreadLocal); @PreAuthorize / @PostAuthorize; JWT via OncePerRequestFilter; CSRF (stateful), disabled for stateless APIs
- **Cloud**: Eureka (service registry); Spring Cloud Gateway (routing/filtering); OpenFeign (declarative HTTP); Resilience4j Circuit Breaker; Spring Cloud Config (externalized config)

## Important Invariants
- @Transactional on private methods is silently ignored (no proxy dispatch)
- @Transactional calls within the same class bypass the proxy → REQUIRED propagation has no effect
- L1 (EntityManager) cache is always active; dirty check on flush/commit; closed on session end
- L2 cache requires explicit `@Cacheable` on entities and a CacheProvider (e.g., EHCache, Caffeine)
- Filter runs before DispatcherServlet; exceptions inside filters need separate error handling
- SecurityContext defaults to ThreadLocal storage — incompatible with reactive/coroutine pipelines without adaptation

## Common Pitfalls
- N+1 queries: use `JOIN FETCH`, `@EntityGraph`, or `@BatchSize` to prevent
- LazyInitializationException: access lazy association outside session without Open-Session-In-View
- Circular dependencies: constructor injection fails fast; field injection hides them
- @Transactional with REQUIRES_NEW in same class call → no new transaction (proxy bypassed)
- Missing CSRF config: REST APIs with stateless JWT must explicitly disable CSRF

## Related Modules
- `system-design` — auth concepts (OAuth2/JWT protocols), microservice patterns (Saga, Outbox)
- `caching-deep-dive` — JVM caching (Caffeine), HTTP caching, Redis; Hibernate L1/L2 owned here
- `graphql-kotlin` — Spring Boot integration, suspend controller support
- `infrastructure` — Spring Boot Actuator metrics exposed to Prometheus
