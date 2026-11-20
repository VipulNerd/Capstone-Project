from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models import DeliveryStatus, MeetingStatus, SourceType


class ParticipantIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    email: EmailStr | None = None


class ParticipantOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    email: str | None


class ActionItemIn(BaseModel):
    task: str = Field(min_length=1)
    owner: str | None = None
    deadline: date | None = None


class ActionItemOut(ActionItemIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


class MeetingSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    meeting_date: date | None
    organizer_name: str
    status: MeetingStatus
    created_at: datetime


class MeetingOut(MeetingSummary):
    organizer_email: str
    source_type: SourceType
    source_filename: str
    transcript: str | None
    error_message: str | None
    summary: str | None
    discussion_points: list[str]
    decisions: list[str]
    participants: list[ParticipantOut]
    action_items: list[ActionItemOut]
    approved_by: str | None
    approved_at: datetime | None
    updated_at: datetime


class MomUpdate(BaseModel):
    """Organiser edits during review. Omitted fields are left unchanged;
    list fields, when given, replace the existing list."""
    title: str | None = Field(default=None, min_length=1, max_length=255)
    meeting_date: date | None = None
    summary: str | None = None
    discussion_points: list[str] | None = None
    decisions: list[str] | None = None
    participants: list[ParticipantIn] | None = None
    action_items: list[ActionItemIn] | None = None


class ApproveRequest(BaseModel):
    approved_by: str = Field(min_length=1, max_length=255)


class DistributeRequest(BaseModel):
    format: Literal["pdf", "docx"] = "pdf"


class DeliveryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    recipient_email: str
    status: DeliveryStatus
    error: str | None
    attempted_at: datetime


class DistributeResult(BaseModel):
    sent: int
    failed: int
    deliveries: list[DeliveryOut]
