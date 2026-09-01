# Interview Questions — Spring Frameworks

## Spring Core / DI / IoC

**Q1. В чём разница между IoC и DI?**

IoC (Inversion of Control) — принцип: управление жизненным циклом объектов передаётся контейнеру. DI (Dependency Injection) — конкретная реализация IoC: зависимости передаются объекту извне (через конструктор, setter или поле). DI — это один из способов реализовать IoC.

> theory/SPRING_CORE_DI.md §2

**Q2. Почему constructor injection предпочтительнее field injection?**

- `final` поля — иммутабельность, защита от NPE
- Явные зависимости в сигнатуре — видно без чтения тела класса
- Тестируется без Spring: `new Service(mockA, mockB)`
- Spring обнаруживает circular dependencies при старте, не в рантайме
- Field injection требует рефлексии, обходит инкапсуляцию

> theory/SPRING_CORE_DI.md §3

**Q3. Что такое Bean Scope? Какие бывают?**

Scope определяет, сколько экземпляров бина создаёт контейнер:
- `singleton` (дефолт) — один на ApplicationContext
- `prototype` — новый при каждом запросе из контейнера
- `request` — один на HTTP-запрос (только Web)
- `session` — один на HTTP-сессию
- `application` — один на ServletContext

Проблема: prototype в singleton — singleton всегда получает один и тот же prototype. Решение: `ObjectFactory<T>` или `Provider<T>`.

> theory/SPRING_CORE_DI.md §5

**Q4. Как работает AOP в Spring? Что такое self-invocation проблема?**

Spring AOP реализован через прокси (CGLIB или JDK Proxy). При вызове метода извне — прокси перехватывает вызов и применяет advice (@Transactional, @Cacheable и т.д.). Self-invocation — вызов метода из того же класса (`this.method()`) обходит прокси → `@Transactional`, `@Cacheable` не работают. Решение: вынести метод в другой бин или получить ссылку на прокси через `AopContext.currentProxy()`.

> theory/SPRING_CORE_DI.md §7

**Q5. Как Spring обнаруживает и разрешает Circular Dependencies?**

При constructor injection — бросает `BeanCurrentlyInCreationException` при старте (до рантайма). При field/setter injection — может разрешить через ранние ссылки (early references). Решения: рефакторинг (чаще всего — нарушение SRP), `@Lazy`, setter injection, выделение общего третьего бина.

> theory/SPRING_CORE_DI.md §9

**Q18. Почему вызов `@Transactional`-метода того же бина из его собственного `@PostConstruct` не откроет транзакцию?**

AOP-прокси создаётся в `BeanPostProcessor#postProcessAfterInitialization` — это шаг жизненного цикла, который выполняется **после** `@PostConstruct`/`InitializingBean`. Внутри `@PostConstruct` `this` — ещё сырой, непроксированный объект: Spring просто не успел создать прокси к этому моменту. Вызов `this.transactionalMethod()` из `@PostConstruct` — обычный Java-вызов на реальном объекте, минующий любые advice (`@Transactional`, `@Cacheable`, `@Async`), даже если снаружи бин, который вернул контейнер, уже проксирован. Это тот же self-invocation эффект, но обнаружить его тяжелее — код выглядит так, будто он должен работать.

> theory/SPRING_CORE_DI.md §6

**Q19. Почему `@TransactionalEventListener(phase = AFTER_COMMIT)` используют вместо обычного `@EventListener` для отправки email после сохранения заказа?**

Обычный `@EventListener` выполняется **синхронно**, в момент вызова `publisher.publishEvent()` — то есть ещё до commit транзакции. Если после публикации события код внутри того же `@Transactional`-метода бросит исключение и транзакция откатится, письмо уже уйдёт клиенту про заказ, которого нет в БД. `AFTER_COMMIT` откладывает вызов слушателя до момента, когда Spring подтвердит, что транзакция успешно закоммичена — гарантия «письмо только если заказ реально сохранён». Если вызывающий код не в транзакции вовсе, такой listener тихо не сработает — это нужно проверять отдельно.

> theory/SPRING_CORE_DI.md §8

---

## Spring Boot & Auto-Configuration

**Q6. Как работает Auto-Configuration в Spring Boot?**

`@EnableAutoConfiguration` сканирует `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports` во всех jar в classpath. Каждый класс авто-конфигурации аннотирован `@Conditional*` — применяется только при выполнении условий (например, `@ConditionalOnClass(DataSource.class)` + `@ConditionalOnMissingBean`). Это позволяет пользователю переопределить любой бин, зарегистрировав свой.

> theory/SPRING_BOOT.md §3

**Q7. Что такое Spring Boot Starter? Как устроен изнутри?**

Starter — Maven/Gradle артефакт, содержащий только `pom.xml` с транзитивными зависимостями. Логика авто-конфигурации находится в отдельных `*-autoconfigure` артефактах. Например, `spring-boot-starter-web` транзитивно подтягивает spring-webmvc, embedded Tomcat, Jackson и активирует `WebMvcAutoConfiguration`.

> theory/SPRING_BOOT.md §2

**Q8. Как отладить авто-конфигурацию?**

Запустить с `--debug` или `debug=true` в application.properties. Spring выведет `CONDITIONS EVALUATION REPORT` с перечнем: какие авто-конфигурации применились (Positive matches), какие нет (Negative matches) и почему.

> theory/SPRING_BOOT.md §3

**Q20. Почему аргументы командной строки и переменные окружения имеют более высокий приоритет, чем `application.properties`, и почему это важно для Docker/K8s?**

Spring Boot строит конфигурацию из нескольких источников с чёткой иерархией: CLI-аргументы и ENV — выше, чем файлы `application*.properties`. Смысл — конфигурация, заданная **снаружи** приложения (при запуске контейнера), должна иметь возможность переопределить что угодно, зашитое **внутри** артефакта, без пересборки образа. В Kubernetes конфигурация (порт, URL БД, feature-флаги) обычно приходит через ConfigMap/Secret как переменные окружения одного и того же Docker-образа для разных сред (dev/staging/prod) — если бы файл внутри jar побеждал, пришлось бы собирать отдельный образ под каждое окружение. Relaxed binding (`SPRING_DATASOURCE_URL` ≡ `spring.datasource.url`) существует по той же причине: ENV-переменные в K8s пишут в UPPER_SNAKE_CASE, а Spring должен сопоставить их с dot-notation свойств без дополнительной настройки.

> theory/SPRING_BOOT.md §4

---

## Spring Data JPA & Hibernate

**Q9. Что такое N+1 проблема и как её решить?**

При загрузке списка сущностей с LAZY связью: 1 запрос за список + N запросов за каждую связь. Решения:
1. `JOIN FETCH` в JPQL — один запрос со JOIN
2. `@EntityGraph` — аналогично, но декларативно
3. `@BatchSize(size = N)` — загружает пачками IN (...) вместо по одному
4. DTO projection через `new ClassName(...)` в JPQL — самый эффективный, только нужные поля

> theory/SPRING_DATA_JPA.md §6

**Q10. Опиши три уровня кэширования в Hibernate.**

- **L1 (First Level)** — всегда включён, область: одна Session. Гарантирует идентичность объектов внутри транзакции. При повторном `findById` — SQL не выполняется.
- **L2 (Second Level)** — опциональный, область: SessionFactory (всё приложение). Реализации: EHCache, Caffeine, Infinispan. Настраивается через `@Cache(usage = CacheConcurrencyStrategy.READ_WRITE)`. Инвалидируется при save/delete сущности.
- **Query Cache** — кэширует список ID результатов JPQL/HQL запросов. Требует L2. Инвалидируется при любом изменении таблицы.

**Q11. Что делает @Transactional и что такое Propagation?**

`@Transactional` через AOP-прокси оборачивает метод: начинает транзакцию до вызова, коммитит после, откатывает при `RuntimeException`. Propagation определяет поведение при вызове из уже существующей транзакции:
- `REQUIRED` (дефолт) — использует текущую или создаёт новую
- `REQUIRES_NEW` — всегда создаёт новую, текущую приостанавливает
- `NESTED` — создаёт savepoint, откат только до savepoint
- `SUPPORTS` — использует если есть, без транзакции если нет

> theory/SPRING_DATA_JPA.md §5

**Q12. Чем отличается Optimistic от Pessimistic Locking в Spring Data?**

**Optimistic** (`@Version`): Hibernate добавляет `WHERE version = ?` к UPDATE. Если версия изменилась — `OptimisticLockException`. Нет блокировки в БД, подходит для высокой конкурентности при редких конфликтах.

**Pessimistic** (`@Lock(PESSIMISTIC_WRITE)`): генерирует `SELECT ... FOR UPDATE`. Блокирует строку в БД до commit. Подходит при высокой вероятности конфликта (финансовые операции).

> theory/SPRING_DATA_JPA.md §8

**Q21. Как Hibernate узнаёт, что нужно сгенерировать UPDATE после `user.setEmail(newEmail)`, если `repo.save(user)` не вызывался?**

Это **dirty checking**. Пока сущность в состоянии Managed (загружена внутри активной транзакции/сессии), Hibernate при загрузке снимает snapshot — копию значений всех полей. Перед flush (обычно перед commit) Hibernate проходит по всем managed-объектам в Persistence Context и сравнивает текущее состояние со snapshot поле за полем; для изменившихся полей генерирует `UPDATE`. `save()` в этом сценарии не нужен — управляемый объект и так отслеживается. Обратная сторона: это сравнение стоит времени и памяти пропорционально числу managed-объектов в сессии, поэтому большие read-heavy транзакции с тысячами загруженных сущностей стоит держать read-only (`@Transactional(readOnly = true)`, что отключает dirty checking) или явно `detach`-ить то, что не нужно изменять.

> theory/SPRING_DATA_JPA.md §2

**Q22. Почему `spring.jpa.open-in-view=true` (дефолт в Spring Boot) считается плохой практикой, хотя он и устраняет `LazyInitializationException`?**

OSIV держит Hibernate-сессию открытой на протяжении **всего HTTP-запроса**, а не только внутри `@Transactional`-метода сервиса — поэтому lazy-поля можно спокойно читать даже в контроллере или при сериализации в JSON. Цена: 1) ленивые связи, случайно задетые в слое представления (например, сериализатор дёрнул `order.getItems()`), превращаются в скрытые N+1-запросы, которые не видно при code review сервисного слоя; 2) соединение с БД удерживается на всё время запроса, включая рендеринг ответа и сетевые задержки клиента — под нагрузкой это быстро исчерпывает connection pool. Явный контроль (держать нужные данные в транзакции сервиса или `JOIN FETCH` их сразу) не даёт скрытым обращениям маскироваться под «просто работает», и требует явно решать, что должно быть загружено, а не полагаться на то, что сессия ещё жива.

> theory/SPRING_DATA_JPA.md §3

---

## Spring MVC & REST

**Q23. Зачем Spring MVC использует единственный `DispatcherServlet` вместо того, чтобы каждый контроллер регистрировался как отдельный Servlet?**

`DispatcherServlet` — реализация паттерна Front Controller: вся инфраструктура запроса (сопоставление URL с методом через `HandlerMapping`, разрешение аргументов через `HandlerAdapter`, (де)сериализация тела через `HttpMessageConverter`, обработка ошибок) сосредоточена в одном месте, а не дублируется в каждом отдельном servlet. Это даёт единую точку для cross-cutting concerns (логирование, security, форматирование ошибок) и позволяет добавлять новые `@RestController` классы просто как бины — `DispatcherServletAutoConfiguration` регистрирует один `DispatcherServlet` на `/*` один раз, никакой ручной регистрации в `web.xml` под каждый контроллер не требуется.

> theory/SPRING_MVC_REST.md §1

**Q24. Когда обязательно использовать `ResponseEntity`, а не декларативный `@ResponseStatus`?**

`@ResponseStatus` фиксирует HTTP-статус **на этапе компиляции** — он одинаков для любого успешного выполнения метода. Как только статус ответа зависит от **результата** операции (нашли ресурс — 200, не нашли — 404; создали — 201 с `Location`-заголовком; конфликт версий — 409), фиксированной аннотации недостаточно: нужен `ResponseEntity`, который собирается программно внутри метода и может нести разные статусы, заголовки и тело в зависимости от того, что вернул сервис. `@ResponseStatus` оправдан только когда результат метода всегда мапится в один и тот же статус (например, `DELETE` → всегда 204, если не выброшено исключение).

> theory/SPRING_MVC_REST.md §2

**Q25. Как Spring выбирает `HttpMessageConverter` для ответа и почему запрос с `Accept: text/html` может получить 406 при том что данные точно есть?**

Spring выбирает конвертер через Content Negotiation: смотрит на заголовок `Accept` запроса и сопоставляет его с `produces` эндпоинта (и вообще со списком зарегистрированных конвертеров). Если эндпоинт объявлен как `produces = {APPLICATION_JSON, APPLICATION_XML}`, а клиент прислал `Accept: text/html` — ни один зарегистрированный конвертер не может отдать `text/html` для этого метода, и Spring возвращает `406 Not Acceptable` **до** вызова метода контроллера: это ошибка на уровне согласования формата, а не отсутствия данных. Наличие данных не имеет значения — сервер физически не может ответить в формате, который просит клиент.

> theory/SPRING_MVC_REST.md §3

**Q26. Зачем в `@RestControllerAdvice` держать fallback `@ExceptionHandler(Exception.class)`, если для каждого бизнес-исключения уже есть отдельный обработчик?**

Без fallback-обработчика любое исключение, не предусмотренное явно (NPE от бага, таймаут БД, любая непредвиденная ошибка), долетает до дефолтного обработчика Spring Boot (`DefaultErrorAttributes`) — тот отдаёт JSON другой формы (`timestamp`, `status`, `error`, `path`), чем ошибки, обработанные твоим `@RestControllerAdvice`. Для клиента API это означает два разных контракта ошибок в одном сервисе: предсказуемый `{code, message}` для ожидаемых случаев и неожиданный формат — для всего остального. Fallback-обработчик держит контракт ошибок единообразным всегда и даёт единое место для логирования непредвиденных исключений с контекстом запроса (`request.getRequestURI()`), а не полагается на то, что дефолтный обработчик Spring Boot залогирует то же самое.

> theory/SPRING_MVC_REST.md §4

**Q27. Зачем нужны Validation Groups (`@Validated(OnCreate.class)`), если для простых случаев достаточно обычного `@Valid`?**

Обычный `@Valid` применяет constraints **безусловно**, одинаково в любом контексте использования DTO. Но одна и та же форма часто нужна и для создания, и для обновления ресурса с разными правилами: `id` должен отсутствовать при создании и быть обязательным при обновлении, часть полей — required при создании, но опциональна при partial update. Без групп пришлось бы заводить два почти одинаковых DTO или писать ручную валидацию в сервисе. Validation Groups позволяют пометить constraint принадлежностью к сценарию (`@NotNull(groups = OnUpdate.class)`) и активировать нужный набор через `@Validated(OnCreate.class)` на конкретном эндпоинте — один DTO, разные профили валидации.

> theory/SPRING_MVC_REST.md §5

**Q28. Почему Spring Security реализован как Servlet Filter, а не как `HandlerInterceptor`?**

`HandlerInterceptor` работает **внутри** Spring MVC — он вызывается только после того, как `DispatcherServlet` уже выбрал `HandlerMapping` и определил, какой контроллер обслужит запрос. Если требуется заблокировать неаутентифицированный запрос ещё до того, как Spring MVC вообще разберётся, к какому обработчику он относится (включая запросы к статике, несуществующим маршрутам, или до того как сработает CORS-preflight) — `HandlerInterceptor` для этого физически непригоден. Servlet Filter работает на уровне контейнера, видит сырой `HttpServletRequest` до входа в Spring MVC вообще, может полностью оборвать цепочку (вернуть 401/403), не тратя ресурсы на маршрутизацию. Это и есть требование к security-механизму: перехватывать раньше, чем фреймворк решит, что делать с запросом.

> theory/SPRING_MVC_REST.md §6

**Q29. Почему CORS-конфигурация через `WebMvcConfigurer.addCorsMappings()` не срабатывает, если в приложении подключён Spring Security?**

Spring Security — Servlet Filter, который стоит **перед** `DispatcherServlet` в цепочке фильтров, и по умолчанию требует аутентификации на `anyRequest()`. Browser-preflight запрос (`OPTIONS`) не несёт учётных данных — Security перехватывает и блокирует его (401/403) раньше, чем запрос вообще доходит до Spring MVC и его `CorsFilter`/`WebMvcConfigurer`, которые настроены на уровне MVC. Правильное место для CORS при включённом Security — сам `HttpSecurity` (`http.cors(cors -> cors.configurationSource(...))`), потому что тогда правило применяется на том же уровне фильтров, что и сама Security, и preflight-запрос будет разрешён до применения остальных правил авторизации.

> theory/SPRING_MVC_REST.md §7

**Q30. Почему `@WebMvcTest` требует `@MockBean` для сервисов, хотя `@SpringBootTest` этого не требует?**

`@WebMvcTest` — слайс-тест: поднимает только компоненты web-слоя (контроллеры, `@RestControllerAdvice`, фильтры, `HttpMessageConverter`, конфигурацию Bean Validation), не поднимая `@Service`/`@Repository`/слой доступа к БД. Смысл — быстро проверить именно MVC-механику (маппинг URL, сериализацию, статус-коды, валидацию тела запроса) без накладных расходов на поднятие всего контекста приложения и БД. Раз бины сервисного слоя не создаются вообще, любая зависимость контроллера, которую Spring должен внедрить, обязана быть подставлена как мок (`@MockBean`) — иначе контейнер просто не найдёт бин для внедрения и тест не поднимется.

> theory/SPRING_MVC_REST.md §8

---

## Spring Security

**Q13. Как устроена цепочка фильтров в Spring Security?**

`DelegatingFilterProxy` (Servlet Filter) делегирует в `FilterChainProxy`, который выбирает подходящую `SecurityFilterChain`. Запрос проходит через фильтры по порядку: аутентификация (UsernamePasswordAuthenticationFilter, BearerTokenAuthenticationFilter) → `ExceptionTranslationFilter` → `AuthorizationFilter`. Любой фильтр может прервать цепочку.

> theory/SPRING_SECURITY.md §2

**Q14. Что такое SecurityContext и почему важно его propagation?**

`SecurityContext` хранится в `SecurityContextHolder` через **ThreadLocal** — привязан к текущему потоку. При `@Async` — новый поток не имеет доступа к контексту. Решение: `DelegatingSecurityContextAsyncTaskExecutor` или `DelegatingSecurityContextExecutor` для propagation контекста в другие потоки.

> theory/SPRING_SECURITY.md §4

**Q15. Когда нужен CSRF и когда нет?**

CSRF нужен для stateful-приложений с cookie-аутентификацией (браузер автоматически отправляет cookie). Для REST API с JWT в `Authorization: Bearer` заголовке — CSRF **не нужен**: браузер не добавляет заголовки автоматически. Поэтому `.csrf(AbstractHttpConfigurer::disable)` корректен для stateless REST API.

> theory/SPRING_SECURITY.md §10

**Q31. Что произойдёт, если в `authorizeHttpRequests` поставить `.anyRequest().authenticated()` перед `.requestMatchers("/api/admin/**").hasRole("ADMIN")`?**

Правила в `authorizeHttpRequests` проверяются **по порядку**, и побеждает первое совпавшее — как цепочка `if/else if`, а не поиск наиболее специфичного правила. `anyRequest()` совпадает вообще со всем, поэтому если поставить его раньше, оно перехватит запросы к `/api/admin/**` первым: правило `hasRole("ADMIN")` окажется мёртвым кодом, до которого выполнение никогда не дойдёт, и любой аутентифицированный пользователь (не только ADMIN) получит доступ к админ-эндпоинтам. Правило: от **самого специфичного** матчера — к самому общему, `anyRequest()` — всегда последним.

> theory/SPRING_SECURITY.md §5

**Q32. Зачем нужен `DelegatingPasswordEncoder`, если можно напрямую использовать `BCryptPasswordEncoder`?**

Хэш-алгоритм для паролей со временем устаревает (растёт вычислительная мощность атакующих) — рано или поздно понадобится мигрировать на более сильный алгоритм (например, с BCrypt на Argon2) или просто увеличить cost factor. Проблема: в БД уже лежат миллионы хэшей, посчитанных старым способом, и их нельзя пересчитать без исходного пароля. `DelegatingPasswordEncoder` решает это префиксом в самом хэше (`{bcrypt}$2a$...`, `{pbkdf2}...`): при проверке пароля он смотрит на префикс и выбирает **тот** алгоритм, которым хэш был посчитан, а новые пароли всегда хэширует текущим (дефолтным) кодировщиком. Это даёт алгоритмическую гибкость (algorithm agility) без миграции всей базы разом — старые пользователи продолжают логиниться, новые получают более сильный хэш.

> theory/SPRING_SECURITY.md §9

---

## Spring Cloud

**Q16. Зачем нужен @RefreshScope и как он работает?**

`@RefreshScope` помечает бин для пересоздания при обновлении конфигурации. При вызове `/actuator/refresh` Spring уничтожает бин и создаёт новый с обновлёнными значениями `@Value` из Config Server. Без `@RefreshScope` — бин создаётся один раз, значения не обновляются.

> theory/SPRING_CLOUD.md §2

**Q17. Как Circuit Breaker защищает от каскадных сбоев?**

CB отслеживает последние N вызовов. При превышении порога ошибок (failureRateThreshold) переходит в OPEN — все вызовы немедленно возвращают fallback (нет запросов к упавшему сервису). После паузы (waitDurationInOpenState) — HALF_OPEN: пропускает несколько пробных запросов. Если успешны → CLOSED, иначе → снова OPEN. Это предотвращает перегрузку нестабильного сервиса и быстро возвращает ответ клиенту.

> theory/SPRING_CLOUD.md §6

**Q33. Почему в `UserClientFallback` для `getUser()` возвращается дефолтный объект, а для `createUser()` — пробрасывается исключение вместо ещё одного дефолта?**

Стратегия fallback зависит от семантики операции. `getUser()` — чтение: вернуть placeholder (`UserDto.unknown(id)`) безопасно, потому что никакого побочного эффекта и так не ожидалось — вызывающий код деградирует до неполных данных, но не лжёт о состоянии системы. `createUser()` — запись: подставить фиктивный «успешный» ответ означало бы соврать, что пользователь создан, хотя на самом деле запрос до сервиса не дошёл — это несогласованность данных, которую вызывающий код не сможет обнаружить. Поэтому для мутирующих операций fallback должен **явно проваливаться** (бросать исключение), чтобы Circuit Breaker и вызывающий код знали, что операция не выполнена, и могли решить, ретраить её или показать ошибку — не выдумывать успех.

> theory/SPRING_CLOUD.md §4
