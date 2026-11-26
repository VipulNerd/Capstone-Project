import enum
from datetime import date, datetime, timezone

from sqlalchemy import JSON, Boolean, Date, DateTime, Enum, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class MeetingStatus(str, enum.Enum):
    recording = "recording"      # overlay agent is streaming audio chunks
    finalizing = "finalizing"    # meeting ended: transcribing, refining, drafting MOM
    draft = "draft"              # refined transcript + MOM ready; organiser reviewing
    approved = "approved"        # organiser approved; MOM locked
    distributed = "distributed"  # emailed to participants
    failed = "failed"            # finalization error (see error_message); can retry


class CalendarSource(str, enum.Enum):
    microsoft = "microsoft"      # Outlook / Microsoft 365 via Graph (OAuth consent)
    google = "google"            # Google Calendar (OAuth consent)
    ics = "ics"                  # meeting invite file (.ics)
    manual = "manual"            # typed in by the user


class ParticipantSource(str, enum.Enum):
    calendar = "calendar"        # from the invite / calendar event
    manual = "manual"            # added by the organiser
    detected = "detected"        # name found in the transcript by the LLM


class AudioTrack(str, enum.Enum):
    mic = "mic"                  # the user's own microphone
    meeting = "meeting"          # system/loopback audio = other participants


class ChunkStatus(str, enum.Enum):
    pending = "pending"
    transcribed = "transcribed"
    failed = "failed"


class DeliveryStatus(str, enum.Enum):
    sent = "sent"
    failed = "failed"
    not_emailed = "not_emailed"  # EMAIL_BACKEND=console: saved on the server only


# JSONB on Postgres, plain JSON elsewhere (SQLite tests).
JsonType = JSON().with_variant(JSONB(), "postgresql")


def _enum(e: type[enum.Enum]) -> Enum:
    # VARCHAR rather than a native PG enum so adding states needs no ALTER TYPE.
    return Enum(e, native_enum=False, length=20)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    email: Mapped[str] = mapped_column(String(320), unique=True)
    # scrypt hash; NULL for accounts created before passwords existed (they use "Forgot password").
    password_hash: Mapped[str | None] = mapped_column(String(255))
    # Pending "forgot password" code (HMAC of the 6 digits), its expiry and wrong-attempt count.
    reset_code_hash: Mapped[str | None] = mapped_column(String(64))
    reset_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reset_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reset_attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    tokens: Mapped[list["ApiToken"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    calendar_connections: Mapped[list["CalendarConnection"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )

    @property
    def has_password(self) -> bool:
        return self.password_hash is not None


class ApiToken(Base):
    """One signed-in browser/device (or script). Only the sha256 of the token is stored."""
    __tablename__ = "api_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    user: Mapped[User] = relationship(back_populates="tokens")


class CalendarConnection(Base):
    """A user's consent for the bot to read their calendar. Tokens are encrypted."""
    __tablename__ = "calendar_connections"
    __table_args__ = (UniqueConstraint("user_id", "provider"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[CalendarSource] = mapped_column(_enum(CalendarSource))
    account_email: Mapped[str | None] = mapped_column(String(320))
    scopes: Mapped[str] = mapped_column(Text)
    refresh_token_enc: Mapped[str | None] = mapped_column(Text)
    access_token_enc: Mapped[str | None] = mapped_column(Text)
    access_token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    connected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    user: Mapped[User] = relationship(back_populates="calendar_connections")


class Meeting(Base):
    __tablename__ = "meetings"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)

    title: Mapped[str] = mapped_column(String(255))
    meeting_date: Mapped[date | None] = mapped_column(Date)
    scheduled_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    scheduled_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    organizer_name: Mapped[str] = mapped_column(String(255))
    organizer_email: Mapped[str] = mapped_column(String(320))
    calendar_source: Mapped[CalendarSource] = mapped_column(_enum(CalendarSource))
    calendar_event_id: Mapped[str | None] = mapped_column(String(1024))
    join_url: Mapped[str | None] = mapped_column(Text)

    status: Mapped[MeetingStatus] = mapped_column(
        _enum(MeetingStatus), default=MeetingStatus.recording, index=True
    )
    error_message: Mapped[str | None] = mapped_column(Text)
    recording_consent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    recording_started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    recording_ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Refined transcript: list of {"t": seconds, "speaker": str, "text": str}
    transcript_lines: Mapped[list[dict] | None] = mapped_column(JsonType)
    transcript: Mapped[str | None] = mapped_column(Text)  # same, rendered as plain text

    summary: Mapped[str | None] = mapped_column(Text)
    discussion_points: Mapped[list[str]] = mapped_column(JsonType, default=list)
    decisions: Mapped[list[str]] = mapped_column(JsonType, default=list)

    approved_by: Mapped[str | None] = mapped_column(String(255))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    @property
    def has_transcript(self) -> bool:
        return bool(self.transcript_lines)

    owner: Mapped[User] = relationship()
    participants: Mapped[list["Participant"]] = relationship(
        back_populates="meeting", cascade="all, delete-orphan", order_by="Participant.id"
    )
    action_items: Mapped[list["ActionItem"]] = relationship(
        back_populates="meeting", cascade="all, delete-orphan", order_by="ActionItem.id"
    )
    chunks: Mapped[list["AudioChunk"]] = relationship(
        back_populates="meeting", cascade="all, delete-orphan",
        order_by=lambda: (AudioChunk.track, AudioChunk.seq),
    )
    deliveries: Mapped[list["EmailDelivery"]] = relationship(
        back_populates="meeting", cascade="all, delete-orphan", order_by="EmailDelivery.id"
    )


class Participant(Base):
    __tablename__ = "participants"

    id: Mapped[int] = mapped_column(primary_key=True)
    meeting_id: Mapped[int] = mapped_column(ForeignKey("meetings.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    email: Mapped[str | None] = mapped_column(String(320))
    source: Mapped[ParticipantSource] = mapped_column(_enum(ParticipantSource), default=ParticipantSource.manual)
    is_optional: Mapped[bool] = mapped_column(Boolean, default=False)

    meeting: Mapped[Meeting] = relationship(back_populates="participants")


class AudioChunk(Base):
    """A slice of one audio track, uploaded by the overlay agent during the meeting."""
    __tablename__ = "audio_chunks"
    __table_args__ = (UniqueConstraint("meeting_id", "track", "seq"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    meeting_id: Mapped[int] = mapped_column(ForeignKey("meetings.id", ondelete="CASCADE"), index=True)
    track: Mapped[AudioTrack] = mapped_column(_enum(AudioTrack))
    seq: Mapped[int] = mapped_column(Integer)
    offset_ms: Mapped[int] = mapped_column(Integer)  # chunk start, ms since recording start
    path: Mapped[str | None] = mapped_column(String(1024))  # None once audio is deleted
    size_bytes: Mapped[int] = mapped_column(Integer)
    status: Mapped[ChunkStatus] = mapped_column(_enum(ChunkStatus), default=ChunkStatus.pending)
    # Raw diarized output: list of {"start", "end", "speaker", "text"} (seconds, chunk-relative)
    segments: Mapped[list[dict] | None] = mapped_column(JsonType)
    error: Mapped[str | None] = mapped_column(Text)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    meeting: Mapped[Meeting] = relationship(back_populates="chunks")


class ActionItem(Base):
    __tablename__ = "action_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    meeting_id: Mapped[int] = mapped_column(ForeignKey("meetings.id", ondelete="CASCADE"), index=True)
    task: Mapped[str] = mapped_column(Text)
    owner: Mapped[str | None] = mapped_column(String(255))
    deadline: Mapped[date | None] = mapped_column(Date)

    meeting: Mapped[Meeting] = relationship(back_populates="action_items")


class EmailDelivery(Base):
    __tablename__ = "email_deliveries"

    id: Mapped[int] = mapped_column(primary_key=True)
    meeting_id: Mapped[int] = mapped_column(ForeignKey("meetings.id", ondelete="CASCADE"), index=True)
    recipient_email: Mapped[str] = mapped_column(String(320))
    status: Mapped[DeliveryStatus] = mapped_column(_enum(DeliveryStatus))
    error: Mapped[str | None] = mapped_column(Text)
    attempted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    meeting: Mapped[Meeting] = relationship(back_populates="deliveries")
