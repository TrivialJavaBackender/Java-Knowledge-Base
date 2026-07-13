# Go — Semantic Summary

## Core Model
- Go = compiled, statically-typed, GC'd language; concurrency via goroutines + channels (CSP)
- Composition over inheritance: no classes, structural (implicit) interfaces, embedding
- Errors are values (explicit `if err != nil`), not exceptions; panic/recover only for unrecoverable bugs
- Runtime: M:N GMP scheduler over OS threads; concurrent non-moving tri-color GC

## Key Concepts
- **Types**: structs + methods (value/pointer receiver), embedding (method promotion); small interfaces, implicit implementation
- **Interface value** = (itab/type word, data pointer); nil only if both words nil
- **Slices**: header (ptr/len/cap); `append` may alias backing array; maps randomized iteration; nil-map write panics
- **Concurrency**: goroutines cheap; unbuffered channel = rendezvous; only sender closes; `select`; `context` for cancellation; sync/atomic
- **Generics** (1.18): type params + constraints (`comparable`, `~`underlying); GC-shape stenciling + dictionaries (not erasure)
- **Runtime**: GMP (P = GOMAXPROCS), work-stealing, async preemption (1.14), netpoller; happens-before via channels/mutex/Once
- **Stdlib**: io.Reader/Writer composition; encoding/json struct tags; net/http Handler + middleware

## Important Invariants
- Interface is nil only when both type and value are nil (typed-nil `!= nil`)
- Only the sender closes a channel; send/close on a closed channel panics
- `defer` args evaluated at defer-time; `defer` runs at function (not loop) exit
- Unexported struct fields are not JSON-serialized; nil-map write panics
- `-race` clean is mandatory for concurrent code; shared mutable state needs sync

## Common Pitfalls
- typed-nil error returned as `error` compares `!= nil`
- `append` corrupting a shared backing array (use three-index slice `s[a:b:b]`)
- goroutine leak (blocked send/receive without ctx/done signal)
- `defer` in a loop accumulating until the function returns
- copying a `Mutex`/`WaitGroup` by value
- `len(string)` counts bytes, not runes

## Related Modules
- `concurrency` — JVM threads/JMM; virtual threads (M:N parallel to GMP)
- `java-core` — JVM GC (general tri-color); Java generics erasure (contrast)
- `software-engineering` — testing pyramid (Go testing tooling is module-owned)
- `system-design` — HTTP protocol theory (net/http usage is module-owned)
