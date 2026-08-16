"""
AI Analysis Router
Endpoints for generating and retrieving AI-powered fitness insights.
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from fastapi.responses import StreamingResponse
from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel
import json
import os

from auth import get_user_id
from db import db
from ai_analysis import FitnessDataAnalyzer, FitnessAICoach, get_user_profile_for_ai
from ai_analysis.coach_tools import CoachToolbox
from ai_analysis.conversation_store import ConversationStore

router = APIRouter(prefix="/api/ai-analysis", tags=["ai-analysis"])

# How many prior months of analysis to feed back in as context. Capped so the
# prompt doesn't grow without bound as the year fills up.
PREVIOUS_ANALYSIS_MONTHS = 3

# Rolling window the coach uses for headline numbers when no month is specified
CHAT_CONTEXT_WINDOW_DAYS = 28


def previous_month_ids(year: int, month: int, count: int) -> List[str]:
    """
    Build the document IDs of the N months preceding (year, month).

    Walks backwards across the year boundary, so a January analysis still sees
    the previous October–December. Returned oldest-first.
    """
    ids = []
    y, m = year, month
    for _ in range(count):
        m -= 1
        if m == 0:
            m = 12
            y -= 1
        ids.append(f"{y}-{m:02d}")
    return list(reversed(ids))


def _chat_summary(user_id: str, request: "ChatRequest") -> dict:
    """
    Headline numbers for the coach's system prompt.

    Defaults to a rolling window so context doesn't collapse to near-empty on
    the 1st of the month; an explicit year/month still asks for that month.
    """
    analyzer = FitnessDataAnalyzer(db, user_id)
    if request.year and request.month:
        return analyzer.build_complete_summary(request.year, request.month)
    return analyzer.build_rolling_summary(window_days=CHAT_CONTEXT_WINDOW_DAYS)


def _chat_history(store: ConversationStore, request: "ChatRequest") -> list:
    """
    History to replay to the model.

    A conversation_id reads from Firestore and ignores whatever the client
    sent. Without one we fall back to the client-supplied list so older app
    builds keep working.
    """
    if request.conversation_id:
        return store.get_history_for_model(request.conversation_id)
    return request.conversation_history or []


def _persist_exchange(
    store: ConversationStore, conversation_id, user_message: str, assistant_message: str
):
    """
    Save the exchange. Never fails the request — a chat that answered but
    couldn't be saved is better than an error after the model already ran.
    """
    try:
        return store.append_exchange(conversation_id, user_message, assistant_message)
    except Exception as e:
        print(f"Warning: could not persist conversation: {e}")
        return conversation_id


def summary_has_data(summary: dict) -> bool:
    """
    Check whether the summary contains any actually-logged data.

    Looks at explicit counts rather than truthiness of the whole dict — several
    fields (progression, notes) are always populated and would otherwise make
    an entirely empty month look like it has data.
    """
    training = summary.get("training") or {}
    nutrition = summary.get("nutrition") or {}
    recovery = summary.get("recovery") or {}
    lifestyle = summary.get("lifestyle") or {}

    return any([
        training.get("total_sessions", 0) > 0,
        nutrition.get("days_logged", 0) > 0,
        recovery.get("days_sleep_logged", 0) > 0,
        recovery.get("days_wellness_logged", 0) > 0,
        lifestyle.get("days_stress_logged", 0) > 0,
        lifestyle.get("days_steps_logged", 0) > 0,
    ])


class GenerateAnalysisRequest(BaseModel):
    year: int
    month: int
    include_previous_months: Optional[bool] = True


class ChatRequest(BaseModel):
    message: str
    year: Optional[int] = None
    month: Optional[int] = None
    # Server-side thread. When set, history is loaded from Firestore and
    # conversation_history is ignored. Omit to start a new conversation.
    conversation_id: Optional[str] = None
    conversation_history: Optional[List[dict]] = None


class RenameConversationRequest(BaseModel):
    title: str


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

        # Validate that there's actual data to analyze
        if not summary_has_data(summary):
            raise HTTPException(
                status_code=400, 
                detail=f"No fitness data available for {request.year}-{request.month:02d}. Please log some workouts, nutrition, or wellness data first."
            )

        # Get user profile for personalized analysis
        user_profile = get_user_profile_for_ai(db, user_id)
        
        # Check if user profile is set up (not just defaults)
        try:
            profile_doc_ref = db.collection("users").document(user_id).collection("user_profile").document("profile")
            profile_doc = profile_doc_ref.get()
            
            if not profile_doc.exists:
                raise HTTPException(
                    status_code=400,
                    detail="Please complete your 'About Myself' profile before generating analysis. This helps provide personalized insights."
                )
            
            profile_data = profile_doc.to_dict()
            if not profile_data:
                raise HTTPException(
                    status_code=400,
                    detail="Please complete your 'About Myself' profile before generating analysis. This helps provide personalized insights."
                )
            
            # Check if profile has at least some basic info filled out
            has_profile_data = any([
                profile_data.get('primary_goal'),
                profile_data.get('experience_level'),
                profile_data.get('preferred_workout_frequency'),
                profile_data.get('open_reflection')
            ])
            
            if not has_profile_data:
                raise HTTPException(
                    status_code=400,
                    detail="Please complete your 'About Myself' profile with at least your fitness goals and preferences before generating analysis."
                )
        except HTTPException:
            raise
        except Exception as e:
            print(f"Error checking profile: {e}")
            raise HTTPException(
                status_code=400,
                detail="Please complete your 'About Myself' profile before generating analysis."
            )

        # Get previous analyses if requested. Fetched by document ID (YYYY-MM)
        # so the window crosses year boundaries and needs no composite index.
        previous_analyses = []
        if request.include_previous_months:
            try:
                analyses_ref = db.collection("users").document(user_id).collection("ai_analyses")
                for doc_id in previous_month_ids(request.year, request.month, PREVIOUS_ANALYSIS_MONTHS):
                    doc = analyses_ref.document(doc_id).get()
                    if not doc.exists:
                        continue
                    doc_data = doc.to_dict() or {}
                    if doc_data.get("status") == "success" and doc_data.get("analysis"):
                        analysis_text = str(doc_data["analysis"]).strip()
                        if analysis_text:
                            previous_analyses.append(analysis_text)
            except Exception as e:
                print(f"Warning: Could not fetch previous analyses: {e}")
                previous_analyses = []

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
        print(f"Error generating analysis: {str(e)}")
        import traceback
        traceback.print_exc()
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
            try:
                query = analyses_ref.where("year", "==", year).order_by("month", direction="DESCENDING").limit(limit)
                docs = query.stream()
            except Exception as index_error:
                query = analyses_ref.where("year", "==", year).limit(limit)
                docs = query.stream()
        else:
            try:
                query = analyses_ref.order_by("created_at", direction="DESCENDING").limit(limit)
                docs = query.stream()
            except Exception:
                query = analyses_ref.limit(limit)
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
        
        if year:
            analyses.sort(key=lambda x: x.get("month", 0), reverse=True)

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

        summary = _chat_summary(user_id, request)
        user_profile = get_user_profile_for_ai(db, user_id)
        coach = FitnessAICoach(api_key=openai_api_key, user_profile=user_profile)

        store = ConversationStore(db, user_id)
        history = _chat_history(store, request)

        # Get chat response, with tools so the coach can look up specifics
        result = coach.chat(
            user_message=request.message,
            summary=summary,
            conversation_history=history,
            toolbox=CoachToolbox(db, user_id),
        )

        if result["status"] == "error":
            raise HTTPException(status_code=500, detail=f"Chat failed: {result.get('error')}")

        conversation_id = _persist_exchange(
            store, request.conversation_id, request.message, result["response"]
        )

        return {
            "status": "success",
            "response": result["response"],
            "tokens_used": result["tokens_used"],
            "tools_used": result.get("tools_used", []),
            "conversation_id": conversation_id,
            "conversation_history": result["conversation_history"]
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error in chat: {str(e)}")


@router.get("/conversations")
async def list_conversations(
    limit: int = Query(50, ge=1, le=100),
    user_id: str = Depends(get_user_id)
):
    """List saved coach conversations, most recently updated first."""
    try:
        store = ConversationStore(db, user_id)
        conversations = store.list_conversations(limit=limit)
        return {
            "status": "success",
            "count": len(conversations),
            "conversations": conversations,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error listing conversations: {str(e)}")


@router.post("/conversations")
async def create_conversation(user_id: str = Depends(get_user_id)):
    """Create an empty conversation. Chatting without an id also creates one."""
    try:
        conversation_id = ConversationStore(db, user_id).create_conversation()
        return {"status": "success", "conversation_id": conversation_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error creating conversation: {str(e)}")


@router.get("/conversations/{conversation_id}")
async def get_conversation(conversation_id: str, user_id: str = Depends(get_user_id)):
    """Get one conversation with its full message list."""
    conversation = ConversationStore(db, user_id).get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"status": "success", "conversation": conversation}


@router.patch("/conversations/{conversation_id}")
async def rename_conversation(
    conversation_id: str,
    request: RenameConversationRequest,
    user_id: str = Depends(get_user_id)
):
    """Rename a conversation."""
    if not ConversationStore(db, user_id).rename_conversation(conversation_id, request.title):
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"status": "success"}


@router.delete("/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str, user_id: str = Depends(get_user_id)):
    """Delete a conversation."""
    if not ConversationStore(db, user_id).delete_conversation(conversation_id):
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"status": "success"}


@router.post("/chat/stream")
async def chat_with_ai_stream(
    request: ChatRequest,
    user_id: str = Depends(get_user_id)
):
    """
    Chat with the AI coach over SSE, streaming the answer as it is generated.

    Emits one JSON object per `data:` frame — see FitnessAICoach.chat_stream
    for the event shapes. Errors after the stream opens arrive as an error
    event rather than an HTTP status, since the response has already begun.
    """
    openai_api_key = os.getenv("OPENAI_API_KEY")
    if not openai_api_key:
        raise HTTPException(status_code=500, detail="OpenAI API key not configured")

    summary = _chat_summary(user_id, request)
    user_profile = get_user_profile_for_ai(db, user_id)
    coach = FitnessAICoach(api_key=openai_api_key, user_profile=user_profile)
    toolbox = CoachToolbox(db, user_id)

    store = ConversationStore(db, user_id)
    history = _chat_history(store, request)

    def event_stream():
        try:
            for event in coach.chat_stream(
                user_message=request.message,
                summary=summary,
                conversation_history=history,
                toolbox=toolbox,
            ):
                # Save on the way through, so the id reaches the client in the
                # same done event that ends the stream
                if event.get("type") == "done":
                    event["conversation_id"] = _persist_exchange(
                        store, request.conversation_id,
                        request.message, event.get("response", ""),
                    )
                yield f"data: {json.dumps(event, default=str)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            # Stops nginx and similar proxies buffering the stream into one blob
            "X-Accel-Buffering": "no",
        },
    )


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
