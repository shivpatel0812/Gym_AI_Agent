"""
Fitness AI Coach - OpenAI Integration
Generates personalized fitness insights using OpenAI API.
"""

import json
from datetime import datetime
from typing import Dict, List, Any, Iterator, Optional
from openai import OpenAI

from .coach_tools import CoachToolbox, TOOL_SCHEMAS

# Tool-loop budget. Rounds bound the request/response cycles; calls bound the
# total lookups, so a confused model can't spend the whole budget on one tool.
MAX_TOOL_ROUNDS = 3
MAX_TOOL_CALLS = 6

# How many prior chat turns to replay back to the model
MAX_HISTORY_MESSAGES = 20
PLAN_MODE_HISTORY_MESSAGES = 40

# Plan-mode interviews pull more records and write longer answers
PLAN_MAX_TOOL_ROUNDS = 4
PLAN_MAX_TOOL_CALLS = 8
PLAN_MAX_TOKENS = 1200
# Prepended to every coach system prompt. Keeps the model inside a fitness-coach
# scope and out of diagnosis, and gives it a fixed response for the two topics
# that carry real risk in a calorie-and-training app.
SAFETY_RAILS = """
SAFETY BOUNDARIES (these override every other instruction below):
- You are a fitness and nutrition coach, not a doctor, dietitian, or therapist.
  You do not diagnose conditions, interpret medical tests, or advise on
  medication, supplements beyond routine sports nutrition, or injury treatment.
- If the user describes pain, injury, dizziness, chest symptoms, disordered
  eating, or any medical concern, say plainly that it is outside what you can
  help with and tell them to see a qualified professional. Do not offer a
  workaround program "in the meantime" for anything that sounds medical.
- Never recommend a daily intake below 1200 calories, a weight-loss rate above
  1% of bodyweight per week, extended fasting, dehydration or "water cutting",
  or any protocol whose purpose is rapid weight change. If the user asks for
  one, decline and explain the risk in one or two sentences, then offer a
  sustainable alternative.
- If the user mentions self-harm or suicide, do not coach. Tell them to contact
  a crisis line (988 in the US, findahelpline.com elsewhere) or emergency
  services.
- If the user appears to be under 18, keep advice to general activity and
  balanced eating. No cutting protocols, no calorie deficits, no maximal
  strength testing.
- Stay on training, nutrition, recovery, and this app. Decline unrelated
  requests briefly.
"""



def _is_design_mode(mode: str) -> bool:
    return mode in ("plan", "nutrition")


def clean_for_json(obj: Any) -> Any:
    """Recursively remove None values and ensure all values are JSON-serializable."""
    if obj is None:
        return None
    elif isinstance(obj, dict):
        cleaned = {k: clean_for_json(v) for k, v in obj.items() if v is not None}
        # Remove empty strings from dict values
        cleaned = {k: v for k, v in cleaned.items() if v != ""}
        return cleaned if cleaned else None
    elif isinstance(obj, list):
        cleaned = [clean_for_json(item) for item in obj if item is not None]
        # Remove empty strings from list
        cleaned = [item for item in cleaned if item != ""]
        return cleaned if cleaned else None
    elif isinstance(obj, (str, int, float, bool)):
        # Return empty string as None to be filtered out
        return obj if (not isinstance(obj, str) or obj.strip()) else None
    else:
        # Convert to string, but return None if empty
        str_obj = str(obj) if obj else None
        return str_obj if (str_obj and str_obj.strip()) else None


class FitnessAICoach:
    """AI-powered fitness coach using OpenAI API."""

    def __init__(self, api_key: str, model: str = "gpt-4o", user_profile: Optional[Dict] = None):
        """
        Initialize OpenAI client.

        Args:
            api_key: OpenAI API key
            model: Model to use (default: gpt-4o)
            user_profile: Optional user profile data
        """
        self.client = OpenAI(api_key=api_key)
        self.model = model

        # Default user profile (can be customized per user)
        self.user_profile = user_profile or {
            "goal": "Get strong and build muscle",
            "priority": "Long-term consistency over short-term aesthetics",
            "constraints": ["Busy work schedule", "Student with exam periods"],
            "training_style": "Prefers efficient sessions with progressive overload",
            "experience_level": "intermediate",
            "preferences": {
                "workout_duration": "45-60 minutes",
                "training_frequency": "4-5 days per week",
                "preferred_time": "evening"
            }
        }

    def _build_general_analysis_prompt(self, summary: Dict[str, Any], previous_analyses: Optional[List[str]] = None) -> str:
        """Build structured prompt for General Analysis with optional previous months' context."""
        try:
            cleaned_profile = clean_for_json(self.user_profile)
            profile_json = json.dumps(cleaned_profile, indent=2, default=str)
            # More strict validation - check if JSON is meaningful
            if not profile_json or not profile_json.strip() or profile_json in ["null", "{}", "[]"]:
                profile_json = json.dumps({
                    "goal": "Get strong and build muscle",
                    "experience_level": "intermediate"
                }, indent=2)
        except Exception as e:
            print(f"Error processing profile: {e}")
            profile_json = json.dumps({
                "goal": "Get strong and build muscle",
                "experience_level": "intermediate"
            }, indent=2)
        
        try:
            cleaned_summary = clean_for_json(summary)
            summary_json = json.dumps(cleaned_summary, indent=2, default=str)
            # More strict validation
            if not summary_json or not summary_json.strip() or summary_json in ["null", "{}", "[]"]:
                summary_json = json.dumps({
                    "message": "No data available for this period"
                }, indent=2)
        except Exception as e:
            print(f"Error processing summary: {e}")
            summary_json = json.dumps({
                "message": "Error processing data"
            }, indent=2)
        
        prompt = f"""You are an expert fitness coach providing a personalized monthly review.
{SAFETY_RAILS}

USER PROFILE:
{profile_json}
"""

        # Add previous months' analyses as context if provided
        if previous_analyses and len(previous_analyses) > 0:
            valid_analyses = [str(a).strip() for a in previous_analyses if a and str(a).strip()]
            if valid_analyses:
                if len(valid_analyses) == 1:
                    prompt += f"""
PREVIOUS MONTH'S ANALYSIS (for context and comparison):
{valid_analyses[0]}

"""
                else:
                    prompt += f"""
PREVIOUS MONTHS' ANALYSES (in chronological order, for context and trend analysis):
"""
                    for i, analysis in enumerate(valid_analyses, 1):
                        prompt += f"""
--- Month {i} ---
{analysis}

"""

        prompt += f"""CURRENT MONTH DATA:
{summary_json}


Provide a structured analysis covering these sections:

1. TRAINING
   - Evaluate training frequency, volume, and progression
   - Note any concerning patterns or positive trends

2. NUTRITION
   - Assess calorie and protein intake relative to goals
   - Comment on consistency and adequacy

3. RECOVERY
   - Analyze sleep quality and quantity
   - Assess fatigue and energy levels
   - Identify any recovery deficits

4. LIFESTYLE
   - Consider stress impact on training and recovery
   - Evaluate overall activity levels

5. WHAT TO CHANGE
   - Provide 2-3 specific, actionable changes
   - Prioritize based on biggest limiting factors
   - Make recommendations realistic and incremental

6. WHAT TO KEEP
   - Identify 2-3 things that are working well
   - Reinforce positive behaviors

7. PRIORITY FOCUS (Next 1-2 Weeks)
   - One clear, measurable focus area
   - Explain why this is the priority

GUIDELINES:
- Be specific and personal (use actual numbers from the data)
- Be realistic about the constraints listed in USER PROFILE above
- Metrics that are absent were not logged — say so rather than assuming a value
- Prioritize sustainability over optimization
- Avoid generic advice
- Use a supportive but direct coaching tone
- Keep each section concise (2-4 sentences max)
"""

        if previous_analyses and len(previous_analyses) > 0:
            if len(previous_analyses) == 1:
                prompt += """- Compare current month's performance with the previous month
- Note improvements, declines, or trends
- Reference specific changes from the previous analysis when relevant
"""
            else:
                prompt += """- Compare current month's performance with all previous months
- Identify trends and patterns across the entire period
- Note improvements, declines, or consistent patterns over time
- Reference specific changes and progressions from earlier months when relevant
"""

        prompt += """
Format your response with clear section headers."""

        # Final validation before returning
        if not prompt or not prompt.strip() or len(prompt.strip()) < 50:
            return "You are an expert fitness coach. Provide a comprehensive monthly fitness analysis based on the available data."
        
        return prompt

    def generate_general_analysis(self, summary: Dict[str, Any], previous_analyses: Optional[List[str]] = None) -> Dict[str, Any]:
        """
        Generate comprehensive General Analysis report with optional previous months' context.

        Args:
            summary: Current month's data summary
            previous_analyses: List of previous months' analyses (in chronological order)

        Returns:
            Dict containing analysis status, text, tokens used, etc.
        """
        if previous_analyses:
            previous_analyses = [str(analysis) for analysis in previous_analyses if analysis and str(analysis).strip()]
        
        prompt = self._build_general_analysis_prompt(summary, previous_analyses)
        
        if not prompt or not prompt.strip():
            return {
                "status": "error",
                "error": "Generated prompt is empty"
            }

        try:
            system_content = (
                "You are an expert fitness coach providing personalized, data-driven insights. "
                "You are direct, supportive, and focused on long-term sustainable progress."
                + SAFETY_RAILS
            )
            
            if not isinstance(system_content, str) or not system_content.strip():
                system_content = "You are an expert fitness coach." + SAFETY_RAILS
            
            if not isinstance(prompt, str) or not prompt.strip():
                return {
                    "status": "error",
                    "error": "Prompt is not a valid string"
                }
            
            messages = [
                {
                    "role": "system",
                    "content": system_content
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ]
            
            for msg in messages:
                if not isinstance(msg.get("content"), str) or not msg["content"].strip():
                    return {
                        "status": "error",
                        "error": f"Message content is invalid: {msg.get('role')}"
                    }
            
            from ai_models import completion_kwargs

            response = self.client.chat.completions.create(
                **completion_kwargs(self.model, max_tokens=1500, temperature=0.7),
                messages=messages,
            )

            analysis_text = response.choices[0].message.content

            return {
                "status": "success",
                "analysis": analysis_text,
                "model": self.model,
                "tokens_used": response.usage.total_tokens,
                "summary_data": summary
            }

        except Exception as e:
            return {
                "status": "error",
                "error": str(e)
            }

    def _build_chatbot_context(self, summary: Dict[str, Any]) -> str:
        """Build condensed context for chatbot."""
        training = summary.get('training') or {}
        nutrition = summary.get('nutrition') or {}
        recovery = summary.get('recovery') or {}
        lifestyle = summary.get('lifestyle') or {}

        def val(source: Dict[str, Any], key: str, template: str) -> Optional[str]:
            """Render a metric, or None when the user has no data for it."""
            value = source.get(key)
            return template.format(value) if value is not None else None

        def line(label: str, *parts: Optional[str]) -> str:
            """Join the parts that have data, or mark the whole line as unlogged."""
            present = [p for p in parts if p]
            return f"{label}: {', '.join(present)}" if present else f"{label}: not logged"

        return f"""USER PROFILE:
{json.dumps(self.user_profile, indent=2, default=str)}

RECENT DATA ({summary.get('analysis_period', 'monthly summary')}):
{line('Training',
      val(training, 'sessions_per_week', '{} sessions/week'),
      val(training, 'progression', '{} progression'))}
{line('Nutrition',
      val(nutrition, 'avg_calories', '~{} cal/day'),
      val(nutrition, 'avg_protein', '~{}g protein/day'))}
{line('Recovery',
      val(recovery, 'avg_sleep_hours', '{}h sleep'),
      val(recovery, 'sleep_trend', 'sleep trend {}'),
      val(recovery, 'avg_fatigue', 'fatigue {}/10'))}
{line('Lifestyle',
      val(lifestyle, 'avg_stress', 'stress {}/10'),
      val(lifestyle, 'high_stress_days', '{} high-stress days'))}
"""

    def _build_plan_mode_prompt(
        self,
        context: str,
        today: datetime,
        split_context: Optional[Dict[str, Any]],
        toolbox: Optional[CoachToolbox],
    ) -> str:
        """Interview prompt used when the user is designing a training plan."""
        split_json = json.dumps(split_context or {"days": []}, indent=2, default=str)
        prompt = f"""You are in PLAN MODE. Your job is to interview this user until you can design a training plan that actually fits them — not to give generic coaching advice.
{SAFETY_RAILS}

Today is {today.strftime('%A, %B %d, %Y')}.

{context}

CURRENT SPLIT (their normal routine, reconstructed from logged workouts when the split itself only stores day names):
{split_json}

How to run the interview:
- Start from what they just said. Ask 1–2 follow-up questions at a time, not a long checklist.
- Ground questions in their actual split, lifts, and recent training. Call tools to inspect recent sessions, exercise history, personal records, recovery, and their current split before assuming anything.
- Cover, across the conversation (skip anything already answered or obvious from their data):
  1. The specific goal and how they'll know it worked (e.g. a lift, a look, a race).
  2. Timeline / block length.
  3. Days per week and session length they can actually keep.
  4. Equipment and injuries / pain.
  5. How much their current split can change: keep it (follow), tweak it (adapt), or rebuild (build for me).
  6. Which lifts or qualities should be the priority.
  7. Recovery constraints (sleep, stress, travel).
- Be conversational and precise. Reference real numbers from their logs.
- Do NOT output a JSON plan, full weekly spreadsheet, or exercise list to activate. When you have enough, summarise the brief in a few bullets and tell them to tap Generate Plan so the program can be built and reviewed.
- If they ask to generate now and you still have a critical gap, ask that one question first.

Where a metric reads "not logged", say you don't have that data instead of guessing."""

        if toolbox is not None:
            prompt += """

Use tools in this mode. Look up recent sessions and the current split early so follow-ups are specific (e.g. "You've been pressing incline once a week — want a second day?"). If a tool returns no data, say so plainly."""
        return prompt

    def _build_nutrition_mode_prompt(
        self,
        context: str,
        today: datetime,
        nutrition_context: Optional[Dict[str, Any]],
        toolbox: Optional[CoachToolbox],
    ) -> str:
        """Interview prompt used when the user is designing or adjusting nutrition."""
        payload = json.dumps(nutrition_context or {}, indent=2, default=str)
        prompt = f"""{SAFETY_RAILS}
You are in NUTRITION PLAN MODE. Your job is to interview this user until you can design or adjust a nutrition strategy that fits how they actually eat — and that supports their training. This is not generic diet advice and not a 7-day meal spreadsheet.

Today is {today.strftime('%A, %B %d, %Y')}.

{context}

TRAINING + CURRENT NUTRITION (use this so food supports the workout goal):
{payload}

How to run the interview:
- Start from what they just said. Ask 1–2 follow-up questions at a time.
- If they have a training plan or a lift goal (bench, incline press, etc.), treat nutrition as support for that — protein, calories, and timing — not a separate body-composition lecture unless they ask.
- Anything already present in TRAINING + CURRENT NUTRITION above is KNOWN. Never ask the user to repeat it. That includes their goal, regular foods, flexible meals, likes, dislikes, dietary restrictions and typical day. Asking again is the single worst thing you can do here — they already filled this in.
- If nutrition_plan is present, they have an ACTIVE plan and want an adjustment, not a fresh start. Open by naming what you already know ("You're at 2,800 kcal with yogurt/oatmeal breakfast and a flexible family dinner") and ask only what would change it.
- Cover, across the conversation (ask ONLY for what is genuinely missing above):
  1. Goal: fuel training, lose fat, gain muscle, or maintain — and how they'll know it worked.
  2. Foods they already eat on most days (anchors: yogurt, oatmeal, shake, etc.).
  3. Meals they don't fully control (family dinner, work lunch) and rough calorie ranges.
  4. Likes, dislikes, restrictions, foods they usually have around.
  5. How many meals they prefer and whether dinner is the big meal.
- Be conversational and precise. Reference their logged intake and training when you have it.
- Do NOT output a JSON plan or a full daily menu to activate. When you have enough, summarise the brief in a few bullets and tell them to tap Generate Nutrition Plan so it can be built and reviewed.
- If they ask to generate now and you still have a critical gap, ask that one question first.

Where a metric reads "not logged", say you don't have that data instead of guessing."""

        if toolbox is not None:
            prompt += """

Use tools in this mode. Look up the nutrition plan, recent eating, and the training plan early so follow-ups are specific."""
        return prompt

    def _build_chat_messages(
        self,
        user_message: str,
        summary: Dict[str, Any],
        conversation_history: Optional[List[Dict]],
        toolbox: Optional[CoachToolbox],
        mode: str = "coach",
        split_context: Optional[Dict[str, Any]] = None,
        nutrition_context: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        """Assemble the message list shared by the buffered and streaming paths."""
        context = self._build_chatbot_context(summary)
        today = datetime.now()
        design_mode = _is_design_mode(mode)

        if mode == "plan":
            system_message = self._build_plan_mode_prompt(
                context, today, split_context, toolbox
            )
        elif mode == "nutrition":
            system_message = self._build_nutrition_mode_prompt(
                context, today, nutrition_context, toolbox
            )
        else:
            system_message = f"""You are a personal fitness coach who knows this user's training history and current status.
{SAFETY_RAILS}

Today is {today.strftime('%A, %B %d, %Y')}.

{context}

Provide specific, personalized advice based on their actual data. Be conversational but precise.
Reference their actual numbers when relevant (sleep hours, training frequency, etc.).
Consider the constraints listed in their profile above in your recommendations.
Where a metric reads "not logged", say you don't have that data instead of guessing at a value."""

            if toolbox is not None:
                system_message += """

The summary above is headline averages only. When the user asks about specific
workouts, exercises, dates, personal bests, or what to train today, call the
tools to look up the actual records rather than answering from the averages or
guessing. If a tool returns no data, say so plainly."""

        history_limit = PLAN_MODE_HISTORY_MESSAGES if design_mode else MAX_HISTORY_MESSAGES
        messages: List[Dict[str, Any]] = [{"role": "system", "content": system_message}]
        messages.extend(self._sanitize_history(conversation_history or [], limit=history_limit))
        messages.append({"role": "user", "content": user_message})
        return messages

    def _request_kwargs(
        self, messages: List[Dict], toolbox: Optional[CoachToolbox],
        round_index: int, tool_call_count: int,
        mode: str = "coach",
    ) -> Dict[str, Any]:
        """Build the API kwargs for one round, applying the tool budget."""
        from ai_models import completion_kwargs

        design_mode = _is_design_mode(mode)
        max_rounds = PLAN_MAX_TOOL_ROUNDS if design_mode else MAX_TOOL_ROUNDS
        max_calls = PLAN_MAX_TOOL_CALLS if design_mode else MAX_TOOL_CALLS
        # Withhold tools on the last round, and once the call budget is spent,
        # so a tool-happy model still ends with a text answer
        budget_left = round_index < max_rounds and tool_call_count < max_calls
        use_tools = toolbox is not None and budget_left
        kwargs = completion_kwargs(
            self.model,
            max_tokens=PLAN_MAX_TOKENS if design_mode else 800,
            temperature=0.7,
            use_tools=use_tools,
        )
        kwargs["messages"] = messages
        if use_tools:
            kwargs["tools"] = TOOL_SCHEMAS
        return kwargs

    def chat(
        self,
        user_message: str,
        summary: Dict[str, Any],
        conversation_history: Optional[List[Dict]] = None,
        toolbox: Optional[CoachToolbox] = None,
        mode: str = "coach",
        split_context: Optional[Dict[str, Any]] = None,
        nutrition_context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Handle chatbot interactions with context awareness.

        Args:
            user_message: User's question/message
            summary: Rolling fitness data summary (headline numbers)
            conversation_history: Previous conversation messages
            toolbox: Optional CoachToolbox. When supplied, the model can pull
                session-level records on demand instead of being limited to
                the aggregates in the system prompt.

        Returns:
            Dict containing response status, message, tokens used, and updated history
        """
        # Sanitize once and hand the same clean list back to the client, so its
        # stored history stays valid and bounded instead of accumulating junk
        history_limit = PLAN_MODE_HISTORY_MESSAGES if _is_design_mode(mode) else MAX_HISTORY_MESSAGES
        clean_history = self._sanitize_history(conversation_history or [], limit=history_limit)
        messages = self._build_chat_messages(
            user_message, summary, clean_history, toolbox, mode, split_context,
            nutrition_context,
        )
        max_rounds = PLAN_MAX_TOOL_ROUNDS if _is_design_mode(mode) else MAX_TOOL_ROUNDS

        try:
            total_tokens = 0
            tools_used: List[str] = []

            for round_index in range(max_rounds + 1):
                kwargs = self._request_kwargs(
                    messages, toolbox, round_index, len(tools_used), mode
                )
                response = self.client.chat.completions.create(**kwargs)
                total_tokens += getattr(response.usage, "total_tokens", 0) or 0
                choice = response.choices[0].message
                tool_calls = getattr(choice, "tool_calls", None)

                if not tool_calls:
                    assistant_message = choice.content or ""
                    return {
                        "status": "success",
                        "response": assistant_message,
                        "tokens_used": total_tokens,
                        "tools_used": tools_used,
                        # Only user/assistant turns go back to the client — tool
                        # traffic stays server-side so replayed history is valid
                        "conversation_history": clean_history + [
                            {"role": "user", "content": user_message},
                            {"role": "assistant", "content": assistant_message},
                        ],
                    }

                messages.append({
                    "role": "assistant",
                    "content": choice.content,
                    "tool_calls": [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {
                                "name": tc.function.name,
                                "arguments": tc.function.arguments,
                            },
                        }
                        for tc in tool_calls
                    ],
                })

                for tool_call in tool_calls:
                    name = tool_call.function.name
                    try:
                        args = json.loads(tool_call.function.arguments or "{}")
                    except json.JSONDecodeError:
                        args = {}
                    result = toolbox.dispatch(name, args) if toolbox else {"error": "Tools unavailable"}
                    tools_used.append(name)
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": json.dumps(result, default=str),
                    })

            # Unreachable in practice: the last round is sent without tools, so
            # the model has nothing to call and must answer in text.
            return {
                "status": "error",
                "error": "Coach could not complete a response within the tool call limit",
            }

        except Exception as e:
            return {
                "status": "error",
                "error": str(e)
            }

    def chat_stream(
        self,
        user_message: str,
        summary: Dict[str, Any],
        conversation_history: Optional[List[Dict]] = None,
        toolbox: Optional[CoachToolbox] = None,
        mode: str = "coach",
        split_context: Optional[Dict[str, Any]] = None,
        nutrition_context: Optional[Dict[str, Any]] = None,
    ) -> Iterator[Dict[str, Any]]:
        """
        Streaming variant of chat(). Yields event dicts for the SSE endpoint.

        Event types:
            {"type": "tool",  "name": str}   a lookup is running
            {"type": "delta", "text": str}   a chunk of the answer
            {"type": "done",  ...}           final totals and history
            {"type": "error", "error": str}  failed before/while answering
        """
        history_limit = PLAN_MODE_HISTORY_MESSAGES if _is_design_mode(mode) else MAX_HISTORY_MESSAGES
        clean_history = self._sanitize_history(conversation_history or [], limit=history_limit)
        messages = self._build_chat_messages(
            user_message, summary, clean_history, toolbox, mode, split_context,
            nutrition_context,
        )
        max_rounds = PLAN_MAX_TOOL_ROUNDS if _is_design_mode(mode) else MAX_TOOL_ROUNDS

        try:
            total_tokens = 0
            tools_used: List[str] = []

            for round_index in range(max_rounds + 1):
                kwargs = self._request_kwargs(
                    messages, toolbox, round_index, len(tools_used), mode
                )
                kwargs["stream"] = True
                # Usage is omitted from streamed responses unless asked for
                kwargs["stream_options"] = {"include_usage": True}

                content_parts: List[str] = []
                # Tool call fragments arrive split across chunks and must be
                # reassembled per index before they can be parsed
                pending_calls: Dict[int, Dict[str, str]] = {}

                for chunk in self.client.chat.completions.create(**kwargs):
                    usage = getattr(chunk, "usage", None)
                    if usage is not None:
                        total_tokens += getattr(usage, "total_tokens", 0) or 0

                    # The usage-only chunk carries no choices
                    if not chunk.choices:
                        continue

                    delta = chunk.choices[0].delta
                    if delta is None:
                        continue

                    if delta.content:
                        content_parts.append(delta.content)
                        yield {"type": "delta", "text": delta.content}

                    for tc in (getattr(delta, "tool_calls", None) or []):
                        slot = pending_calls.setdefault(
                            tc.index, {"id": "", "name": "", "arguments": ""}
                        )
                        if tc.id:
                            slot["id"] = tc.id
                        function = getattr(tc, "function", None)
                        if function is not None:
                            if function.name:
                                slot["name"] += function.name
                            if function.arguments:
                                slot["arguments"] += function.arguments

                if not pending_calls:
                    assistant_message = "".join(content_parts)
                    yield {
                        "type": "done",
                        "response": assistant_message,
                        "tokens_used": total_tokens,
                        "tools_used": tools_used,
                        "conversation_history": clean_history + [
                            {"role": "user", "content": user_message},
                            {"role": "assistant", "content": assistant_message},
                        ],
                    }
                    return

                ordered = [pending_calls[i] for i in sorted(pending_calls)]
                messages.append({
                    "role": "assistant",
                    "content": "".join(content_parts) or None,
                    "tool_calls": [
                        {
                            "id": call["id"],
                            "type": "function",
                            "function": {
                                "name": call["name"],
                                "arguments": call["arguments"] or "{}",
                            },
                        }
                        for call in ordered
                    ],
                })

                for call in ordered:
                    yield {"type": "tool", "name": call["name"]}
                    try:
                        args = json.loads(call["arguments"] or "{}")
                    except json.JSONDecodeError:
                        args = {}
                    result = (
                        toolbox.dispatch(call["name"], args)
                        if toolbox else {"error": "Tools unavailable"}
                    )
                    tools_used.append(call["name"])
                    messages.append({
                        "role": "tool",
                        "tool_call_id": call["id"],
                        "content": json.dumps(result, default=str),
                    })

            # Unreachable in practice: the last round is sent without tools.
            yield {
                "type": "error",
                "error": "Coach could not complete a response within the tool call limit",
            }

        except Exception as e:
            yield {"type": "error", "error": str(e)}

    @staticmethod
    def _sanitize_history(history: List[Dict], limit: int = MAX_HISTORY_MESSAGES) -> List[Dict]:
        """
        Keep only well-formed user/assistant turns from client-supplied history.

        The client round-trips this value, so it can't be trusted to be
        complete: a stray tool_calls entry without its matching tool result
        would make the next request invalid.
        """
        clean = []
        for message in history or []:
            if not isinstance(message, dict):
                continue
            role = message.get("role")
            content = message.get("content")
            if role in ("user", "assistant") and isinstance(content, str) and content.strip():
                clean.append({"role": role, "content": content})
        return clean[-limit:]
