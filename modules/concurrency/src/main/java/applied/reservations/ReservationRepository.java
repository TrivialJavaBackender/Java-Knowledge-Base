package applied.reservations;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

public class ReservationRepository {

    private List<Reservation> reservations = new ArrayList<>();

    public List<Reservation> findAllReservationsOnDate(LocalDate date) {
        return reservations.stream().filter(r -> r.getReservationDate().equals(date)).toList();
    }

    public void saveReservation(Reservation reservation) {
        reservations.add(reservation);
    }

    public void removeReservation(UUID id) {
        reservations.removeIf(r -> r.getId().equals(id));
    }

}
