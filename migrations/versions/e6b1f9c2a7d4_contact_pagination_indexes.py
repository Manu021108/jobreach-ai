"""add contact pagination indexes

Revision ID: e6b1f9c2a7d4
Revises: c2b4e7766f4c
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e6b1f9c2a7d4'
down_revision: Union[str, Sequence[str], None] = 'c2b4e7766f4c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        'ix_contacts_owner_updated_id', 'contacts',
        ['owner_id', sa.text('updated_at DESC'), sa.text('id DESC')],
        unique=False,
    )
    op.create_index(
        'ix_contacts_owner_status_updated_id', 'contacts',
        ['owner_id', 'status', sa.text('updated_at DESC'), sa.text('id DESC')],
        unique=False,
    )
    op.create_index(
        'ix_contacts_owner_company_name', 'contacts',
        ['owner_id', 'company_name'],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index('ix_contacts_owner_company_name', table_name='contacts')
    op.drop_index('ix_contacts_owner_status_updated_id', table_name='contacts')
    op.drop_index('ix_contacts_owner_updated_id', table_name='contacts')
