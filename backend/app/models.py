import enum
from datetime import date, datetime, timezone

from sqlalchemy import JSON, Date, DateTime, Enum, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class MeetingStatus(str, enum.Enum):
    uploaded = "uploaded"        # file received, not yet processed
    processing = "processing"    # transcription / LLM in progress
    draft = "draft"              # MOM generated, organiser reviewing/editing
    approved = "approved"        # organiser approved; content locked
    distributed = "distributed"  # emailed to participants
    failed = "failed"            # processing error (see error_message)


class SourceType(str, enum.Enum):
    audio = "audio"
    transcript = "transcript"


class DeliveryStatus(str, enum.Enum):
    sent = "sent"
    failed = "failed"


# JSONB on Postgres (indexable/queryable), plain JSON elsewhere (SQLite tests).
JsonList = JSON().with_variant(JSONB(), "postgresql")


def _enum(e: type[enum.Enum]) -> Enum:
    # Stored as VARCHAR + CHECK so adding states later needs no Postgres ALTER TYPE.
    return Enum(e, native_enum=False, length=20)


class Meeting(Base):
    __tablename__ = "meetings"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(255))
    meeting_date: Mapped[date | None] = mapped_column(Date)
    organizer_name: Mapped[str] = mapped_column(String(255))
    organizer_email: Mapped[str] = mapped_column(String(320))

    source_type: Mapped[SourceType] = mapped_column(_enum(SourceType))
    source_filename: Mapped[str] = mapped_column(String(255))
    source_path: Mapped[str | None] = mapped_column(String(1024))
    transcript: Mapped[str | None] = mapped_column(Text)

    status: Mapped[MeetingStatus] = mapped_column(
        _enum(MeetingStatus), default=MeetingStatus.uploaded, index=True
    )
    error_message: Mapped[str | None] = mapped_column(Text)

    summary: Mapped[str | None] = mapped_column(Text)
    discussion_points: Mapped[list[str]] = mapped_column(JsonList, default=list)
    decisions: Mapped[list[str]] = mapped_column(JsonList, default=list)

    approved_by: Mapped[str | None] = mapped_column(String(255))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    participants: Mapped[list["Participant"]] = relationship(
        back_populates="meeting", cascade="all, delete-orphan", order_by="Participant.id"
    )
    action_items: Mapped[list["ActionItem"]] = relationship(
        back_populates="meeting", cascade="all, delete-orphan", order_by="ActionItem.id"
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

    meeting: Mapped[Meeting] = relationship(back_populates="participants")


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
