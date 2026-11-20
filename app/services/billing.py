from datetime import datetime, timezone

from sqlalchemy import select

from app.config import settings
from app.db.models import Entitlement, PaymentOrder, ProcessedWebhookEvent
from app.db.session import SessionLocal


HR_DATABASE = "hr_database"
PAID_EVENTS = {"checkout.session.completed", "checkout.session.async_payment_succeeded"}


class BillingError(Exception):
    pass


class PaymentVerificationError(BillingError):
    pass


def _value(obj, key, default=None):
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _client():
    if not settings.stripe_secret_key:
        raise BillingError("Payments are not configured.")
    try:
        import stripe
    except ImportError as exc:
        raise BillingError("The Stripe SDK is not installed.") from exc
    stripe.api_key = settings.stripe_secret_key
    return stripe


def _line_items():
    if settings.stripe_price_id:
        return [{"price": settings.stripe_price_id, "quantity": 1}]
    return [{
        "price_data": {
            "currency": settings.stripe_unlock_currency,
            "product_data": {"name": "JobReach AI HR Database Unlock"},
            "unit_amount": settings.stripe_unlock_amount,
        },
        "quantity": 1,
    }]


def has_entitlement(user_id, kind=HR_DATABASE):
    with SessionLocal() as db:
        row = db.scalar(select(Entitlement).where(Entitlement.user_id == int(user_id), Entitlement.kind == kind))
        return bool(row and row.active)


def grant_free_access(user_id, kind=HR_DATABASE):
    with SessionLocal() as db:
        entitlement = db.scalar(
            select(Entitlement).where(Entitlement.user_id == int(user_id), Entitlement.kind == kind)
        )
        if not entitlement:
            entitlement = Entitlement(user_id=int(user_id), kind=kind)
            db.add(entitlement)
        entitlement.active = True
        entitlement.order_id = None
        entitlement.revoked_at = None
        db.commit()
        db.refresh(entitlement)
        activated_at = entitlement.updated_at.isoformat() if entitlement.updated_at else None
    return {"unlocked": True, "kind": kind, "activated_at": activated_at, "free": True}


def entitlement_status(user_id, kind=HR_DATABASE):
    with SessionLocal() as db:
        row = db.scalar(select(Entitlement).where(Entitlement.user_id == int(user_id), Entitlement.kind == kind))
    return {
        "unlocked": bool(row and row.active),
        "kind": kind,
        "activated_at": row.updated_at.isoformat() if row and row.active and row.updated_at else None,
    }


def latest_order(user_id):
    with SessionLocal() as db:
        order = db.scalar(
            select(PaymentOrder).where(PaymentOrder.user_id == int(user_id)).order_by(PaymentOrder.created_at.desc())
        )
    if not order:
        return None
    return {
        "status": order.status,
        "amount_total": order.amount_total,
        "currency": order.currency,
        "paid_at": order.paid_at.isoformat() if order.paid_at else None,
    }


def create_checkout_session(user_id, email, idempotency_key: str | None = None):
    if has_entitlement(user_id):
        raise BillingError("The database is already unlocked.")
    stripe = _client()
    base_url = settings.frontend_url.rstrip("/")

    # Generate idempotency key if not provided
    if not idempotency_key:
        import secrets
        idempotency_key = f"jobreach_unlock_{user_id}_{secrets.token_urlsafe(16)}"

    session = stripe.checkout.Session.create(
        mode="payment",
        client_reference_id=str(user_id),
        customer_email=email,
        line_items=_line_items(),
        metadata={"user_id": str(user_id), "purpose": HR_DATABASE},
        success_url=f"{base_url}/?unlock=success&session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{base_url}/?unlock=cancel",
        idempotency_key=idempotency_key,
    )
    session_id = str(_value(session, "id"))
    with SessionLocal() as db:
        order = db.scalar(select(PaymentOrder).where(PaymentOrder.stripe_session_id == session_id))
        if not order:
            order = PaymentOrder(user_id=int(user_id), stripe_session_id=session_id)
            db.add(order)
        order.user_id = int(user_id)
        if order.status in (None, "", "pending"):
            order.status = "pending"
        order.amount_total = int(_value(session, "amount_total", 0) or 0)
        order.currency = str(_value(session, "currency", "") or "").lower()
        db.commit()
    return {"url": str(_value(session, "url")), "session_id": session_id, "idempotency_key": idempotency_key}


def verify_webhook(payload, signature_header):
    if not settings.stripe_webhook_secret:
        raise BillingError("Webhook verification is not configured.")
    stripe = _client()
    try:
        return stripe.Webhook.construct_event(payload, signature_header, settings.stripe_webhook_secret)
    except Exception as exc:
        raise PaymentVerificationError("Invalid webhook signature or payload.") from exc


def _user_id_from_session(session):
    metadata = _value(session, "metadata") or {}
    raw = _value(metadata, "user_id") or _value(session, "client_reference_id")
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def handle_webhook(payload, signature_header):
    event = verify_webhook(payload, signature_header)
    event_id = str(_value(event, "id") or "")
    event_type = str(_value(event, "type") or "")
    data = _value(event, "data") or {}
    obj = _value(data, "object") or {}
    now = datetime.now(timezone.utc)

    with SessionLocal() as db:
        if event_id and db.get(ProcessedWebhookEvent, event_id):
            return {"duplicate": True, "type": event_type}

        # Handle all payment success events
        if event_type in PAID_EVENTS or event_type == "payment_intent.succeeded":
            # For checkout.session.completed, check payment_status
            # For payment_intent.succeeded, payment is confirmed
            payment_status = str(_value(obj, "payment_status") or "")
            if event_type != "payment_intent.succeeded" and payment_status and payment_status != "paid":
                return {"ignored": True, "type": event_type, "reason": "payment is not complete"}

            user_id = _user_id_from_session(obj)
            if not user_id:
                # Try to get from payment_intent metadata for payment_intent.succeeded
                pi_metadata = _value(obj, "metadata") or {}
                user_id_str = _value(pi_metadata, "user_id") or _value(pi_metadata, "client_reference_id")
                try:
                    user_id = int(user_id_str) if user_id_str else None
                except (TypeError, ValueError):
                    user_id = None

            session_id = str(_value(obj, "id") or "")  # checkout session id
            payment_intent_id = str(_value(obj, "payment_intent") or "")  # payment intent id

            if not user_id:
                return {"ignored": True, "type": event_type, "reason": "missing user"}

            # Find or create order by session_id or payment_intent_id
            order = None
            if session_id:
                order = db.scalar(select(PaymentOrder).where(PaymentOrder.stripe_session_id == session_id))
            if not order and payment_intent_id:
                order = db.scalar(select(PaymentOrder).where(PaymentOrder.stripe_payment_intent_id == payment_intent_id))

            if not order:
                order = PaymentOrder(
                    user_id=user_id,
                    stripe_session_id=session_id if session_id else None,
                    stripe_payment_intent_id=payment_intent_id if payment_intent_id else None,
                )
                db.add(order)

            order.user_id = user_id
            if session_id:
                order.stripe_session_id = session_id
            if payment_intent_id:
                order.stripe_payment_intent_id = payment_intent_id
            order.amount_total = int(_value(obj, "amount_total") or 0)
            order.currency = str(_value(obj, "currency") or "").lower()
            order.status = "paid"
            order.paid_at = now
            db.flush()
            entitlement = db.scalar(
                select(Entitlement).where(Entitlement.user_id == user_id, Entitlement.kind == HR_DATABASE)
            )
            if not entitlement:
                entitlement = Entitlement(user_id=user_id, kind=HR_DATABASE)
                db.add(entitlement)
            entitlement.active = True
            entitlement.order_id = order.id
            entitlement.revoked_at = None

        elif event_type == "charge.refunded" and _value(obj, "refunded") is True:
            payment_intent = str(_value(obj, "payment_intent") or "")
            order = db.scalar(
                select(PaymentOrder).where(PaymentOrder.stripe_payment_intent_id == payment_intent)
            ) if payment_intent else None
            if order:
                order.status = "refunded"
                entitlement = db.scalar(
                    select(Entitlement).where(Entitlement.user_id == order.user_id, Entitlement.kind == HR_DATABASE)
                )
                if entitlement:
                    entitlement.active = False
                    entitlement.revoked_at = now

        if event_id:
            db.add(ProcessedWebhookEvent(event_id=event_id, event_type=event_type))
        db.commit()

    return {"processed": True, "type": event_type}
