package applied.reservations;

public class RestaurantTable {

    private Integer id;
    private Integer maxPersons;


    public RestaurantTable(Integer id, Integer maxPersons) {
        this.id = id;
        this.maxPersons = maxPersons;
    }

    public Integer getId() {
        return id;
    }

    public void setId(Integer id) {
        this.id = id;
    }

    public Integer getMaxPersons() {
        return maxPersons;
    }

    public void setMaxPersons(Integer maxPersons) {
        this.maxPersons = maxPersons;
    }
}
