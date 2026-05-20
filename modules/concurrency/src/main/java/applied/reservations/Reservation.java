package applied.reservations;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.UUID;

public class Reservation {

    private UUID id;
    private Integer tableId;
    private LocalDate reservationDate;
    private LocalTime reservationTime;
    private Duration reservationDuration;

    public Reservation(Integer tableId, LocalDate reservationDate, LocalTime reservationTime, Duration reservationDuration) {
        this.id = UUID.randomUUID();
        this.tableId = tableId;
        this.reservationDate = reservationDate;
        this.reservationTime = reservationTime;
        this.reservationDuration = reservationDuration;
    }

    public UUID getId() {
        return id;
    }

    public Integer getTableId() {
        return tableId;
    }

    public void setTableId(Integer tableId) {
        this.tableId = tableId;
    }

    public LocalDate getReservationDate() {
        return reservationDate;
    }

    public void setReservationDate(LocalDate reservationDate) {
        this.reservationDate = reservationDate;
    }

    public LocalTime getReservationTime() {
        return reservationTime;
    }

    public void setReservationTime(LocalTime reservationTime) {
        this.reservationTime = reservationTime;
    }

    public Duration getReservationDuration() {
        return reservationDuration;
    }

    public void setReservationDuration(Duration reservationDuration) {
        this.reservationDuration = reservationDuration;
    }

    @Override
    public String toString() {
        return "Reservation{" +
                "id=" + id +
                ", tableId=" + tableId +
                ", reservationDate=" + reservationDate +
                ", reservationTime=" + reservationTime +
                ", reservationDuration=" + reservationDuration +
                '}';
    }
}
