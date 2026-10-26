from progression import next_weight


def test_adds_increment_when_top_of_range_hit():
    assert next_weight(current=50, reps=10, rep_max=10, increment=2.5) == 52.5


def test_keeps_weight_when_below_top_of_range():
    assert next_weight(current=50, reps=8, rep_max=10, increment=2.5) == 50