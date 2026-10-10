"""Administrative commands: ``python -m app.manage <command>``.

Run from the folder that holds the app's ``.env`` (the repository root, or /opt/gym-logger on the
server) so the commands use the same database as the running app.
"""

from __future__ import annotations

import argparse
import getpass
import os
import sys
from collections.abc import Sequence
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.exc import OperationalError

from .accounts import EmailTakenError, create_user, normalize_email
from .auth import MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, hash_password
from .config import get_settings
from .database import SessionLocal
from .models import User, UserSession


def prompt_new_password() -> str:
    password = getpass.getpass("Password: ")
    if not MIN_PASSWORD_LENGTH <= len(password) <= MAX_PASSWORD_LENGTH:
        raise SystemExit(
            f"Password must be {MIN_PASSWORD_LENGTH}-{MAX_PASSWORD_LENGTH} characters long."
        )
    if getpass.getpass("Repeat password: ") != password:
        raise SystemExit("Passwords did not match.")
    return password


def clean_email(value: str) -> str:
    try:
        return normalize_email(value)
    except ValueError as error:
        raise SystemExit(str(error)) from error


def command_create_user(args: argparse.Namespace) -> None:
    display_name = " ".join(args.display_name.split())
    if not 1 <= len(display_name) <= 80:
        raise SystemExit("Display name must be 1-80 characters long.")
    email = clean_email(args.email)
    password = prompt_new_password()
    with SessionLocal() as db:
        try:
            user = create_user(
                db,
                get_settings(),
                email=email,
                display_name=display_name,
                password=password,
                force_admin=args.admin,
            )
        except EmailTakenError:
            raise SystemExit(f"An account for {email} already exists.") from None
        role = "admin" if user.is_admin else "user"
        print(f"Created {role} account {user.email} ({user.id}).")


def command_reset_password(args: argparse.Namespace) -> None:
    email = clean_email(args.email)
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == email))
        if user is None:
            raise SystemExit(f"No account for {email}.")
        user.password_hash = hash_password(prompt_new_password())
        # Anyone signed in with the old password is signed out.
        db.execute(delete(UserSession).where(UserSession.user_id == user.id))
        db.commit()
        print(f"Password updated for {user.email}; all sessions were signed out.")


def command_list_users(_: argparse.Namespace) -> None:
    with SessionLocal() as db:
        users = list(db.scalars(select(User).order_by(User.created_at, User.email)))
    if not users:
        print("No accounts yet. The first account created becomes the admin.")
        return
    for user in users:
        role = "admin" if user.is_admin else "user"
        status = "disabled" if user.disabled_at else "active"
        print(f"{user.email}\t{user.display_name}\t{role}\t{status}\t{user.created_at:%Y-%m-%d}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m app.manage", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    create = commands.add_parser("create-user", help="Create an account (prompts for a password).")
    create.add_argument("--email", required=True)
    create.add_argument("--display-name", required=True)
    create.add_argument("--admin", action="store_true", help="Make the account an administrator.")
    create.set_defaults(handler=command_create_user)

    reset = commands.add_parser("reset-password", help="Set a new password for an account.")
    reset.add_argument("--email", required=True)
    reset.set_defaults(handler=command_reset_password)

    listing = commands.add_parser("list-users", help="List all accounts.")
    listing.set_defaults(handler=command_list_users)
    return parser


def check_database_location() -> None:
    """Refuse to guess: without .env the default relative path would open a different database."""
    if not Path(".env").is_file() and "GYM_DATABASE_PATH" not in os.environ:
        raise SystemExit(
            f"No .env file in {Path.cwd()}. Run this from the folder that holds the app's .env "
            "(the repository root, or /opt/gym-logger on the server), or set GYM_DATABASE_PATH."
        )
    print(f"Using database {get_settings().database_path.resolve()}", file=sys.stderr)


def main(argv: Sequence[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    check_database_location()
    try:
        args.handler(args)
    except OperationalError as error:
        raise SystemExit(
            f"Could not read the database ({error.orig}). Run `alembic upgrade head` first."
        ) from error


if __name__ == "__main__":
    main(sys.argv[1:])
