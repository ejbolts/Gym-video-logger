# Cardio fitness score — experimental design

## Product goal

Show one simple score that answers: “Can I sustain more aerobic work with the same cardiovascular cost than I could before?” The score is a personal trend index. It is not a VO2 max estimate, a clinical assessment, or a comparison with other people.

The collapsed Cardio card shows the score, activity source, change from baseline, and confidence. Expanding it shows the three components and the existing cardio totals.

## Why treadmill gradient can replace watts

Watts directly describe external cycling workload. A treadmill does not normally report useful mechanical watts, but its speed and gradient determine the metabolic demand of walking. Research has found that walking oxygen cost can be predicted from speed, grade, and load with high accuracy under controlled conditions. The current draft uses the established ACSM walking equation because its inputs already exist in the app:

```text
speed_m_min = speed_kph × 1000 / 60
grade = incline_percent / 100
estimated_VO2_ml_kg_min = 0.1 × speed_m_min
                           + 1.8 × speed_m_min × grade
                           + 3.5
estimated_METs = estimated_VO2_ml_kg_min / 3.5
```

This value represents estimated workload demand. The feature does not present it as measured oxygen uptake. The draft accepts steady incline-walking sessions from 2.0–6.5 km/h, 0–25% grade, and at least 20 minutes. Outside those bounds it asks for a more suitable activity metric instead of extrapolating.

Sources:

- [Walking economy is predictably determined by speed, grade, and gravitational load](https://pubmed.ncbi.nlm.nih.gov/28729390/)
- [Validation of formulas for horizontal and grade treadmill walking](https://pubmed.ncbi.nlm.nih.gov/4079734/)
- [Real-world walking economy: comparison of laboratory prediction equations](https://pubmed.ncbi.nlm.nih.gov/34410843/)

## Activity-specific workload

The app must build a separate baseline for each activity family. It must never compare treadmill METs directly with cycling watts.

| Activity | Workload input | Efficiency input | Required fields |
| --- | --- | --- | --- |
| Incline treadmill walking | Estimated METs from speed + incline | METs / average HR | duration, average HR, speed, incline |
| Indoor cycling | Average watts | watts / average HR | duration, average HR, average watts |
| Running | Later: speed + grade or reliable pace/power | workload / average HR | needs a separately validated model |
| Rowing / stair climber | Later: watts, pace, or machine level | workload / average HR | machine-specific data needed |

If more than one activity has enough data, calculate each activity score independently and combine the ready activity scores using their recent comparable-session counts. The UI should still expose the activity scores so an improvement in one mode cannot hide a decline in another.

## Workout context

The app also builds separate baselines for **pure cardio** and **workout + cardio**. A linked workout is classified as workout + cardio when it contains at least one strength movement. If the cardio movement appears after a strength movement, its history entry says “After weights.” Cardio that appears before the strength portion remains in the workout + cardio group, but does not receive the “After weights” note.

This separation avoids treating the cardiovascular cost of a fresh cardio session as directly interchangeable with cardio performed under residual lifting fatigue. Prior resistance exercise can change the metabolic demand of subsequent aerobic work, and resistance exercise can keep heart rate elevated into recovery. These effects vary by workout and person, so the draft does not apply a fixed correction factor; it compares like with like instead.

Sources:

- [Effect of preceding resistance exercise on metabolism during subsequent aerobic exercise](https://pubmed.ncbi.nlm.nih.gov/19504118/)
- [Acute resistance exercise effects on heart rate during the following 60 minutes](https://pubmed.ncbi.nlm.nih.gov/25257752/)

## Score construction

The first three complete sessions in each activity-and-context group form the baseline. One later complete session is enough to publish a low-confidence current score, so a user gets feedback from the fourth comparable session. The current window uses up to five subsequent sessions and uses medians to reduce the effect of an unusual workout as more sessions accumulate.

Every eligible historical session also receives a derived score against its group’s first-three-session baseline. The first three are marked as baseline references; later entries show how that individual session compared with the fixed baseline. These values are recalculated from the saved session metrics when the page loads rather than stored as independent database rows, so correcting an old heart-rate, speed, incline, duration, or power value also corrects its historical score.

All three components start at 50. A log-ratio curve converts current-to-baseline change to 0–100 while keeping the baseline at 50 and limiting outliers:

```text
component_score = clamp(
  50 + 50 × tanh(ln(current / baseline) / ln(2)),
  0,
  100
)
```

The combined score is:

| Component | Weight | Meaning |
| --- | ---: | --- |
| Aerobic efficiency | 60% | Median workload / average HR. More work at the same heart rate, or the same work at a lower heart rate, improves the score. |
| Sustained workload | 20% | Median estimated METs for walking or average watts for cycling. |
| Endurance | 20% | Median workload × duration. This rewards sustaining a comparable workload for longer. |

Average heart rate is useful for repeated, similar sessions but it is not a direct VO2 measurement. Heart rate can change with temperature, fatigue, hydration, medication, caffeine, and session duration. Studies also show that the relationship between heart-rate reserve and oxygen-uptake reserve can shift during prolonged steady exercise. The app therefore uses medians, compares only within the same modality, shows confidence, and avoids labelling the result VO2 max.

Sources:

- [Relationship between heart-rate reserve and oxygen-uptake reserve during treadmill exercise](https://pubmed.ncbi.nlm.nih.gov/9502363/)
- [Intensity and duration affect the HR-reserve/VO2-reserve relationship](https://pubmed.ncbi.nlm.nih.gov/22034854/)
- [Steady-state exercise duration affects the HR-reserve/VO2-reserve relationship](https://pubmed.ncbi.nlm.nih.gov/35497191/)

## Confidence and missing data

Missing values never become zeros and do not lower the score. They reduce data coverage instead.

| Confidence | Requirement |
| --- | --- |
| Low | 4–7 comparable sessions, or fewer than 21 days of history |
| Medium | At least 8 comparable sessions over at least 21 days |
| High | At least 12 comparable sessions over at least 42 days |

Before four comparable sessions in one activity-and-context group, the card says “Building baseline” and states exactly which fields and how many sessions are still needed. Historical baseline scores become visible after three complete sessions. Future-dated sessions and sessions shorter than 20 minutes are excluded.

## Metrics deliberately excluded

- **Active calories:** remain visible as a training total but do not affect the fitness score. Wearable calorie estimates vary by device and body size, and duration already contributes to endurance.
- **Zone classification:** useful for training targets but not reliable enough to score fitness without a personalized heart-rate model.
- **Cardiac drift:** requires first-half and second-half heart-rate and workload data, which the app does not capture yet.
- **Heart-rate recovery:** requires heart rate at stop, one minute, and preferably two minutes after exercise.
- **Resting heart rate and estimated VO2 max:** can be added later as separate supporting indicators if the source and measurement conditions are recorded.

Cardiorespiratory fitness is strongly associated with health outcomes, but a personal app score should not be presented as a clinical measurement. See the [American Heart Association scientific statement on cardiorespiratory fitness as a clinical vital sign](https://www.ahajournals.org/doi/pdf/10.1161/CIR.0000000000000461).

## Rollout

1. **Current branch:** calculate current and historical scores in the client from existing cardio sessions; keep pure cardio and workout + cardio baselines separate; label cardio performed after weights; add history filters; add an average-watts field for indoor cycling; show the experimental personal score in the minimized blue Cardio card.
2. **After real-use review:** move the calculation to the backend, store a score-version identifier, and add a proper activity-and-context trend chart.
3. **Richer capture:** import average cycling power from screenshots and store heart-rate/workload intervals for cardiac drift and recovery.
4. **Calibration:** after several months of consistent data, review thresholds and weighting against a controlled repeatable workout or a measured submaximal/VO2 test.

Changes to the formula must increment a score version so old and new scores are never plotted as though they were calculated identically.
