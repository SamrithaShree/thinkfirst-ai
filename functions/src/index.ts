import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { GoogleGenAI, Type } from "@google/genai";
import axios from "axios"; 

admin.initializeApp();

const getApiKey = (): string => {
  const envKey = process.env.GEMINI_API_KEY;
  if (envKey) {
    console.log('✅ Using Gemini API key from .env');
    return envKey;
  }
  
  const configKey = functions.config().gemini?.api_key;
  if (!configKey) {
    throw new Error('GEMINI_API_KEY not configured in .env or Firebase config');
  }
  
  console.log('✅ Using Gemini API key from Firebase config');
  return configKey;
};

// ==================== REAL-TIME DATA FUNCTIONS ====================

async function fetchWeather(city: string, country: string = "IN"): Promise<any> {
  try {
    const apiKey = process.env.OPENWEATHER_API_KEY || functions.config().weather?.api_key;
    if (!apiKey) return { error: "Weather API not configured" };
    
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${city},${country}&appid=${apiKey}&units=metric`;
    const response = await axios.get(url);
    
    return {
      temperature: response.data.main.temp,
      feelsLike: response.data.main.feels_like,
      condition: response.data.weather[0].description,
      humidity: response.data.main.humidity,
      city: response.data.name,
    };
  } catch (error) {
    return { error: "Unable to fetch weather data" };
  }
}

async function fetchNews(query: string): Promise<any> {
  try {
    const apiKey = process.env.NEWS_API_KEY || functions.config().news?.api_key;
    if (!apiKey) return { error: "News API not configured" };
    
    const url = `https://newsapi.org/v2/top-headlines?q=${query}&apiKey=${apiKey}`;
    const response = await axios.get(url);
    
    const headlines = response.data.articles.slice(0, 3).map((article: any) => ({
      title: article.title,
      description: article.description,
    }));
    
    return { headlines };
  } catch (error) {
    return { error: "Unable to fetch news data" };
  }
}

// ==================== ATTEMPT TRACKING ====================

interface ConversationContext {
  currentTopic: string | null;
  attemptCount: number;
  isLearningMode: boolean;
}

function analyzeContext(
  message: string,
  conversationHistory: any[],
  previousContext?: ConversationContext
): ConversationContext {
  const msgLower = message.toLowerCase();
  
  // Learning keywords indicate new problem/question
  const learningKeywords = ["how", "explain", "solve", "algorithm", "what is", "calculate", "find", "implement", "why does", "can you show"];
  const isNewLearningQuestion = learningKeywords.some(kw => msgLower.includes(kw)) && msgLower.length > 10;
  
  // Follow-up keywords indicate related question (not a new attempt)
  const followUpKeywords = ["complexity", "what about", "also", "additionally", "can you explain more", "why", "time complexity", "space complexity"];
  const isFollowUp = followUpKeywords.some(kw => msgLower.includes(kw));
  
  // General chat patterns
  const chatKeywords = ["hello", "hi", "thanks", "thank you", "okay", "ok", "got it"];
  const isGeneralChat = chatKeywords.some(kw => msgLower === kw || msgLower.startsWith(kw + " "));
  
  // Extract topic from message
  const extractTopic = (msg: string): string => {
    const words = msg.toLowerCase().split(" ");
    const stopWords = ["how", "to", "the", "a", "an", "what", "is", "explain", "can", "you", "i", "do"];
    const meaningful = words.filter(w => !stopWords.includes(w) && w.length > 3);
    return meaningful.slice(0, 3).join(" ");
  };
  
  // Decision logic
  if (isGeneralChat) {
    return { currentTopic: null, attemptCount: 0, isLearningMode: false };
  }
  
  if (isNewLearningQuestion && !isFollowUp) {
    // New learning question - reset topic and attempts
    return {
      currentTopic: extractTopic(message),
      attemptCount: 0,
      isLearningMode: true,
    };
  }
  
  if (isFollowUp && previousContext?.currentTopic) {
    // Follow-up question - keep same topic and attempt count
    return {
      currentTopic: previousContext.currentTopic,
      attemptCount: previousContext.attemptCount,
      isLearningMode: true,
    };
  }
  
  if (previousContext?.isLearningMode && previousContext?.currentTopic && !isFollowUp) {
    // User is attempting to solve - increment attempt
    return {
      currentTopic: previousContext.currentTopic,
      attemptCount: previousContext.attemptCount + 1,
      isLearningMode: true,
    };
  }
  
  // Default: maintain or start fresh
  return previousContext || { currentTopic: null, attemptCount: 0, isLearningMode: false };
}

// ==================== MAIN FUNCTION ====================

export const chat = functions.https.onRequest(async (req, res) => {
  // CORS
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }
  
  try {
    const { message, conversationHistory, conversationContext } = req.body;
    
    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'Invalid message' });
      return;
    }
    
    if (!Array.isArray(conversationHistory)) {
      res.status(400).json({ error: 'Invalid conversation history' });
      return;
    }
    
    // Analyze conversation context
    const currentContext = analyzeContext(message, conversationHistory, conversationContext);
    
    console.log('📊 Context:', currentContext);
    
    const ai = new GoogleGenAI({ apiKey: getApiKey() });
    
    // Check for real-time data needs
    let realTimeData = "";
    const msgLower = message.toLowerCase();
    
    if (msgLower.includes("weather") || msgLower.includes("temperature")) {
      // Extract city from message (simple extraction)
      const cityMatch = message.match(/in\s+([A-Za-z]+)/i) || message.match(/weather\s+([A-Za-z]+)/i);
      const city = cityMatch ? cityMatch[1] : "Delhi";
      const weatherData = await fetchWeather(city);
      
      if (!weatherData.error) {
        realTimeData = `\n\n[REAL-TIME DATA] Current weather in ${weatherData.city}: ${weatherData.temperature}°C, ${weatherData.condition}, humidity ${weatherData.humidity}%. Use this data in your response.`;
      }
    }
    
    if (msgLower.includes("news") || msgLower.includes("latest")) {
      const query = message.replace(/news|latest|about/gi, "").trim() || "technology";
      const newsData = await fetchNews(query);
      
      if (!newsData.error && newsData.headlines) {
        realTimeData = `\n\n[REAL-TIME DATA] Latest news: ${newsData.headlines.map((h: any) => h.title).join("; ")}. Use this data in your response.`;
      }
    }
    
    // Build enhanced system prompt
    let systemPrompt = `You are ThinkFirst AI, an intelligent educational assistant that adapts to the user's needs.

**YOUR CORE RULES:**
1. **RESPOND DIRECTLY** - Give your answer immediately without explaining your thought process
2. **NO META-COMMENTARY** - Don't say things like "Here's how to proceed"
3. **BE NATURAL** - Talk like a friendly tutor, not a robot
4. **USE REAL-TIME DATA** - When real-time data is provided, use it naturally in your response

**BEHAVIOR:**

**For General Chat:**
- Answer naturally and conversationally
- Be friendly and helpful`;
    
    if (currentContext.isLearningMode) {
      const { attemptCount, currentTopic } = currentContext;
      
      systemPrompt += `

**CURRENT MODE: LEARNING MODE**
Topic: "${currentTopic}"
Attempt: ${attemptCount}

**PROGRESSIVE GUIDANCE:**
`;
      
      if (attemptCount === 0) {
        systemPrompt += `- This is the FIRST interaction with this topic
- Give a conceptual hint that makes them think
- Ask guiding questions
- Set isHint: true, isSolution: false`;
      } else if (attemptCount === 1) {
        systemPrompt += `- This is attempt ${attemptCount} (SECOND attempt)
- Provide stronger hints with techniques or approaches
- Point toward relevant concepts/algorithms
- Set isHint: true, isSolution: false`;
      } else if (attemptCount === 2) {
        systemPrompt += `- This is attempt ${attemptCount} (THIRD attempt)
- Give pseudocode or step-by-step roadmap
- Be explicit about the approach
- Set isHint: true, isSolution: false`;
      } else {
        systemPrompt += `- This is attempt ${attemptCount} (FOURTH+ attempt)
- Provide COMPLETE solution with detailed explanation
- Include code examples if relevant
- Explain WHY each step works
- Set isHint: false, isSolution: true`;
      }
      
      systemPrompt += `

**IMPORTANT:** If user asks a follow-up question about the SAME topic (like "what about complexity?" or "why?"), answer directly without treating it as a new attempt.`;
    }
    
    // Build conversation history
    const historyString = conversationHistory
      .map((msg: any) => `${msg.role === 'user' ? 'User' : 'AI'}: ${msg.text}`)
      .join('\n');
    
    const prompt = historyString
      ? `${historyString}\n\nUser: ${message}${realTimeData}`
      : `User: ${message}${realTimeData}`;
    
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            text: { type: Type.STRING },
            mode: { type: Type.STRING, enum: ['learning', 'chat'] },
            isHint: { type: Type.BOOLEAN },
            isSolution: { type: Type.BOOLEAN }
          },
          required: ["text", "mode", "isHint", "isSolution"]
        }
      }
    });
    
    const result = JSON.parse(response.text || '{}');
    
    // Return response with updated context
    res.status(200).json({
      ...result,
      conversationContext: currentContext, // Send context back to frontend
    });
    
  } catch (error: any) {
    functions.logger.error("Chat Error:", error);
    res.status(500).json({
      error: "Internal server error",
      details: error.message || "Unknown error"
    });
  }
});
