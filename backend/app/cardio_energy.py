from calendar import monthrange
from datetime import date

from .models import CardioSession
from .tracker_schemas import CardioEnergyPeriodRead
from .training_metrics import start_of_week


def months_before(today: date, months: int) -> date:
    year, month_index = divmod(today.year * 12 + today.month - 1 - months, 12)
    month = month_index + 1
    return date(year, month, min(today.day, monthrange(year, month)[1]))


def cardio_energy_periods(
    sessions: list[CardioSession], today: date, week_start: str
) -> list[CardioEnergyPeriodRead]:
    """Sum recorded cardio energy only, including all zones and excluding future dates."""
    starts = {
        "week": start_of_week(today, week_start),
        "month": today.replace(day=1),
        "3m": months_before(today, 3),
        "6m": months_before(today, 6),
        "year": today.replace(month=1, day=1),
        "all": min((session.session_date for session in sessions), default=today),
    }
    summaries = []
    for period, start in starts.items():
        start = min(start, today)
        selected = [session for session in sessions if start <= session.session_date <= today]
        logged = [session for session in selected if session.calories_kcal is not None]
        summaries.append(
            CardioEnergyPeriodRead(
                period=period,
                start_date=start,
                end_date=today,
                calories_kcal=sum(session.calories_kcal for session in logged),
                logged_sessions=len(logged),
                total_sessions=len(selected),
            )
        )
    return summaries
