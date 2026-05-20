package applied.reservations;

import java.time.LocalTime;
import java.util.List;
import java.util.stream.Stream;

public class TimeSlot {

    private final LocalTime startAt;
    private final LocalTime endAt;

    public TimeSlot(LocalTime startAt, LocalTime endAt) {
        this.startAt = startAt;
        this.endAt = endAt;
    }

    public LocalTime getStartAt() {
        return startAt;
    }

    public LocalTime getEndAt() {
        return endAt;
    }

    public static TimeSlot defaultTimeSlot() {
        return new TimeSlot(LocalTime.of(9, 0), LocalTime.of(23, 0));
    }

    public List<TimeSlot> splitTimeSlot(TimeSlot other) {
        if (!other.startAt.isBefore(endAt)) {
            return List.of(this);
        } else if (!other.endAt.isAfter(startAt)) {
            return List.of(this);
        } else {
            return Stream.of(new TimeSlot(startAt, other.startAt), new TimeSlot(other.endAt, endAt))
                    .filter(ts -> !ts.getStartAt().equals(ts.endAt))
                    .toList();
        }
    }

    @Override
    public String toString() {
        return "TimeSlot{" +
                "startAt=" + startAt +
                ", endAt=" + endAt +
                '}';
    }
}
