from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional
from datetime import datetime
from models import WellnessSurvey
from auth import get_user_id
from db import db

router = APIRouter(prefix="/api/wellness-survey", tags=["wellness-survey"])

@router.get("")
async def get_wellness_surveys(user_id: str = Depends(get_user_id), date_filter: Optional[str] = Query(None)):
    surveys_ref = db.collection("users").document(user_id).collection("wellness_survey")
    if date_filter:
        surveys = surveys_ref.where("date", "==", date_filter).stream()
    else:
        surveys = list(surveys_ref.order_by("date").stream())
        surveys.reverse()
    return [{"id": survey.id, **survey.to_dict()} for survey in surveys]

@router.post("")
async def create_wellness_survey(survey: WellnessSurvey, user_id: str = Depends(get_user_id)):
    survey_dict = survey.dict(exclude={"id"})
    survey_dict["created_at"] = datetime.now().isoformat()
    doc_ref = db.collection("users").document(user_id).collection("wellness_survey").document()
    doc_ref.set(survey_dict)
    return {"id": doc_ref.id, **survey_dict}

@router.put("/{survey_id}")
async def update_wellness_survey(survey_id: str, survey: WellnessSurvey, user_id: str = Depends(get_user_id)):
    survey_dict = survey.dict(exclude={"id"})
    survey_dict["updated_at"] = datetime.now().isoformat()
    doc_ref = db.collection("users").document(user_id).collection("wellness_survey").document(survey_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=404, detail="Wellness survey not found")
    doc_ref.update(survey_dict)
    return {"id": survey_id, **survey_dict}

@router.delete("/{survey_id}")
async def delete_wellness_survey(survey_id: str, user_id: str = Depends(get_user_id)):
    doc_ref = db.collection("users").document(user_id).collection("wellness_survey").document(survey_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=404, detail="Wellness survey not found")
    doc_ref.delete()
    return {"message": "Wellness survey deleted"}

