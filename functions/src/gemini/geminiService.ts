// // functions/src/gemini/geminiService.ts
// import { GoogleGenerativeAI } from "@google/generative-ai";

// // ========== TYPES ==========
// export interface ChatRequest {
//   message: string;
//   conversationHistory: Array<{ role: string; text: string }>;
// }

// export interface ChatResponse {
//   text: string;
//   mode: 'learning' | 'chat';
//   metadata?: {
//     isHint?: boolean;
//     isSolution?: boolean;
//     detectedIntent?: string;
//   };
// }

// // ========== SMART SYSTEM PROMPT ==========
// const SMART_TUTOR_PROMPT = `You are ThinkFirst AI, an intelligent educational assistant that adapts to the user's needs.

// **YOUR CORE RULES:**

// 1. **RESPOND DIRECTLY** - Give your answer immediately without explaining your thought process
// 2. **NO META-COMMENTARY** - Don't say things like "Here's how to proceed" or "Let me analyze"
// 3. **BE NATURAL** - Talk like a friendly tutor, not a robot following instructions

// **BEHAVIOR GUIDELINES:**

// **For Learning Questions (Math, DSA, Coding):**
// - If they show NO effort → Ask guiding questions to make them think
// - If they show SOME effort → Give targeted hints about their approach
// - If they show GOOD effort OR ask for solution → Provide step-by-step explanation

// **For General Chat:**
// - Answer naturally and conversationally
// - Be friendly and informative
// - Just answer the question directly

// **EXAMPLES OF GOOD RESPONSES:**

// User: "How do I solve merge sort?"
// You: "I'd love to help! What's your understanding of how merge sort works? Have you thought about breaking the array into smaller pieces?"

// User: "I tried recursion but get stack overflow: [code]"
// You: "Good attempt with recursion! The stack overflow usually means your base case isn't stopping the recursion. What should happen when your array has only 1 element?"

// User: "I've tried everything, here's my detailed attempt: [code]"
// You: "You've shown great effort! Here's the complete solution:

// 1. First, divide the array in half recursively
// 2. Sort each half separately
// 3. Merge the sorted halves back together

// Here's the code: [provide solution]"

// User: "What's the weather?"
// You: "I don't have real-time weather data, but I can help you understand weather patterns or coding projects related to weather APIs!"

// User: "Hello!"
// You: "Hello! How can I help you today?"

// **REMEMBER: Respond naturally. Don't include your thinking process in the response.**`;

// // ========== MAIN SERVICE ==========
// export const createGeminiService = (apiKey: string) => {
//   const genAI = new GoogleGenerativeAI(apiKey);

//   return {
//     processChat: async (request: ChatRequest): Promise<ChatResponse> => {
//       const { message, conversationHistory } = request;

//       const model = genAI.getGenerativeModel({
//         model: 'gemini-1.5-flash',  
//         systemInstruction: SMART_TUTOR_PROMPT,
//         generationConfig: {
//           temperature: 0.7,
//           maxOutputTokens: 2048,
//           topP: 0.9,
//         },
//       });

//       // Build conversation history for context
//       const chatHistory = conversationHistory.map(msg => ({
//         role: msg.role === 'user' ? 'user' : 'model',
//         parts: [{ text: msg.text }],
//       }));

//       // Start chat with history
//       const chat = model.startChat({
//         history: chatHistory,
//       });

//       // Send message
//       const result = await chat.sendMessage(message);
//       const responseText = result.response.text();

//       // Simple intent detection (for metadata)
//       const isLearningQuestion = /\b(how do|solve|algorithm|code|implement|debug|error|help me with|explain)\b/i.test(message);
//       const hasCode = message.includes('```') || /function|class|const\s|let\s|var\s|def\s/i.test(message);
//       const hasEffort = message.length > 100 || hasCode;

//       return {
//         text: responseText,
//         mode: isLearningQuestion ? 'learning' : 'chat',
//         metadata: {
//           detectedIntent: isLearningQuestion ? 'learning' : 'general_chat',
//           isHint: isLearningQuestion && !hasEffort,
//           isSolution: isLearningQuestion && hasEffort,
//         },
//       };
//     },
//   };
// };
