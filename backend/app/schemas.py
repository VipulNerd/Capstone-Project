from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator

from app.models import AudioTrack, CalendarSource, ChunkStatus, DeliveryStatus, MeetingStatus, ParticipantSource

# --- Users -------------------------------------------------------------------------------------


class UserCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    email: EmailStr


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    email: str


class UserCreated(UserOut):
    api_token: str = Field(description="Shown once. Send as 'Authorization: Bearer <token>'.")


# --- Calendar ----------------------------------------------------------------------------------


class AuthorizationUrl(BaseModel):
    authorization_url: str


class CalendarConnectionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    provider: CalendarSource
    account_email: str | None
    scopes: str
    connected_at: datetime


class AttendeeOut(BaseModel):
    name: str
    email: str | None
    optional: bool


class CalendarEventOut(BaseModel):
    event_id: str
    title: str
    start: datetime | None
    end: datetime | None
    organizer_name: str | None
    organizer_email: str | None
    attendees: list[AttendeeOut]
    join_url: str | None


# --- Meetings ----------------------------------------------------------------------------------


class ParticipantIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    email: EmailStr | None = None


class ParticipantOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    email: str | None
    source: ParticipantSource
    is_optional: bool


class MeetingStart(BaseModel):
    """Start a recording session. Participants come from the user's connected calendar
    (calendar_event_id) or, without a calendar, from title + participants."""
    recording_consent: bool = Field(
        description="User confirms participants were informed and agree to the meeting being recorded."
    )
    calendar_event_id: str | None = None
    title: str | None = Field(default=None, min_length=1, max_length=255)
    participants: list[ParticipantIn] = Field(default_factory=list)

    @model_validator(mode="after")
    def need_source(self):
        if not self.calendar_event_id and not self.title:
            raise ValueError("Provide calendar_event_id (from GET /calendar/events) or a title")
        return self


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
    calendar_source: CalendarSource
    calendar_event_id: str | None
    scheduled_start: datetime | None
    scheduled_end: datetime | None
    join_url: str | None
    recording_started_at: datetime
    recording_ended_at: datetime | None
    error_message: str | None
    has_transcript: bool
    summary: str | None
    discussion_points: list[str]
    decisions: list[str]
    participants: list[ParticipantOut]
    action_items: list[ActionItemOut]
    approved_by: str | None
    approved_at: datetime | None
    updated_at: datetime


class ChunkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    track: AudioTrack
    seq: int
    offset_ms: int
    size_bytes: int
    status: ChunkStatus
    error: str | None
    received_at: datetime


class RetryRequest(BaseModel):
    skip_failed_chunks: bool = False


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
    # "console": the server is not configured to send email; messages were only saved on the server.
    email_mode: Literal["console", "smtp"] = "smtp"
