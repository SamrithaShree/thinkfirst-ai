from fastapi import FastAPI, HTTPException, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
import firebase_admin
from firebase_admin import credentials, auth, firestore
from groq import Groq
import os
from dotenv import load_dotenv
import json
import re
from datetime import datetime
import logging
import subprocess
import uuid
import time

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="ThinkFirst AI Backend",
    version="2.0.0",
    description="Educational AI with Progressive Learning, Amnesia Mode, Time-Travel Hints & Code Execution"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "https://think-first-ai.web.app",
        "https://think-first-ai.firebaseapp.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

security = HTTPBearer()

try:
    if os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON"):
        service_account_info = json.loads(os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON"))
        cred = credentials.Certificate(service_account_info)
    else:
        cred = credentials.Certificate("./serviceAccountKey.json")
    
    firebase_admin.initialize_app(cred)
    db = firestore.client()
    logger.info("Firebase Admin SDK initialized successfully")
except Exception as e:
    logger.error(f" Firebase initialization error: {e}")
    raise

groq_api_key = os.getenv("GROQ_API_KEY")
if not groq_api_key:
    raise ValueError("GROQ_API_KEY environment variable is required")

groq_client = Groq(api_key=groq_api_key)


class ConversationMessage(BaseModel):
    role: str
    text: str

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

class ChatRequest(BaseModel):
    message: str
    conversationHistory: List[ConversationMessage]
    conversationContext: ConversationContext
    sessionId: str
    timeTravelContext: Optional[TimeTravelContext] = None

class ChatResponse(BaseModel):
    text: str
    mode: str
    isHint: bool = False
    isSolution: bool = False
    conversationContext: ConversationContext
    timeTravelContext: Optional[TimeTravelContext] = None

class AmnesiaCheckRequest(BaseModel):
    originalSolution: str
    userReconstruction: str
    currentTopic: Optional[str] = None

class AmnesiaCheckResponse(BaseModel):
    logicScore: int
    keyConcepts: List[str]
    missedConcepts: List[str]
    feedback: str

class ExecuteCodeRequest(BaseModel):
    code: str
    language: str
    input: Optional[str] = None

class ExecuteCodeResponse(BaseModel):
    output: str
    error: Optional[str] = None
    executionTime: Optional[float] = None
    language: str
    success: bool

async def verify_firebase_token(
    credentials: HTTPAuthorizationCredentials = Depends(security)
) -> dict:
    """Verify Firebase JWT token and return decoded token"""
    try:
        token = credentials.credentials
        decoded_token = auth.verify_id_token(token)
        return decoded_token
    except auth.InvalidIdTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token"
        )
    except auth.ExpiredIdTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired"
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Authentication failed: {str(e)}"
        )


def analyze_context(
    message: str,
    conversation_history: List[ConversationMessage],
    previous_context: Optional[ConversationContext]
) -> ConversationContext:
    """
    Smart context analyzer - preserves exact logic from Firebase Functions
    Detects: weather/news requests, solution requests, genuine attempts, follow-ups
    """
    msg_lower = message.lower().strip()
    
    weather_patterns = ["weather", "temperature", "how hot", "how cold", "climate", "forecast"]
    news_patterns = ["news", "today's news", "latest news", "current events", "headlines"]
    
    is_weather_request = any(p in msg_lower for p in weather_patterns)
    is_news_request = any(p in msg_lower for p in news_patterns)
    
    if is_weather_request or is_news_request:
        logger.info(' Real-time data request detected - staying in chat mode')
        return ConversationContext(
            currentTopic=None,
            attemptCount=0,
            isLearningMode=False
        )
  
    solution_request_phrases = [
        "give me the answer", "give the answer", "just give me",
        "give me solution", "give the solution", "show me the answer",
        "show the solution", "what is the solution", "what's the solution",
        "tell me the solution", "just show me", "just tell me"
    ]
    is_asking_for_solution = any(phrase in msg_lower for phrase in solution_request_phrases)
    
    attempt_phrases = [
        "i tried", "i think", "maybe", "is it", "would it be",
        "should i", "idk", "i don't know", "not sure", "i'm stuck", "can't figure"
    ]
    is_genuine_attempt = any(phrase in msg_lower for phrase in attempt_phrases)
    

    back_to_previous_phrases = ["back to", "return to", "again about", "still don't get"]
    is_returning_to_previous = any(phrase in msg_lower for phrase in back_to_previous_phrases)

    learning_keywords = [
        "how do i", "how to", "how about", "what about",
        "explain", "solve", "algorithm for", "solution for", "implement"
    ]
    is_new_learning_question = any(kw in msg_lower for kw in learning_keywords)
    
    follow_up_keywords = [
        "time complexity", "space complexity", "complexity",
        "why does this", "why is", "can you explain more",
        "what do you mean", "how does that", "give me a hint",
        "give hint", "another hint"
    ]
    is_follow_up = any(kw in msg_lower for kw in follow_up_keywords)

    chat_keywords = ["hello", "hi", "hey", "thanks", "thank you", "okay", "ok", "got it", "cool"]
    is_general_chat = any(
        msg_lower == kw or msg_lower.startswith(f"{kw} ") or msg_lower.startswith(f"{kw}!")
        for kw in chat_keywords
    )
    
    def extract_topic(msg: str) -> str:
        words = msg.lower().split()
        stop_words = ["how", "to", "the", "a", "an", "what", "is", "explain", "can", "you", "i", "do", "about", "for"]
        meaningful = [w for w in words if w not in stop_words and len(w) > 3]
        return " ".join(meaningful[:3])
    
    if is_general_chat and not is_new_learning_question:
        logger.info('Detected: General chat')
        return ConversationContext(currentTopic=None, attemptCount=0, isLearningMode=False)

    if is_new_learning_question and not is_returning_to_previous:
        new_topic = extract_topic(message)
        logger.info(f' Detected: New learning question - {new_topic}')
        return ConversationContext(
            currentTopic=new_topic,
            attemptCount=0,
            isLearningMode=True
        )
    
    if is_returning_to_previous and conversation_history:
        previous_topics = [
            extract_topic(msg.text)
            for msg in conversation_history
            if msg.role == 'user'
        ]
        previous_topics = [t for t in previous_topics if t]
        
        if previous_topics:
            relevant_topic = next(
                (topic for topic in previous_topics if topic.split()[0] in msg_lower),
                previous_topics[-2] if len(previous_topics) > 1 else previous_topics[-1]
            )
            logger.info(f'Detected: Returning to previous topic - {relevant_topic}')
            return ConversationContext(
                currentTopic=relevant_topic,
                attemptCount=0,
                isLearningMode=True
            )

    if is_follow_up and previous_context and previous_context.currentTopic:
        logger.info(' Detected: Follow-up question (no increment)')
        return ConversationContext(
            currentTopic=previous_context.currentTopic,
            attemptCount=previous_context.attemptCount,
            isLearningMode=True
        )

    if is_asking_for_solution and previous_context and previous_context.isLearningMode:
        logger.info(' Detected: Direct solution request')
        return ConversationContext(
            currentTopic=previous_context.currentTopic,
            attemptCount=max(previous_context.attemptCount, 3),
            isLearningMode=True
        )
    
    if is_genuine_attempt and previous_context and previous_context.isLearningMode and previous_context.currentTopic:
        logger.info(' Detected: Genuine attempt (increment)')
        return ConversationContext(
            currentTopic=previous_context.currentTopic,
            attemptCount=previous_context.attemptCount + 1,
            isLearningMode=True
        )

    if (previous_context and previous_context.isLearningMode and
        previous_context.currentTopic and not is_follow_up and
        not is_asking_for_solution and len(message) > 10):
        logger.info(' Detected: Substantive response (increment)')
        return ConversationContext(
            currentTopic=previous_context.currentTopic,
            attemptCount=previous_context.attemptCount + 1,
            isLearningMode=True
        )
    

    logger.info(' Maintaining previous context')
    return previous_context or ConversationContext(currentTopic=None, attemptCount=0, isLearningMode=False)


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
    
    if elapsed >= 30 or attempts >= 1:
        unlocked.append(1)
    
    if elapsed >= 60 and attempts >= 1:
        unlocked.append(2)
    
    if elapsed >= 90 and attempts >= 2:
        unlocked.append(3)
    
    if elapsed >= 120 or attempts >= 3:
        unlocked.append(4)
    
    logger.info(f"⏰ Time-Travel: {elapsed}s, {attempts} attempts → Unlocked: {unlocked}")
    return unlocked


def build_system_prompt(context: ConversationContext, time_travel_ctx: Optional[TimeTravelContext] = None) -> str:
    """Build progressive system prompt based on context"""
    
    base_prompt = """You are ThinkFirst AI, an intelligent educational assistant that adapts to user needs.

YOUR CORE RULES:
1. RESPOND DIRECTLY - Give your answer immediately without explaining your thought process
2. NO META-COMMENTARY - Don't say "Here's how to proceed"
3. BE NATURAL - Talk like a friendly tutor, not a robot
4. RESPOND IN JSON FORMAT - Always return valid JSON

FOR GENERAL CHAT:
- Answer naturally and conversationally
- Be friendly and helpful
- No hints needed - just chat normally

FOR REAL-TIME DATA (weather/news):
- Respond helpfully and directly
- Don't say you lack access to current data

FOR LEARNING QUESTIONS:
- Use progressive hints based on attempt count
- Be encouraging
"""
    
    if context.isLearningMode:
        attempt_count = context.attemptCount
        current_topic = context.currentTopic
        
        base_prompt += f"\n\nCURRENT MODE: LEARNING MODE\nTopic: \"{current_topic}\"\nAttempt: {attempt_count}\n\nPROGRESSIVE GUIDANCE:\n"
        
        if attempt_count == 0:
            base_prompt += """- This is the FIRST interaction with this topic
- Give a conceptual hint that makes them think
- Ask guiding questions to assess understanding
- Set isHint: true, isSolution: false, mode: "learning\""""
        elif attempt_count == 1:
            base_prompt += """- This is attempt 1 (SECOND attempt)
- Provide stronger hints with techniques or approaches
- Point toward relevant concepts/algorithms
- Set isHint: true, isSolution: false, mode: "learning\""""
        elif attempt_count == 2:
            base_prompt += """- This is attempt 2 (THIRD attempt)
- Give pseudocode or step-by-step roadmap
- Be explicit about the approach
- Set isHint: true, isSolution: false, mode: "learning\""""
        else:
            base_prompt += """- This is attempt 3+ (FOURTH+ attempt or direct solution request)
- Provide COMPLETE solution with detailed explanation
- Include code examples with proper syntax
- Explain WHY each step works
- Set isHint: false, isSolution: true, mode: "learning\""""
        
        base_prompt += "\n\nIMPORTANT: If user asks a follow-up about complexity/clarification, answer directly without treating it as a new attempt."
    
    if time_travel_ctx and time_travel_ctx.isActive:
        elapsed = 0
        if time_travel_ctx.questionStartTime:
            current_time_ms = int(time.time() * 1000)
            elapsed = (current_time_ms - time_travel_ctx.questionStartTime) // 1000
        
        unlocked = time_travel_ctx.unlockedHints
        attempts = time_travel_ctx.attemptCount
        
        base_prompt += f"""

⏱️ TIME-TRAVEL MODE ACTIVE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Elapsed time: {elapsed}s
Attempts made: {attempts}
Unlocked hints: {unlocked}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CRITICAL TIME-TRAVEL RULES:
 You can ONLY provide hints in the unlocked list: {unlocked}
 Give the HIGHEST unlocked hint level available
 If a hint level is not unlocked, you CANNOT give it yet
 Do NOT jump ahead to unlocked hint levels that aren't unlocked

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
            base_prompt += """🔒 NO HINTS UNLOCKED YET
- Encourage: "Keep thinking! Hints unlock as you try and time passes."
- Provide general encouragement without revealing problem-solving details
- Suggest they work through what they know so far
- Set: isHint=false, isSolution=false, mode="learning\""""
        elif 1 in unlocked and 2 not in unlocked:
            base_prompt += """🔓 HINT 1 UNLOCKED (Conceptual)
- Provide ONLY high-level conceptual guidance
- What type of data structure might help?
- What category of algorithm?
- What property of the problem is key?
- Set: isHint=true, isSolution=false, mode="learning\""""
        elif 2 in unlocked and 3 not in unlocked:
            base_prompt += """🔓 HINT 2 UNLOCKED (Approach)
- Provide detailed approach/algorithm explanation
- Break down into clear steps
- Explain the logic: "First do X, then check Y, finally return Z"
- Mention key operations but not exact code
- Set: isHint=true, isSolution=false, mode="learning\""""
        elif 3 in unlocked and 4 not in unlocked:
            base_prompt += """🔓 HINT 3 UNLOCKED (Pseudocode)
- Provide detailed pseudocode with clear structure
- Show logic flow with IF/FOR/WHILE
- Include all major operations
- Set: isHint=true, isSolution=false, mode="learning\""""
        elif 4 in unlocked:
            base_prompt += """🔓 SOLUTION UNLOCKED (Complete Code)
- Provide COMPLETE working solution with full code
- Detailed explanation of each step
- Time and space complexity analysis
- Example walkthrough
- Set: isHint=false, isSolution=true, mode="learning\""""
    
    base_prompt += """

REQUIRED JSON RESPONSE FORMAT:
{
  "text": "your response here",
  "mode": "learning" or "chat",
  "isHint": true/false,
  "isSolution": true/false
}"""
    
    return base_prompt



@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "ThinkFirst AI Backend",
        "version": "2.0.0",
        "features": [
            "Progressive Learning Mode",
            "Time-Travel Hints Mode",
            "Amnesia Mode (Memory Check)",
            "Code Execution",
            "Context-Aware Conversations",
            "Firebase Authentication"
        ],
        "timestamp": datetime.utcnow().isoformat()
    }

@app.get("/health")
async def health_check():
    """Detailed health check"""
    return {
        "status": "healthy",
        "firebase": "connected",
        "groq": "configured",
        "timestamp": datetime.utcnow().isoformat()
    }

@app.post("/api/chat", response_model=ChatResponse)
async def chat_endpoint(
    request: ChatRequest,
    user: dict = Depends(verify_firebase_token)
):
    """
    Main chat endpoint with Progressive Learning & Time-Travel Hints support
    Preserves ALL features: context analysis, attempt tracking, time-travel, Groq integration
    """
    try:
        uid = user["uid"]
        logger.info(f" Chat request from user: {uid}")
      
        current_context = analyze_context(
            request.message,
            request.conversationHistory,
            request.conversationContext
        )
        
        logger.info(f"Context Analysis: {current_context.dict()}")
   
        time_travel_ctx = request.timeTravelContext or TimeTravelContext()

        elapsed_for_log = 0
        if time_travel_ctx.questionStartTime:
            current_time_ms = int(time.time() * 1000)
            elapsed_for_log = (current_time_ms - time_travel_ctx.questionStartTime) // 1000
        
        logger.info(f" Time-Travel data: active={time_travel_ctx.isActive}, elapsed={elapsed_for_log}s, attempts={time_travel_ctx.attemptCount}")
  
        if time_travel_ctx.isActive:
            original_unlocked = time_travel_ctx.unlockedHints.copy()
            time_travel_ctx.unlockedHints = calculate_unlocked_hints(time_travel_ctx)
            logger.info(f"🔓 Hints calculation: {original_unlocked} → {time_travel_ctx.unlockedHints}")
            
        
            msg_lower = request.message.lower()
            is_asking_for_hint = any(phrase in msg_lower for phrase in [
                "give hint", "hint please", "need a hint", "can i get a hint", 
                "show hint", "give me hint", "hint", "can you give me a hint",
                "give me a hint", "i need a hint"
            ])
            
    
            if is_asking_for_hint:
                max_unlocked = max(time_travel_ctx.unlockedHints) if time_travel_ctx.unlockedHints else 0
                next_hint = max_unlocked + 1
                
        
                if next_hint == 1 and elapsed_for_log < 20:
                    wait_time = 20 - elapsed_for_log
                    return ChatResponse(
                        text=f"**Keep thinking!** Hint 1 will unlock in **{wait_time} seconds**. Try solving it yourself first - you've got this!",
                        mode="learning",
                        isHint=False,
                        isSolution=False,
                        conversationContext=current_context,
                        timeTravelContext=time_travel_ctx
                    )
                
    
                elif next_hint == 2 and time_travel_ctx.attemptCount < 2:
                    attempts_needed = 2 - time_travel_ctx.attemptCount
                    return ChatResponse(
                        text=f" **Keep trying!** Hint 2 will unlock after **{attempts_needed} more attempt(s)**. Give it another shot!",
                        mode="learning",
                        isHint=False,
                        isSolution=False,
                        conversationContext=current_context,
                        timeTravelContext=time_travel_ctx
                    )
                
                elif next_hint == 3 and time_travel_ctx.attemptCount < 3:
                    attempts_needed = 3 - time_travel_ctx.attemptCount
                    return ChatResponse(
                        text=f" **Almost there!** Hint 3 will unlock after **{attempts_needed} more attempt(s)**. You're doing great!",
                        mode="learning",
                        isHint=False,
                        isSolution=False,
                        conversationContext=current_context,
                        timeTravelContext=time_travel_ctx
                    )
                
            
                elif next_hint == 4 and time_travel_ctx.attemptCount < 4 and elapsed_for_log < 180:
                    attempts_needed = 4 - time_travel_ctx.attemptCount
                    time_remaining = 180 - elapsed_for_log
                    return ChatResponse(
                        text=f" **Solution unlocks after {attempts_needed} more attempt(s)** or in **{time_remaining//60}:{time_remaining%60:02d} minutes**. Keep pushing!",
                        mode="learning",
                        isHint=False,
                        isSolution=False,
                        conversationContext=current_context,
                        timeTravelContext=time_travel_ctx
                    )
        
  
        system_prompt = build_system_prompt(current_context, time_travel_ctx if time_travel_ctx.isActive else None)
        

        groq_messages = [{"role": "system", "content": system_prompt}]
        
        for msg in request.conversationHistory[-10:]:
            groq_messages.append({
                "role": "user" if msg.role == "user" else "assistant",
                "content": msg.text
            })
        
        groq_messages.append({
            "role": "user",
            "content": f"{request.message}\n\n[Please respond in JSON format with fields: text, mode, isHint, isSolution]"
        })
        
        logger.info(f"Calling Groq API with {len(groq_messages)} messages")
        
        completion = groq_client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=groq_messages,
            temperature=0.7,
            max_tokens=2048,
            top_p=0.9
        )
        
        response_text = completion.choices[0].message.content
        logger.info(f"Groq response: {response_text[:100]}...")
        
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
                    "mode": "learning" if current_context.isLearningMode else "chat",
                    "isHint": False,
                    "isSolution": False
                })
            
            response_data = json.loads(json_str)
        
        except json.JSONDecodeError as e:
            logger.error(f"JSON parse error: {e}")
            response_data = {
                "text": response_text,
                "mode": "learning" if current_context.isLearningMode else "chat",
                "isHint": False,
                "isSolution": False
            }
        

        if request.sessionId:
            try:
                session_ref = db.collection("sessions").document(request.sessionId)
                messages_ref = session_ref.collection("messages")
                
                messages_ref.add({
                    "role": "user",
                    "text": request.message,
                    "timestamp": firestore.SERVER_TIMESTAMP,
                    "userId": uid
                })
                
                messages_ref.add({
                    "role": "assistant",
                    "text": response_data.get("text", response_text),
                    "timestamp": firestore.SERVER_TIMESTAMP,
                    "isHint": response_data.get("isHint", False),
                    "isSolution": response_data.get("isSolution", False),
                    "attemptCount": current_context.attemptCount,
                    "mode": response_data.get("mode", "chat")
                })
                
                session_ref.set({
                    "mode": response_data.get("mode", "chat"),
                    "userId": uid,
                    "lastUpdated": firestore.SERVER_TIMESTAMP,
                    "currentTopic": current_context.currentTopic,
                    "isLearningMode": current_context.isLearningMode,
                    "attemptCount": current_context.attemptCount
                }, merge=True)
                
            except Exception as firestore_error:
                logger.error(f"Firestore error: {firestore_error}")
        
        logger.info(f" Returning to frontend: unlocked={time_travel_ctx.unlockedHints}, active={time_travel_ctx.isActive}")
        
        return ChatResponse(
            text=response_data.get("text", response_text),
            mode=response_data.get("mode", "chat"),
            isHint=response_data.get("isHint", False),
            isSolution=response_data.get("isSolution", False),
            conversationContext=current_context,
            timeTravelContext=time_travel_ctx
        )
    
    except Exception as e:
        logger.error(f"Chat endpoint error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process chat request: {str(e)}"
        )

@app.post("/api/checkMemory", response_model=AmnesiaCheckResponse)
async def check_memory_endpoint(
    request: AmnesiaCheckRequest,
    user: dict = Depends(verify_firebase_token)
):
    """
    Amnesia Mode: Compare user reconstruction with original solution
    Exact logic from Firebase Functions with improved error handling
    """
    try:
        uid = user["uid"]
        logger.info(f" Memory check request from user: {uid}")
        
        comparison_prompt = f"""You are a learning assessment AI. Compare these two solutions and check if the LOGIC and APPROACH are similar.

IGNORE THESE (Do NOT penalize for):
- Variable names (e.g., "nums" vs "array")
- Exact syntax (e.g., "for i in range" vs "for(int i=0...)")
- Code style and formatting
- Comments
- Language differences (Python vs JavaScript is OK)
- Minor wording differences in explanations

ONLY CHECK THESE (Focus on):
- Core algorithm/approach used
- Logic flow and reasoning
- Key concepts applied (e.g., "uses hash map", "sliding window technique")
- Problem-solving strategy
- Correctness of the approach

**Original Solution:**
{request.originalSolution}

**Student's Reconstruction:**
{request.userReconstruction}

Respond ONLY with a valid JSON object (no markdown, no extra text):
{{
  "logicScore": 85,
  "keyConcepts": ["array traversal", "hash map lookup"],
  "missedConcepts": ["edge case handling"],
  "feedback": "Great job remembering the core logic! You correctly used..."
}}

Be encouraging but honest. Score 90-100 = excellent, 70-89 = good, 50-69 = partial, <50 = needs review."""
        
        completion = groq_client.chat.completions.create(
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert programming educator. Respond ONLY with valid JSON. No markdown code blocks, no explanations, just pure JSON."
                },
                {
                    "role": "user",
                    "content": comparison_prompt
                }
            ],
            model="llama-3.3-70b-versatile",
            temperature=0.3,
            max_tokens=1500
        )
        
        response_text = completion.choices[0].message.content.strip()
        logger.info(f"Raw Groq response: {response_text[:200]}")
        
        try:
            if "```json" in response_text:
                json_start = response_text.find("```json") + 7
                json_end = response_text.find("```", json_start)
                json_str = response_text[json_start:json_end].strip()
            elif "```" in response_text:
                json_start = response_text.find("```") + 3
                json_end = response_text.find("```", json_start)
                json_str = response_text[json_start:json_end].strip()
            elif "{" in response_text and "}" in response_text:
    
                json_start = response_text.find("{")
                json_end = response_text.rfind("}") + 1
                json_str = response_text[json_start:json_end]
            else:
                raise ValueError("No JSON object found in response")
            
            result = json.loads(json_str)
            
        
            if not all(key in result for key in ["logicScore", "keyConcepts", "missedConcepts", "feedback"]):
                raise ValueError("Missing required fields in JSON response")
            
        except (json.JSONDecodeError, ValueError) as parse_error:
            logger.error(f"JSON parsing failed: {parse_error}")
            logger.error(f"Full response text: {response_text}")
            

            result = {
                "logicScore": 50,
                "keyConcepts": ["Response parsing error"],
                "missedConcepts": [],
                "feedback": "Unable to analyze your solution due to a technical error. Please try again or contact support."
            }

        try:
            db.collection("amnesiaAttempts").add({
                "userId": uid,
                "originalSolution": request.originalSolution,
                "userReconstruction": request.userReconstruction,
                "logicScore": result["logicScore"],
                "keyConcepts": result["keyConcepts"],
                "missedConcepts": result["missedConcepts"],
                "feedback": result["feedback"],
                "topic": request.currentTopic,
                "timestamp": firestore.SERVER_TIMESTAMP
            })
            
            stats_ref = db.collection("users").document(uid).collection("amnesiaStats").document("stats")
            stats_ref.set({
                "totalAttempts": firestore.Increment(1),
                "lastScore": result["logicScore"],
                "lastAttempt": firestore.SERVER_TIMESTAMP
            }, merge=True)
        
        except Exception as firestore_error:
            logger.error(f"Firestore error in checkMemory: {firestore_error}")
        
        return AmnesiaCheckResponse(
            logicScore=result["logicScore"],
            keyConcepts=result["keyConcepts"],
            missedConcepts=result["missedConcepts"],
            feedback=result["feedback"]
        )
    
    except Exception as e:
        logger.error(f"Memory check error: {str(e)}")
      
        return AmnesiaCheckResponse(
            logicScore=0,
            keyConcepts=[],
            missedConcepts=["System error"],
            feedback="An error occurred while checking your solution. Please try again."
        )

@app.post("/api/execute", response_model=ExecuteCodeResponse)
async def execute_code(
    request: ExecuteCodeRequest,
    user: dict = Depends(verify_firebase_token)
):
    """
    Execute code in multiple languages with security
    Supports: Python, JavaScript, Java, C++, C
    """
    try:
        uid = user["uid"]
        start_time = time.time()
        temp_id = str(uuid.uuid4())[:8]
        os.makedirs("exec_tmp", exist_ok=True)
        
        output = ""
        error_msg = None
        success = False
      
        if request.language.lower() in ["python", "py"]:
            filepath = f"exec_tmp/{temp_id}.py"
            
            code_to_run = request.code
            if request.input:
                code_to_run = f"import sys\nsys.stdin = open('exec_tmp/{temp_id}_input.txt', 'r')\n{request.code}"
                with open(f"exec_tmp/{temp_id}_input.txt", 'w') as f:
                    f.write(request.input)
            
            with open(filepath, 'w') as f:
                f.write(code_to_run)
            
            result = subprocess.run(
                ['python3', filepath],
                capture_output=True,
                text=True,
                timeout=10
            )
            output = result.stdout
            error_msg = result.stderr if result.returncode != 0 else None
            success = result.returncode == 0
        

        elif request.language.lower() in ["javascript", "js", "node"]:
            filepath = f"exec_tmp/{temp_id}.js"
            
            code_to_run = request.code
            if request.input:
                code_to_run = f"const input = `{request.input}`;\n{request.code}"
            
            with open(filepath, 'w') as f:
                f.write(code_to_run)
            
            result = subprocess.run(
                ['node', filepath],
                capture_output=True,
                text=True,
                timeout=10
            )
            output = result.stdout
            error_msg = result.stderr if result.returncode != 0 else None
            success = result.returncode == 0
        
        elif request.language.lower() == "java":
            filepath = f"exec_tmp/{temp_id}.java"
            
            with open(filepath, 'w') as f:
                f.write(request.code)
            
            compile_result = subprocess.run(
                ['javac', filepath],
                capture_output=True,
                text=True,
                timeout=10,
                cwd="exec_tmp"
            )
            
            if compile_result.returncode == 0:
                class_name = os.path.splitext(os.path.basename(filepath))[0]
                result = subprocess.run(
                    ['java', class_name],
                    capture_output=True,
                    text=True,
                    timeout=10,
                    cwd="exec_tmp",
                    input=request.input
                )
                output = result.stdout
                error_msg = result.stderr if result.returncode != 0 else None
                success = result.returncode == 0
            else:
                error_msg = f"Compilation Error:\n{compile_result.stderr}"
        
  
        elif request.language.lower() in ["cpp", "c++"]:
            filepath = f"exec_tmp/{temp_id}.cpp"
            out_path = f"exec_tmp/{temp_id}_out"
            
            with open(filepath, 'w') as f:
                f.write(request.code)
            
            compile_result = subprocess.run(
                ['g++', '-std=c++17', '-o', out_path, filepath],
                capture_output=True,
                text=True,
                timeout=10
            )
            
            if compile_result.returncode == 0:
                result = subprocess.run(
                    [out_path],
                    capture_output=True,
                    text=True,
                    timeout=10,
                    input=request.input
                )
                output = result.stdout
                error_msg = result.stderr if result.returncode != 0 else None
                success = result.returncode == 0
            else:
                error_msg = f"Compilation Error:\n{compile_result.stderr}"
   
        elif request.language.lower() == "c":
            filepath = f"exec_tmp/{temp_id}.c"
            out_path = f"exec_tmp/{temp_id}_out"
            
            with open(filepath, 'w') as f:
                f.write(request.code)
            
            compile_result = subprocess.run(
                ['gcc', '-o', out_path, filepath],
                capture_output=True,
                text=True,
                timeout=10
            )
            
            if compile_result.returncode == 0:
                result = subprocess.run(
                    [out_path],
                    capture_output=True,
                    text=True,
                    timeout=10,
                    input=request.input
                )
                output = result.stdout
                error_msg = result.stderr if result.returncode != 0 else None
                success = result.returncode == 0
            else:
                error_msg = f"Compilation Error:\n{compile_result.stderr}"
        
        else:
            error_msg = f"Unsupported language: {request.language}"
      
        for ext in ['.py', '.js', '.java', '.cpp', '.c', '_out', '.class', '_input.txt']:
            try:
                os.remove(f"exec_tmp/{temp_id}{ext}")
            except:
                pass
        
        execution_time = round(time.time() - start_time, 3)
        

        try:
            db.collection("codeExecutions").add({
                "userId": uid,
                "language": request.language,
                "code": request.code[:500],
                "success": success,
                "executionTime": execution_time,
                "timestamp": firestore.SERVER_TIMESTAMP
            })
        except Exception as firestore_error:
            logger.error(f"Firestore logging error: {firestore_error}")
        
        return ExecuteCodeResponse(
            output=output or "No output",
            error=error_msg,
            executionTime=execution_time,
            language=request.language,
            success=success
        )
    
    except subprocess.TimeoutExpired:
        logger.error(f"Code execution timeout for user: {uid}")
        return ExecuteCodeResponse(
            output="",
            error="Execution timed out (10 seconds limit)",
            executionTime=10.0,
            language=request.language,
            success=False
        )
    
    except Exception as e:
        logger.error(f"Code execution error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Code execution failed: {str(e)}"
        )


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)