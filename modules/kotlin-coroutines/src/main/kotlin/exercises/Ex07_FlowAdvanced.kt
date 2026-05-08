package exercises

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking

/**
 * УПРАЖНЕНИЕ 7: Flow Advanced — StateFlow и SharedFlow
 *
 * Задание 1: Реализуй `CounterViewModel` со `StateFlow<Int>`:
 *              - публичное свойство `state: StateFlow<Int>`,
 *              - метод `inc()` — атомарно увеличивает счётчик (под высокой
 *                конкуренцией не должен терять обновления),
 *              - метод `reset()` — выставляет 0.
 *
 * Задание 2: Реализуй `EventBus` с `SharedFlow<Event>`:
 *              - replay = 1 (поздний подписчик получит последнее событие),
 *              - extraBufferCapacity = 64,
 *              - onBufferOverflow = SUSPEND,
 *              - метод `emit(Event)` (suspend) и публичный read-only `events`.
 *
 * Задание 3: Реализуй `composedState(scope, profile, network): StateFlow<UiState>` —
 *            комбинирует два input StateFlow в одно состояние через `combine` и
 *            `stateIn(scope, WhileSubscribed(5_000), UiState.empty)`.
 *
 * Задание 4: В `main` продемонстрируй:
 *              - 100 параллельных корутин делают inc(); итоговое state.value == 100,
 *              - поздний подписчик к EventBus получает последний emit'ed event.
 *
 * Запуск: mvn exec:java -Dexec.mainClass="exercises.Ex07_FlowAdvancedKt"
 */

sealed class Event {
    data class Login(val userId: Long) : Event()
    data class Logout(val userId: Long) : Event()
    data class Error(val msg: String) : Event()
}

data class UiState(val profile: String, val online: Boolean) {
    companion object { val empty = UiState("", false) }
}

class CounterViewModel {
    val state: StateFlow<Int> = TODO("Создать MutableStateFlow(0) и asStateFlow")
    fun inc() { TODO("Атомарное обновление через update { }") }
    fun reset() { TODO("set value to 0") }
}

class EventBus {
    val events: SharedFlow<Event> = TODO("MutableSharedFlow(replay=1, extraBufferCapacity=64)")
    suspend fun emit(e: Event) { TODO("emit в внутренний MutableSharedFlow") }
}

fun composedState(
    scope: CoroutineScope,
    profile: StateFlow<String>,
    network: StateFlow<Boolean>,
): StateFlow<UiState> {
    TODO("combine + stateIn(scope, WhileSubscribed(5_000), UiState.empty)")
}

fun main() = runBlocking {
    val vm = CounterViewModel()
    val jobs = (1..100).map { launch { vm.inc() } }
    jobs.forEach { it.join() }
    println("counter = ${vm.state.value} (expected 100)")
}
