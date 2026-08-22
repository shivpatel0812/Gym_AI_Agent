import os

from fastapi import HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from firebase_admin import auth

security = HTTPBearer()

# Comma-separated list of emails allowed to review AI access requests.
ADMIN_EMAILS = {
    email.strip().lower()
    for email in os.getenv("ADMIN_EMAILS", "").split(",")
    if email.strip()
}


async def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        token = credentials.credentials
        if not token:
            raise HTTPException(status_code=401, detail="No token provided")
        return auth.verify_id_token(token)
    except HTTPException:
        raise
    except Exception as e:
        # Log the detail server-side; the client only ever sees a generic 401 so
        # we don't hand an attacker a description of why their token failed.
        import traceback
        print(f"Auth error: {type(e).__name__}: {e}")
        print(traceback.format_exc())
        raise HTTPException(status_code=401, detail="Invalid or expired authentication token")


def get_user_id(decoded_token: dict = Depends(verify_token)) -> str:
    return decoded_token.get("uid")


def get_user_email(decoded_token: dict = Depends(verify_token)) -> str:
    return decoded_token.get("email") or ""


def require_admin(decoded_token: dict = Depends(verify_token)) -> dict:
    """
    Gate for admin-only routes.

    Allows either a Firebase custom claim (`admin: true`, set with
    `auth.set_custom_user_claims`) or an email in the ADMIN_EMAILS env var.
    """
    if decoded_token.get("admin") is True:
        return decoded_token

    email = (decoded_token.get("email") or "").lower()
    if email and email in ADMIN_EMAILS:
        return decoded_token

    raise HTTPException(status_code=403, detail="Admin access required")
