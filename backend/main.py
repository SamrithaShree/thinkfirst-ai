from fastapi import FastAPI, HTTPException, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
import firebase_admin
from firebase_admin import credentials, auth, firestore
from groq import Groq
from dotenv import load_dotenv

import json
import re
from datetime import datetime
import logging
import subprocess, os, uuid

load_dotenv()
# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI
app = FastAPI(
    title="ThinkFirst AI Backend",
    version="2.0.0",
    description="Educational AI with Progressive Learning & Amnesia Mode"
)

# CORS Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "https://think-first-ai.web.app",
        "https://think-first-ai.firebaseapp.com",
        "*"  # For development - restrict in production
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Security
security = HTTPBearer()

# Initialize Firebase Admin SDK
try:
    if os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON"):
        service_account_info = json.loads(os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON"))
        cred = credentials.Certificate(service_account_info)
    else:
        cred = credentials.Certificate("./serviceAccountKey.json")
    
    firebase_admin.initialize_app(cred)
    db = firestore.client()
    logger.info("✅ Firebase Admin SDK initialized successfully")
except Exception as e:
    logger.error(f"❌ Firebase initialization error: {e}")
    raise

# Initialize Groq Client
groq_api_key = os.getenv("GROQ_API_KEY")
if not groq_api_key:
    raise ValueError("GROQ_API_KEY environment variable is required")

groq_client = Groq(api_key=groq_api_key)

# ==================== PYDANTIC MODELS ====================

class ConversationMessage(BaseModel):
    role: str
    text: str

class ConversationContext(BaseModel):
    currentTopic: Optional[str] = None
    attemptCount: int = 0
    isLearningMode: bool = False

class ChatRequest(BaseModel):
    message: str
    conversationHistory: List[ConversationMessage] = []
    conversationContext: Optional[ConversationContext] = None
    sessionId: Optional[str] = None

class ChatResponse(BaseModel):
    text: str
    mode: str
    isHint: bool = False
    isSolution: bool = False
    conversationContext: ConversationContext

class AmnesiaCheckRequest(BaseModel):
    originalSolution: str
    userReconstruction: str
    currentTopic: Optional[str] = None

class AmnesiaCheckResponse(BaseModel):
    logicScore: int
    keyConcepts: List[str]
    missedConcepts: List[str]
    feedback: str

class CodeRequest(BaseModel):
    code: str
    language: str

# ==================== FIREBASE AUTH VERIFICATION ====================

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

# ==================== CONTEXT ANALYSIS (FROM YOUR FIREBASE FUNCTIONS) ====================

def analyze_context(
    message: str,
    conversation_history: List[ConversationMessage],
    previous_context: Optional[ConversationContext]
) -> ConversationContext:
    """
    Smart context analyzer - preserves your exact logic from Firebase Functions
    """
    msg_lower = message.lower().strip()
    
    # ============ PRIORITY CHECK: REAL-TIME DATA REQUESTS ============
    weather_patterns = ["weather", "temperature", "how hot", "how cold", "climate", "forecast"]
    news_patterns = ["news", "today's news", "latest news", "current events", "headlines", "what's happening", "news update"]
    
    is_weather_request = any(p in msg_lower for p in weather_patterns)
    is_news_request = any(p in msg_lower for p in news_patterns)
    
    if is_weather_request or is_news_request:
        logger.info('🌐 Real-time data request detected - staying in chat mode')
        return ConversationContext(
            currentTopic=None,
            attemptCount=0,
            isLearningMode=False
        )
    
    # Solution request phrases
    solution_request_phrases = [
        "give me the answer", "give the answer", "just give me",
        "give me solution", "give the solution", "show me the answer",
        "show the solution", "what is the solution", "what's the solution",
        "tell me the solution", "just show me", "just tell me"
    ]
    is_asking_for_solution = any(phrase in msg_lower for phrase in solution_request_phrases)
    
    # Genuine attempt phrases
    attempt_phrases = [
        "i tried", "i think", "maybe", "is it", "would it be",
        "should i", "idk", "i don't know", "not sure", "i'm stuck", "can't figure"
    ]
    is_genuine_attempt = any(phrase in msg_lower for phrase in attempt_phrases)
    
    # Back to previous topic
    back_to_previous_phrases = ["back to", "return to", "again about", "still don't get"]
    is_returning_to_previous = any(phrase in msg_lower for phrase in back_to_previous_phrases)
    
    # New learning question
    learning_keywords = [
        "how do i", "how to", "how about", "what about",
        "explain", "solve", "algorithm for", "solution for", "implement"
    ]
    is_new_learning_question = any(kw in msg_lower for kw in learning_keywords)
    
    # Follow-up questions (don't increment attempt)
    follow_up_keywords = [
        "time complexity", "space complexity", "complexity",
        "why does this", "why is", "can you explain more",
        "what do you mean", "how does that", "give me a hint",
        "give hint", "another hint"
    ]
    is_follow_up = any(kw in msg_lower for kw in follow_up_keywords)
    
    # General chat
    chat_keywords = ["hello", "hi", "hey", "thanks", "thank you", "okay", "ok", "got it", "cool"]
    is_general_chat = any(
        msg_lower == kw or msg_lower.startswith(f"{kw} ") or msg_lower.startswith(f"{kw}!")
        for kw in chat_keywords
    )
    
    # Extract topic helper
    def extract_topic(msg: str) -> str:
        words = msg.lower().split()
        stop_words = ["how", "to", "the", "a", "an", "what", "is", "explain", "can", "you", "i", "do", "about", "for"]
        meaningful = [w for w in words if w not in stop_words and len(w) > 3]
        return " ".join(meaningful[:3])
    
    # DECISION LOGIC (Exact from Firebase Functions)
    
    # 1. General chat - reset everything
    if is_general_chat and not is_new_learning_question:
        logger.info('💬 Detected: General chat')
        return ConversationContext(currentTopic=None, attemptCount=0, isLearningMode=False)
    
    # 2. New learning question - reset topic and attempts
    if is_new_learning_question and not is_returning_to_previous:
        new_topic = extract_topic(message)
        logger.info(f'📚 Detected: New learning question - {new_topic}')
        return ConversationContext(
            currentTopic=new_topic,
            attemptCount=0,
            isLearningMode=True
        )
    
    # 3. Returning to previous topic
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
            logger.info(f'🔄 Detected: Returning to previous topic - {relevant_topic}')
            return ConversationContext(
                currentTopic=relevant_topic,
                attemptCount=0,
                isLearningMode=True
            )
    
    # 4. Follow-up question - SAME topic, SAME attempt count
    if is_follow_up and previous_context and previous_context.currentTopic:
        logger.info('❓ Detected: Follow-up question (no increment)')
        return ConversationContext(
            currentTopic=previous_context.currentTopic,
            attemptCount=previous_context.attemptCount,
            isLearningMode=True
        )
    
    # 5. Direct solution request - jump to solution
    if is_asking_for_solution and previous_context and previous_context.isLearningMode:
        logger.info('🎯 Detected: Direct solution request')
        return ConversationContext(
            currentTopic=previous_context.currentTopic,
            attemptCount=max(previous_context.attemptCount, 3),
            isLearningMode=True
        )
    
    # 6. Genuine attempt - increment
    if is_genuine_attempt and previous_context and previous_context.isLearningMode and previous_context.currentTopic:
        logger.info('✍️ Detected: Genuine attempt (increment)')
        return ConversationContext(
            currentTopic=previous_context.currentTopic,
            attemptCount=previous_context.attemptCount + 1,
            isLearningMode=True
        )
    
    # 7. Substantive response - increment
    if (previous_context and previous_context.isLearningMode and
        previous_context.currentTopic and not is_follow_up and
        not is_asking_for_solution and len(message) > 10):
        logger.info('📝 Detected: Substantive response (increment)')
        return ConversationContext(
            currentTopic=previous_context.currentTopic,
            attemptCount=previous_context.attemptCount + 1,
            isLearningMode=True
        )
    
    # 8. Default: maintain context
    logger.info('🔄 Maintaining previous context')
    return previous_context or ConversationContext(currentTopic=None, attemptCount=0, isLearningMode=False)

# ==================== SYSTEM PROMPT BUILDER ====================

def build_system_prompt(context: ConversationContext) -> str:
    """Build progressive system prompt based on attempt count"""
    
    base_prompt = """You are ThinkFirst AI, an intelligent educational assistant that adapts to the user's needs.

**YOUR CORE RULES:**
1. **RESPOND DIRECTLY** - Give your answer immediately without explaining your thought process
2. **NO META-COMMENTARY** - Don't say things like "Here's how to proceed"
3. **BE NATURAL** - Talk like a friendly tutor, not a robot

**BEHAVIOR:**

**For General Chat:**
- Answer naturally and conversationally
- Be friendly and helpful"""
    
    if context.isLearningMode:
        attempt_count = context.attemptCount
        current_topic = context.currentTopic
        
        base_prompt += f"\n\n**CURRENT MODE: LEARNING MODE**\nTopic: \"{current_topic}\"\nAttempt: {attempt_count}\n\n**PROGRESSIVE GUIDANCE:**\n"
        
        if attempt_count == 0:
            base_prompt += """- This is the FIRST interaction with this topic
- Give a conceptual hint that makes them think
- Ask guiding questions to assess their understanding
- Set isHint: true, isSolution: false, mode: "learning" """
        elif attempt_count == 1:
            base_prompt += f"""- This is attempt {attempt_count} (SECOND attempt)
- Provide stronger hints with techniques or approaches
- Point toward relevant concepts/algorithms
- Set isHint: true, isSolution: false, mode: "learning" """
        elif attempt_count == 2:
            base_prompt += f"""- This is attempt {attempt_count} (THIRD attempt)
- Give pseudocode or step-by-step roadmap
- Be explicit about the approach
- Set isHint: true, isSolution: false, mode: "learning" """
        else:
            base_prompt += f"""- This is attempt {attempt_count} (FOURTH+ attempt or direct solution request)
- Provide COMPLETE solution with detailed explanation
- Include code examples with proper syntax
- Explain WHY each step works
- Set isHint: false, isSolution: true, mode: "learning" """
        
        base_prompt += "\n\n**IMPORTANT:** If user asks a follow-up question about complexity or clarification, answer directly without treating it as a new attempt."
    
    return base_prompt

# ==================== API ENDPOINTS ====================

@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "ThinkFirst AI Backend",
        "version": "2.0.0",
        "features": [
            "Progressive Learning Mode",
            "Amnesia Mode",
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
    Main chat endpoint with progressive learning mode support
    Preserves ALL features from Firebase Functions
    """
    try:
        uid = user["uid"]
        logger.info(f"📥 Chat request from user: {uid}")
        
        # Analyze conversation context
        current_context = analyze_context(
            request.message,
            request.conversationHistory,
            request.conversationContext
        )
        
        logger.info(f"📊 Context Analysis: {current_context.dict()}")
        
        # Build system prompt
        system_prompt = build_system_prompt(current_context)
        
        # Build conversation history
        groq_messages = []
        
        # Add system prompt
        groq_messages.append({
            "role": "system",
            "content": system_prompt
        })
        
        # Add conversation history
        for msg in request.conversationHistory:
            groq_messages.append({
                "role": "user" if msg.role == "user" else "assistant",
                "content": msg.text
            })
        
        # Add current message
        groq_messages.append({
            "role": "user",
            "content": f"{request.message}\n\n[Please respond in JSON format with fields: text, mode, isHint, isSolution]"
        })
        
        # Call Groq API with JSON response format
        try:
            completion = groq_client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=groq_messages,
                temperature=0.7,
                max_tokens=2048,
                top_p=0.9,
                response_format={"type": "json_object"}
            )
            
            response_text = completion.choices[0].message.content
            result = json.loads(response_text)
            
            # Ensure all required fields
            ai_text = result.get("text", response_text)
            mode = result.get("mode", "learning" if current_context.isLearningMode else "chat")
            is_hint = result.get("isHint", current_context.attemptCount < 3)
            is_solution = result.get("isSolution", current_context.attemptCount >= 3)
            
        except json.JSONDecodeError:
            # Fallback if JSON parsing fails
            logger.warning("JSON parsing failed, using raw response")
            ai_text = completion.choices[0].message.content
            mode = "learning" if current_context.isLearningMode else "chat"
            is_hint = current_context.attemptCount < 3
            is_solution = current_context.attemptCount >= 3
        
        # Save to Firestore (if sessionId provided)
        if request.sessionId:
            try:
                session_ref = db.collection("sessions").document(request.sessionId)
                messages_ref = session_ref.collection("messages")
                
                # Save user message
                messages_ref.add({
                    "role": "user",
                    "text": request.message,
                    "timestamp": firestore.SERVER_TIMESTAMP,
                    "userId": uid
                })
                
                # Save AI response
                messages_ref.add({
                    "role": "assistant",
                    "text": ai_text,
                    "timestamp": firestore.SERVER_TIMESTAMP,
                    "isHint": is_hint,
                    "isSolution": is_solution,
                    "attemptCount": current_context.attemptCount
                })
                
                # Update session metadata
                session_ref.set({
                    "mode": mode,
                    "userId": uid,
                    "lastUpdated": firestore.SERVER_TIMESTAMP,
                    "currentTopic": current_context.currentTopic,
                    "isLearningMode": current_context.isLearningMode
                }, merge=True)
                
            except Exception as firestore_error:
                logger.error(f"Firestore error: {firestore_error}")
        
        # Return response with updated context
        return ChatResponse(
            text=ai_text,
            mode=mode,
            isHint=is_hint,
            isSolution=is_solution,
            conversationContext=current_context
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
    Exact logic from Firebase Functions
    """
    try:
        uid = user["uid"]
        logger.info(f"🧠 Memory check request from user: {uid}")
        
        # Build comparison prompt (from your Firebase Functions)
        comparison_prompt = f"""You are a learning assessment AI. Compare these two solutions and check if the LOGIC and APPROACH are similar.

**IGNORE THESE (Do NOT penalize for):**
- Variable names (e.g., "nums" vs "array")
- Exact syntax (e.g., "for i in range" vs "for(int i=0...)")
- Code style and formatting
- Comments
- Language differences (Python vs JavaScript is OK)
- Minor wording differences in explanations

**ONLY CHECK THESE (Focus on):**
- Core algorithm/approach used
- Logic flow and reasoning
- Key concepts applied (e.g., "uses hash map", "sliding window technique")
- Problem-solving strategy
- Correctness of the approach

**Original Solution:**
{request.originalSolution}

**Student's Reconstruction:**
{request.userReconstruction}

Respond with a JSON object with these fields:
{{
  "logicScore": 85,
  "keyConcepts": ["array traversal", "hash map lookup"],
  "missedConcepts": ["edge case handling"],
  "feedback": "Great job remembering the core logic! You correctly used..."
}}

Be encouraging but honest. Score 90-100 = excellent recall, 70-89 = good, 50-69 = partial, <50 = needs review."""

        # Call Groq API
        completion = groq_client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert programming educator evaluating student code. Always respond with valid JSON only."
                },
                {
                    "role": "user",
                    "content": comparison_prompt
                }
            ],
            temperature=0.3,
            max_tokens=1500,
            response_format={"type": "json_object"}
        )
        
        response_text = completion.choices[0].message.content
        result = json.loads(response_text)
        
        # Save to Firestore
        try:
            # Save attempt
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
            
            # Update user stats
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
        
    except json.JSONDecodeError as e:
        logger.error(f"JSON parsing error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to parse AI response"
        )
    except Exception as e:
        logger.error(f"Memory check error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to check memory: {str(e)}"
        )
@app.post("/api/execute")
async def execute_code(request: CodeRequest):
    try:
        temp_id = str(uuid.uuid4())[:8]
        os.makedirs("exec_tmp", exist_ok=True)
        
        # ✅ FIXED PYTHON - Use FULL PATH, NO cwd
        if request.language == "python":
            filepath = f"exec_tmp/{temp_id}.py"
            with open(filepath, 'w') as f: f.write(request.code)
            full_path = os.path.abspath(filepath)
            result = subprocess.run(['python3', full_path], capture_output=True, text=True, timeout=10)
            output = result.stdout + result.stderr
        
        elif request.language == "javascript":
            filepath = f"exec_tmp/{temp_id}.js"
            with open(filepath, 'w') as f: f.write(request.code)
            full_path = os.path.abspath(filepath)
            result = subprocess.run(['node', full_path], capture_output=True, text=True, timeout=10)
            output = result.stdout + result.stderr
        
        elif request.language == "java":
            filepath = f"exec_tmp/{temp_id}.java"
            with open(filepath, 'w') as f: f.write(request.code)
            full_path = os.path.abspath(filepath)
            compile_result = subprocess.run(['javac', full_path], capture_output=True, text=True, timeout=10, cwd="exec_tmp")
            if compile_result.returncode == 0:
                class_name = os.path.splitext(os.path.basename(filepath))[0]
                result = subprocess.run(['java', class_name], capture_output=True, text=True, timeout=10, cwd="exec_tmp")
                output = result.stdout + result.stderr
            else:
                output = f"Compile Error:\n{compile_result.stderr}"
        
        elif request.language == "cpp":
            filepath = f"exec_tmp/{temp_id}.cpp"
            with open(filepath, 'w') as f: f.write(request.code)
            full_path = os.path.abspath(filepath)
            out_path = os.path.abspath(f"exec_tmp/{temp_id}_out")
            compile_result = subprocess.run([
                'clang++', '-std=c++11', '-o', out_path, full_path
            ], capture_output=True, text=True, timeout=10, cwd="exec_tmp")
            if compile_result.returncode == 0:
                result = subprocess.run([out_path], capture_output=True, text=True, timeout=10, cwd="exec_tmp")
                output = result.stdout + result.stderr
            else:
                output = f"Compile Error:\n{compile_result.stderr}"
        
        elif request.language == "c":
            filepath = f"exec_tmp/{temp_id}.c"
            with open(filepath, 'w') as f: f.write(request.code)
            full_path = os.path.abspath(filepath)
            out_path = os.path.abspath(f"exec_tmp/{temp_id}_out")
            compile_result = subprocess.run(['clang', '-o', out_path, full_path], 
                                          capture_output=True, text=True, timeout=10, cwd="exec_tmp")
            if compile_result.returncode == 0:
                result = subprocess.run([out_path], capture_output=True, text=True, timeout=10, cwd="exec_tmp")
                output = result.stdout + result.stderr
            else:
                output = f"Compile Error:\n{compile_result.stderr}"
        else:
            output = "Language not supported"
        
        # Cleanup
        for ext in ['.py', '.js', '.java', '.cpp', '.c', '_out', '.class']:
            try: os.remove(f"exec_tmp/{temp_id}{ext}")
            except: pass
                
        return {"output": output}
    except Exception as e:
        return {"error": str(e)}
# Run with: uvicorn main:app --host 0.0.0.0 --port $PORT
if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
