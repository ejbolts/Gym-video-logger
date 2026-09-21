from app.exercise_aliases import canonical_exercise_name


def test_known_aliases_use_standardized_exercise_names():
    assert canonical_exercise_name("Bench Press") == "Barbell Bench Press"
    assert canonical_exercise_name("  one   arm cable bicep curl ") == (
        "Single-Arm Cable Biceps Curl"
    )
    assert canonical_exercise_name("machine seated crunch") == "Seated Ab Crunch Machine"
    assert canonical_exercise_name("Machine Tricep Extension") == ("Triceps Machine Extension")


def test_unknown_exercise_names_are_only_whitespace_normalized():
    assert canonical_exercise_name("  My   custom movement ") == "My custom movement"
