def next_weight(current, reps, rep_max, increment):
    if reps >= rep_max:
        return current + increment
    return current