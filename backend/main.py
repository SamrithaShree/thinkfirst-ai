from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import os
from dotenv import load_dotenv
from groq import Groq
import logging
import json
import time

# Firebase Admin
import firebase_admin
from firebase_admin import credentials, auth as firebase_auth

load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

# CORS configuration


ALLOWED_ORIGINS = [
    "https://think-first-ai.web.app",
    "https://think-first-ai.firebaseapp.com",
    "http://localhost:5173",
    "http://localhost:3000",
]


app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=3600,  
)

# Initialize Firebase Admin
try:
    cred = credentials.Certificate("serviceAccountKey.json")
    firebase_admin.initialize_app(cred)
    logger.info("Firebase Admin initialized successfully")
except Exception as e:
    logger.error(f"Failed to initialize Firebase Admin: {e}")

# Initialize Groq client
groq_api_key = os.getenv('GROQ_API_KEY')
if not groq_api_key:
    logger.error("GROQ_API_KEY not found in environment variables")
    raise ValueError("GROQ_API_KEY is required")

client = Groq(api_key=groq_api_key)

# Pydantic models
class ConversationContext(BaseModel):
    currentTopic: Optional[str] = None
    attemptCount: int = 0
    isLearningMode: bool = False

class TimeTravelContext(BaseModel):
    isActive: bool = False
    questionStartTime: Optional[int] = None
    attemptCount: int = 0
    unlockedHints: List[int] = []
    thinkingTime: int = 0

class Message(BaseModel):
    role: str
    text: str

class ChatRequest(BaseModel):
    message: str
    conversationHistory: List[Message]
    conversationContext: ConversationContext
    sessionId: str
    timeTravelContext: Optional[TimeTravelContext] = None

class ChatResponse(BaseModel):
    text: str
    mode: str
    isHint: bool = False
    isSolution: bool = False
    timeTravelContext: Optional[TimeTravelContext] = None


def calculate_unlocked_hints(time_travel_ctx: TimeTravelContext) -> List[int]:
    """
    Calculate which hints should be unlocked based on time and attempts
    
    Rules:
    - Hint 1: 30s OR 1 attempt
    - Hint 2: 60s AND 1 attempt
    - Hint 3: 90s AND 2 attempts
    - Solution: 120s OR 3 attempts
    """
    elapsed = 0
    if time_travel_ctx.questionStartTime:
        current_time_ms = int(time.time() * 1000)
        elapsed = (current_time_ms - time_travel_ctx.questionStartTime) // 1000
    
    attempts = time_travel_ctx.attemptCount or 0
    unlocked = []
    
    # Hint 1: 30s OR 1 attempt
    if elapsed >= 30 or attempts >= 1:
        unlocked.append(1)
    
    # Hint 2: 60s AND 1 attempt
    if elapsed >= 60 and attempts >= 1:
        unlocked.append(2)
    
    # Hint 3: 90s AND 2 attempts
    if elapsed >= 90 and attempts >= 2:
        unlocked.append(3)
    
    # Solution: 120s OR 3 attempts
    if elapsed >= 120 or attempts >= 3:
        unlocked.append(4)
    
    logger.info(f"⏰ Time-Travel: {elapsed}s, {attempts} attempts → Unlocked: {unlocked}")
    return unlocked


@app.post("/api/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """Main chat endpoint with Time-Travel Mode support"""
    try:
        # Create time_travel_ctx
        time_travel_ctx = request.timeTravelContext or TimeTravelContext()
        
        # Calculate elapsed for logging
        elapsed_for_log = 0
        if time_travel_ctx.questionStartTime:
            current_time_ms = int(time.time() * 1000)
            elapsed_for_log = (current_time_ms - time_travel_ctx.questionStartTime) // 1000
        
        logger.info(f"🔥 Received Time-Travel data: active={time_travel_ctx.isActive}, elapsed={elapsed_for_log}s, attempts={time_travel_ctx.attemptCount}")
        
        # Calculate unlocked hints based on time AND attempts
        if time_travel_ctx.isActive:
            original_unlocked = time_travel_ctx.unlockedHints.copy()
            time_travel_ctx.unlockedHints = calculate_unlocked_hints(time_travel_ctx)
            logger.info(f"🔓 Hints calculation: {original_unlocked} → {time_travel_ctx.unlockedHints}")
        
        # Build system prompt
        system_prompt = """You are ThinkFirst AI, an intelligent daily-life chatbot that helps people learn by thinking first.

YOUR ABSOLUTE CORE RULES:
1. NEVER GIVE DIRECT ANSWERS TO LEARNING QUESTIONS ON FIRST ASK
2. BE A NORMAL CHATBOT - For casual chat (greetings, general questions), respond naturally
3. DETECT REAL-TIME REQUESTS - For weather/news, provide real-time data naturally
4. FOR LEARNING QUESTIONS - Use progressive hints
5. RESPOND IN JSON FORMAT - Always return valid JSON

CRITICAL: You are NOT just a tutor, you are a daily-life assistant that:
- Chats normally about life, interests, feelings
- Provides weather and news when asked
- BUT when someone asks a solvable problem/homework/learning question, you guide them instead of solving it directly

BEHAVIOR:

For General Chat (casual conversation):
- Answer naturally and conversationally
- Be friendly, helpful, and engaging
- No hints needed - just chat normally
- Examples: "What's up?", "Tell me a joke", "I'm feeling sad", "What should I eat?"

For Real-Time Data (weather/news):
- Use provided real-time data naturally
- Don't say you lack access to current data
- Respond helpfully and directly
"""
        
        conversation_context = request.conversationContext.dict()
        
        # TIME-TRAVEL MODE LOGIC
        if time_travel_ctx.isActive and conversation_context.get('isLearningMode'):
            unlocked = time_travel_ctx.unlockedHints
            
            # Calculate elapsed time from questionStartTime
            elapsed = 0
            if time_travel_ctx.questionStartTime:
                current_time_ms = int(time.time() * 1000)
                elapsed = (current_time_ms - time_travel_ctx.questionStartTime) // 1000
            
            attempts = time_travel_ctx.attemptCount
            
            system_prompt += f"""

⏱️ TIME-TRAVEL MODE ACTIVE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Elapsed time: {elapsed}s
Attempts made: {attempts}
Unlocked hints: {unlocked}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CRITICAL TIME-TRAVEL RULES:
✅ You can ONLY provide hints that are in the unlocked list: {unlocked}
✅ Give the HIGHEST unlocked hint level available
✅ If a hint level is not unlocked, you CANNOT give it yet
❌ Do NOT jump ahead to hint levels that aren't unlocked

HINT LEVEL DEFINITIONS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Hint 1 (Conceptual): High-level approach, what data structure/algorithm to consider
Hint 2 (Approach): Detailed algorithm explanation with clear steps
Hint 3 (Pseudocode): Step-by-step pseudocode or detailed logic breakdown
Hint 4 (Solution): Complete working code with full explanation and complexity analysis
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

YOUR RESPONSE STRATEGY:
"""
            
            if len(unlocked) == 0:
                system_prompt += """
🔒 NO HINTS UNLOCKED YET
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Encourage: "Keep thinking! Hints unlock as you try and time passes."
- Provide general encouragement without revealing problem-solving details
- Suggest they work through what they know so far
- Set: isHint=false, isSolution=false, mode="learning"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
            elif 1 in unlocked and 2 not in unlocked:
                system_prompt += """
🔓 HINT 1 UNLOCKED (Conceptual)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Provide ONLY high-level conceptual guidance:
- What type of data structure might help? (e.g., "Consider using a hash map")
- What category of algorithm? (e.g., "Think about two-pointer technique")
- What property of the problem is key? (e.g., "Notice the array is sorted")

DO NOT give:
❌ Specific steps or algorithm details
❌ Pseudocode or code snippets
❌ Detailed implementation hints

Example: "Think about using a hash map for O(1) lookups. What could you store in it?"

Set: isHint=true, isSolution=false, mode="learning"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
            elif 2 in unlocked and 3 not in unlocked:
                system_prompt += """
🔓 HINT 2 UNLOCKED (Approach)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Provide detailed approach/algorithm explanation:
- Break down the algorithm into clear steps
- Explain the logic: "First do X, then check Y, finally return Z"
- Mention key operations but not exact code

Example:
"1. Create a hash map to store values
2. Iterate through the array once
3. For each element, check if (target - element) exists in the map
4. If yes, return both indices
5. If no, add current element to map"

DO NOT give:
❌ Actual pseudocode or code
❌ Variable names or syntax

Set: isHint=true, isSolution=false, mode="learning"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
            elif 3 in unlocked and 4 not in unlocked:
                system_prompt += """
🔓 HINT 3 UNLOCKED (Pseudocode)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Provide detailed pseudocode:
- Use clear pseudocode structure
- Show logic flow with IF/FOR/WHILE
- Include all major operations

Example:
```
CREATE hash_map
FOR each num in array:
    complement = target - num
    IF complement exists in hash_map:
        RETURN [hash_map[complement], current_index]
    ELSE:
        ADD num to hash_map with current_index
RETURN empty (no solution found)
```

DO NOT give:
❌ Actual working code in Python/JavaScript/etc

Set: isHint=true, isSolution=false, mode="learning"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
            elif 4 in unlocked:
                system_prompt += """
🔓 SOLUTION UNLOCKED (Complete Code)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Provide COMPLETE working solution:
- Full working code in Python (or requested language)
- Detailed explanation of each step
- Time and space complexity analysis
- Example walkthrough

Example format:
```python
def twoSum(nums, target):
    hash_map = {}
    for i, num in enumerate(nums):
        complement = target - num
        if complement in hash_map:
            return [hash_map[complement], i]
        hash_map[num] = i
    return []
```

Explanation:
- We use a hash map to store numbers we've seen
- For each number, we check if its complement exists
- Time: O(n), Space: O(n)

Set: isHint=false, isSolution=true, mode="learning"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
            
            system_prompt += """

REQUIRED JSON RESPONSE FORMAT:
{
  "text": "your response here",
  "mode": "learning",
  "isHint": true/false,
  "isSolution": true/false
}
"""
        
        # LEARNING MODE (Time-Travel OFF)
        elif conversation_context.get('isLearningMode'):
            attempt_count = conversation_context.get('attemptCount', 0)
            
            system_prompt += f"""

CURRENT MODE: LEARNING MODE (Time-Travel OFF)
Topic: "{conversation_context.get('currentTopic', 'unknown')}"
Attempt: {attempt_count}

PROGRESSIVE GUIDANCE:
"""
            
            if attempt_count == 0:
                system_prompt += """- This is ATTEMPT 0 - User JUST ASKED the question
- CRITICAL: DO NOT SOLVE IT! DO NOT GIVE THE ANSWER!
- Give a small hint or ask what they know
- Be supportive and encouraging
- Set: isHint=true, isSolution=false, mode="learning"
"""
            elif attempt_count == 1:
                system_prompt += """- This is ATTEMPT 1 - They've tried once
- Give a stronger hint: point to technique/formula/concept
- Set: isHint=true, isSolution=false, mode="learning"
"""
            elif attempt_count == 2:
                system_prompt += """- This is ATTEMPT 2 - Third interaction
- Give detailed guidance: pseudocode, steps, or partial work
- Set: isHint=true, isSolution=false, mode="learning"
"""
            elif attempt_count == 3:
                system_prompt += """- This is ATTEMPT 3 - Fourth interaction
- Give very detailed guidance: specific steps
- Set: isHint=true, isSolution=false, mode="learning"
"""
            else:
                system_prompt += """- This is ATTEMPT 4+ - Give COMPLETE SOLUTION
- Provide full answer with step-by-step explanation
- Set: isHint=false, isSolution=true, mode="learning"
"""
            
            system_prompt += """

REQUIRED JSON RESPONSE FORMAT:
{
  "text": "your response with appropriate hint level",
  "mode": "learning",
  "isHint": true or false,
  "isSolution": true or false
}
"""
        
        # CHAT MODE
        else:
            system_prompt += """

CURRENT MODE: CHAT MODE
- Respond naturally
- Set: mode="chat", isHint=false, isSolution=false

JSON FORMAT:
{
  "text": "response",
  "mode": "chat",
  "isHint": false,
  "isSolution": false
}
"""
        
        # Build conversation history for Groq
        messages = [{"role": "system", "content": system_prompt}]
        
        for msg in request.conversationHistory[-10:]:
            messages.append({
                "role": "user" if msg.role == "user" else "assistant",
                "content": msg.text
            })
        
        messages.append({
            "role": "user",
            "content": request.message
        })
        
        # Call Groq API
        logger.info(f"Calling Groq API with {len(messages)} messages")
        
        chat_completion = client.chat.completions.create(
            messages=messages,
            model="llama-3.3-70b-versatile",
            temperature=0.7,
            max_tokens=2000,
        )
        
        response_text = chat_completion.choices[0].message.content
        logger.info(f"Groq response: {response_text[:100]}...")
        
        # Parse JSON response
        try:
            if "```json" in response_text:
                json_start = response_text.find("```json") + 7
                json_end = response_text.find("```", json_start)
                json_str = response_text[json_start:json_end].strip()
            elif "{" in response_text and "}" in response_text:
                json_start = response_text.find("{")
                json_end = response_text.rfind("}") + 1
                json_str = response_text[json_start:json_end]
            else:
                json_str = json.dumps({
                    "text": response_text,
                    "mode": "chat",
                    "isHint": False,
                    "isSolution": False
                })
            
            response_data = json.loads(json_str)
            
        except json.JSONDecodeError as e:
            logger.error(f"JSON parse error: {e}")
            response_data = {
                "text": response_text,
                "mode": conversation_context.get('isLearningMode', False) and "learning" or "chat",
                "isHint": False,
                "isSolution": False
            }
        
        # Return updated Time-Travel context to frontend
        logger.info(f"📤 Returning to frontend: unlocked={time_travel_ctx.unlockedHints}, active={time_travel_ctx.isActive}, attempts={time_travel_ctx.attemptCount}")
        
        return ChatResponse(
            text=response_data.get("text", response_text),
            mode=response_data.get("mode", "chat"),
            isHint=response_data.get("isHint", False),
            isSolution=response_data.get("isSolution", False),
            timeTravelContext=time_travel_ctx
        )
        
    except Exception as e:
        logger.error(f"Error in chat endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "groq_api_configured": bool(groq_api_key),
        "firebase_initialized": firebase_admin._apps.get('[DEFAULT]') is not None
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
