from fastapi import HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from firebase_admin import auth

security = HTTPBearer()

async def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        token = credentials.credentials
        if not token:
            raise HTTPException(status_code=401, detail="No token provided")
        decoded_token = auth.verify_id_token(token)
        return decoded_token
    except ValueError as e:
        import traceback
        print(f"Token verification error: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(status_code=401, detail=f"Token verification failed: {str(e)}")
    except Exception as e:
        import traceback
        print(f"Auth error: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(status_code=401, detail=f"Invalid authentication token: {str(e)}")

def get_user_id(decoded_token: dict = Depends(verify_token)) -> str:
    return decoded_token.get("uid")

