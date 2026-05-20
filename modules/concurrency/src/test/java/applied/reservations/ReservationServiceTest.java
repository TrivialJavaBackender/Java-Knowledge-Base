package applied.reservations;

import applied.reservations.*;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

public class ReservationServiceTest {

    private static ReservationService newInstance() {
        return new ReservationService(new ReservationRepository(), new TableRepository());
    }

    @Test
    public void testReserve() {
        ReservationService reservationService = newInstance();
        reservationService.makeReservation(
                LocalDate.now(),
                new TimeSlot(LocalTime.of(10, 0), LocalTime.of(11, 0)),
                1, 4);
        reservationService.makeReservation(
                LocalDate.now(),
                new TimeSlot(LocalTime.of(11, 0), LocalTime.of(12, 0)),
                1, 4);
        assertThrows(RuntimeException.class, () -> reservationService.makeReservation(
                LocalDate.now(),
                new TimeSlot(LocalTime.of(9, 30), LocalTime.of(10, 30)),
                1, 4));

        List<Reservation> reservations = reservationService.getAllReservations(LocalDate.now());
        assertEquals(2, reservations.size());
        System.out.println(reservations);
        Map<Integer, List<TimeSlot>> timeSlots = reservationService.getAvailableTimeSlotsForDateAndPersons(LocalDate.now(), 4);
        timeSlots.forEach((tableId, timeSlot) -> System.out.println(tableId + " " + timeSlot));
    }


}
