"""passwords, per-browser sessions (api_tokens) and password-reset codes

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-26

Existing users keep their current token (moved into api_tokens), so signed-in
browsers stay signed in. They have no password yet (password_hash NULL) and set
one with "Forgot password?".
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: Union[str, Sequence[str], None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "api_tokens",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index(op.f("ix_api_tokens_user_id"), "api_tokens", ["user_id"], unique=False)
    op.execute("INSERT INTO api_tokens (user_id, token_hash, created_at) SELECT id, token_hash, created_at FROM users")

    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("password_hash", sa.String(length=255), nullable=True))
        batch.add_column(sa.Column("reset_code_hash", sa.String(length=64), nullable=True))
        batch.add_column(sa.Column("reset_expires_at", sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column("reset_sent_at", sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column("reset_attempts", sa.Integer(), server_default="0", nullable=False))
        batch.drop_constraint("users_token_hash_key", type_="unique")
        batch.drop_column("token_hash")


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("token_hash", sa.String(length=64), nullable=True))
    # Keep each user's newest session token; users without one get an unusable placeholder.
    op.execute(
        "UPDATE users SET token_hash = COALESCE("
        "(SELECT t.token_hash FROM api_tokens t WHERE t.user_id = users.id ORDER BY t.id DESC LIMIT 1),"
        " 'revoked-' || CAST(users.id AS VARCHAR))"
    )
    with op.batch_alter_table("users") as batch:
        batch.alter_column("token_hash", existing_type=sa.String(length=64), nullable=False)
        batch.create_unique_constraint("users_token_hash_key", ["token_hash"])
        batch.drop_column("reset_attempts")
        batch.drop_column("reset_sent_at")
        batch.drop_column("reset_expires_at")
        batch.drop_column("reset_code_hash")
        batch.drop_column("password_hash")
    op.drop_index(op.f("ix_api_tokens_user_id"), table_name="api_tokens")
    op.drop_table("api_tokens")
