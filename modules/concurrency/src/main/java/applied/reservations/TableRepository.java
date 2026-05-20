package applied.reservations;

import java.util.List;

public class TableRepository {

    private List<RestaurantTable> tables = List.of(
            new RestaurantTable(1, 4),
            new RestaurantTable(2, 8),
            new RestaurantTable(3, 6)
    );

    public List<RestaurantTable> findAll() {
        return tables;
    }

    public List<RestaurantTable> findAllByMoreThatEqualsPersons(Integer maxPersons) {
        return tables.stream().filter(t -> t.getMaxPersons() >= maxPersons).toList();
    }


}
