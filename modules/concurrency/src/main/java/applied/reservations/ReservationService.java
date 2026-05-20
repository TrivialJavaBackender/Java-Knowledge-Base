package applied.reservations;

import java.time.Duration;
import java.time.LocalDate;
import java.util.*;
import java.util.stream.Collectors;

public class ReservationService {

    private final ReservationRepository reservationRepository;
    private final TableRepository tableRepository;

    public ReservationService(ReservationRepository reservationRepository, TableRepository tableRepository) {
        this.reservationRepository = reservationRepository;
        this.tableRepository = tableRepository;
    }

    public Map<Integer, List<TimeSlot>> getAvailableTimeSlotsForDateAndPersons(LocalDate date, Integer maxPersons) {
        List<Reservation> reservations = reservationRepository.findAllReservationsOnDate(date);
        Set<Integer> tablesIds = tableRepository.findAllByMoreThatEqualsPersons(maxPersons)
                .stream()
                .map(RestaurantTable::getId)
                .collect(Collectors.toSet());
        Map<Integer, List<Reservation>> reservationsPerTable = reservations.stream()
                .filter(reservation -> tablesIds.contains(reservation.getTableId()))
                .sorted(Comparator.comparing(Reservation::getReservationTime))
                .collect(Collectors.groupingBy(Reservation::getTableId));

        return tablesIds.stream()
                .map(e -> Map.entry(e, splitTimeSlotsByReservations(reservationsPerTable.getOrDefault(e, List.of()))))
                .collect(Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue));
    }

    public void makeReservation(LocalDate date, TimeSlot timeSlot, Integer tableId, Integer persons) {
        List<TimeSlot> tableTimeSlots = getAvailableTimeSlotsForDateAndPersons(date, persons).getOrDefault(tableId, List.of());
        boolean hasAvailable = tableTimeSlots.stream()
                .anyMatch(ts -> !ts.getStartAt().isAfter(timeSlot.getStartAt()) && !ts.getEndAt().isBefore(timeSlot.getEndAt()));
        if (!hasAvailable) {
            throw new RuntimeException("No available time slots");
        }
        reservationRepository.saveReservation(new Reservation(tableId, date, timeSlot.getStartAt(), Duration.between(timeSlot.getStartAt(), timeSlot.getEndAt())));
    }


    public List<Reservation> getAllReservations(LocalDate date) {
        return reservationRepository.findAllReservationsOnDate(date);
    }

    public List<TimeSlot> splitTimeSlotsByReservations(List<Reservation> reservations) {
        Stack<TimeSlot> stack = new Stack<>();
        stack.add(TimeSlot.defaultTimeSlot());
        for (Reservation reservation : reservations) {
            TimeSlot ts = stack.pop();
            List<TimeSlot> splitted = ts.splitTimeSlot(
                    new TimeSlot(reservation.getReservationTime(), reservation.getReservationTime().plus(reservation.getReservationDuration())
                    ));
            stack.addAll(splitted);
        }
        return new ArrayList<>(stack);
    }

}
