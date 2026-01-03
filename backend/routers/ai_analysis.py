"""
AI Analysis Router
Endpoints for generating and retrieving AI-powered fitness insights.
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel
import os

from auth import get_user_id
from db import db
from ai_analysis import FitnessDataAnalyzer, FitnessAICoach, get_user_profile_for_ai

router = APIRouter(prefix="/api/ai-analysis", tags=["ai-analysis"])


class GenerateAnalysisRequest(BaseModel):
    year: int
    month: int
    include_previous_months: Optional[bool] = True


class ChatRequest(BaseModel):
    message: str
    year: Optional[int] = None
    month: Optional[int] = None
    conversation_history: Optional[List[dict]] = None


@router.get("/summary")
async def get_monthly_summary(
    year: int = Query(..., description="Year (e.g., 2024)"),
    month: int = Query(..., ge=1, le=12, description="Month (1-12)"),
    user_id: str = Depends(get_user_id)
):
    """
    Get monthly fitness data summary for a specific month.
    This returns the processed data that will be used for AI analysis.
    """
    try:
        analyzer = FitnessDataAnalyzer(db, user_id)
        summary = analyzer.build_complete_summary(year, month)
        return {
            "status": "success",
            "summary": summary
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating summary: {str(e)}")


@router.post("/generate")
async def generate_ai_analysis(
    request: GenerateAnalysisRequest,
    user_id: str = Depends(get_user_id)
):
    """
    Generate AI-powered analysis for a specific month.
    Optionally includes context from previous months for trend analysis.
    """
    try:
        # Get OpenAI API key
        openai_api_key = os.getenv("OPENAI_API_KEY")
        if not openai_api_key:
            raise HTTPException(status_code=500, detail="OpenAI API key not configured")

        # Build current month summary
        analyzer = FitnessDataAnalyzer(db, user_id)
        summary = analyzer.build_complete_summary(request.year, request.month)

        # Get user profile for personalized analysis
        user_profile = get_user_profile_for_ai(db, user_id)

        # Get previous analyses if requested
        previous_analyses = []
        if request.include_previous_months:
            analyses_ref = db.collection("users").document(user_id).collection("ai_analyses")
            analyses_docs = analyses_ref.where("year", "==", request.year).where("month", "<", request.month).order_by("month").stream()

            for doc in analyses_docs:
                doc_data = doc.to_dict()
                if doc_data.get("status") == "success" and doc_data.get("analysis"):
                    previous_analyses.append(doc_data["analysis"])

        # Initialize AI Coach with user's actual profile
        coach = FitnessAICoach(api_key=openai_api_key, user_profile=user_profile)

        # Generate analysis
        result = coach.generate_general_analysis(summary, previous_analyses if previous_analyses else None)

        if result["status"] == "error":
            raise HTTPException(status_code=500, detail=f"AI analysis failed: {result.get('error')}")

        # Store the analysis in Firestore
        analysis_data = {
            "user_id": user_id,
            "year": request.year,
            "month": request.month,
            "status": result["status"],
            "analysis": result["analysis"],
            "model": result["model"],
            "tokens_used": result["tokens_used"],
            "summary_data": result["summary_data"],
            "created_at": datetime.now().isoformat(),
            "previous_context_count": len(previous_analyses)
        }

        # Use year-month as document ID for easy retrieval
        doc_id = f"{request.year}-{request.month:02d}"
        analyses_ref = db.collection("users").document(user_id).collection("ai_analyses")
        analyses_ref.document(doc_id).set(analysis_data)

        return {
            "status": "success",
            "analysis": result["analysis"],
            "tokens_used": result["tokens_used"],
            "model": result["model"],
            "previous_context_months": len(previous_analyses),
            "document_id": doc_id
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating analysis: {str(e)}")


@router.get("/analyses")
async def get_all_analyses(
    year: Optional[int] = Query(None, description="Filter by year"),
    limit: Optional[int] = Query(10, ge=1, le=100, description="Number of analyses to return"),
    user_id: str = Depends(get_user_id)
):
    """
    Get all stored AI analyses for the user.
    Optionally filter by year.
    """
    try:
        analyses_ref = db.collection("users").document(user_id).collection("ai_analyses")

        if year:
            query = analyses_ref.where("year", "==", year).order_by("month", direction="DESCENDING").limit(limit)
        else:
            query = analyses_ref.order_by("created_at", direction="DESCENDING").limit(limit)

        docs = query.stream()

        analyses = []
        for doc in docs:
            data = doc.to_dict()
            analyses.append({
                "id": doc.id,
                "year": data.get("year"),
                "month": data.get("month"),
                "analysis": data.get("analysis"),
                "tokens_used": data.get("tokens_used"),
                "model": data.get("model"),
                "created_at": data.get("created_at"),
                "status": data.get("status")
            })

        return {
            "status": "success",
            "count": len(analyses),
            "analyses": analyses
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching analyses: {str(e)}")


@router.get("/analyses/{analysis_id}")
async def get_analysis_by_id(
    analysis_id: str,
    user_id: str = Depends(get_user_id)
):
    """
    Get a specific AI analysis by its ID (format: YYYY-MM).
    """
    try:
        doc_ref = db.collection("users").document(user_id).collection("ai_analyses").document(analysis_id)
        doc = doc_ref.get()

        if not doc.exists:
            raise HTTPException(status_code=404, detail="Analysis not found")

        data = doc.to_dict()
        return {
            "status": "success",
            "analysis": {
                "id": doc.id,
                "year": data.get("year"),
                "month": data.get("month"),
                "analysis": data.get("analysis"),
                "tokens_used": data.get("tokens_used"),
                "model": data.get("model"),
                "created_at": data.get("created_at"),
                "summary_data": data.get("summary_data"),
                "previous_context_count": data.get("previous_context_count", 0)
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching analysis: {str(e)}")


@router.post("/chat")
async def chat_with_ai(
    request: ChatRequest,
    user_id: str = Depends(get_user_id)
):
    """
    Chat with AI coach. Uses current month's data or specified month for context.
    """
    try:
        # Get OpenAI API key
        openai_api_key = os.getenv("OPENAI_API_KEY")
        if not openai_api_key:
            raise HTTPException(status_code=500, detail="OpenAI API key not configured")

        # Determine which month's data to use
        now = datetime.now()
        year = request.year or now.year
        month = request.month or now.month

        # Build summary for context
        analyzer = FitnessDataAnalyzer(db, user_id)
        summary = analyzer.build_complete_summary(year, month)

        # Get user profile for personalized responses
        user_profile = get_user_profile_for_ai(db, user_id)

        # Initialize AI Coach with user's actual profile
        coach = FitnessAICoach(api_key=openai_api_key, user_profile=user_profile)

        # Get chat response
        result = coach.chat(
            user_message=request.message,
            summary=summary,
            conversation_history=request.conversation_history
        )

        if result["status"] == "error":
            raise HTTPException(status_code=500, detail=f"Chat failed: {result.get('error')}")

        return {
            "status": "success",
            "response": result["response"],
            "tokens_used": result["tokens_used"],
            "conversation_history": result["conversation_history"]
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error in chat: {str(e)}")


@router.delete("/analyses/{analysis_id}")
async def delete_analysis(
    analysis_id: str,
    user_id: str = Depends(get_user_id)
):
    """
    Delete a specific AI analysis.
    """
    try:
        doc_ref = db.collection("users").document(user_id).collection("ai_analyses").document(analysis_id)
        doc = doc_ref.get()

        if not doc.exists:
            raise HTTPException(status_code=404, detail="Analysis not found")

        doc_ref.delete()

        return {
            "status": "success",
            "message": "Analysis deleted successfully"
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error deleting analysis: {str(e)}")
