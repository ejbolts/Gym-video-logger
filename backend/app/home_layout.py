from __future__ import annotations

from typing import Annotated, Literal, get_args

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, ValidationError, model_validator
from sqlalchemy.orm import Session

from .account_limits import limit_save_rate
from .auth import CurrentUser
from .database import get_db
from .training_metrics import get_setting, set_setting

HomeSection = Literal[
    "profile",
    "next-workout",
    "workouts",
    "cardio-sessions",
    "weekly-bodyweight",
    "consistency",
    "muscle-sets",
    "zone2",
    "bodyweight-trend",
    "daily-check-in",
    "records",
    "friends",
]
SECTION_IDS = list(get_args(HomeSection))
LAYOUT_KEY = "home_layout"


class HomeLayout(BaseModel):
    order: list[HomeSection] = Field(
        default_factory=lambda: SECTION_IDS.copy(), max_length=len(SECTION_IDS)
    )
    hidden: list[HomeSection] = Field(default_factory=list, max_length=len(SECTION_IDS))
    widths: dict[HomeSection, Literal["compact", "full", "third"]] = Field(
        default_factory=dict, max_length=len(SECTION_IDS)
    )

    @model_validator(mode="after")
    def validate_sections(self) -> HomeLayout:
        if len(self.order) != len(set(self.order)) or len(self.hidden) != len(set(self.hidden)):
            raise ValueError("Sections must not be repeated.")
        # The profile header leads layouts saved before it existed; other new sections are
        # appended. Neither changes the relative positions of saved sections.
        if "profile" not in self.order:
            self.order.insert(0, "profile")
        # Append newly introduced sections without changing existing saved positions.
        self.order.extend(section for section in SECTION_IDS if section not in self.order)
        return self


router = APIRouter(prefix="/api/home-layout", tags=["home layout"])
DbSession = Annotated[Session, Depends(get_db)]


@router.get("", response_model=HomeLayout)
def get_home_layout(db: DbSession, user: CurrentUser) -> HomeLayout:
    try:
        return HomeLayout.model_validate_json(get_setting(db, user.id, LAYOUT_KEY, "{}"))
    except ValidationError:
        return HomeLayout()


@router.put("", response_model=HomeLayout, dependencies=[Depends(limit_save_rate)])
def save_home_layout(payload: HomeLayout, db: DbSession, user: CurrentUser) -> HomeLayout:
    set_setting(db, user.id, LAYOUT_KEY, payload.model_dump_json())
    db.commit()
    return payload
