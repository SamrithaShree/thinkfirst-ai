// src/hooks/useChat.ts

import { useState, useEffect } from 'react';
import { auth } from '../firebase';
import {
  getSession,
  getSessionMessages,
  addMessage,
  updateSession,
  incrementProgress
} from '../services/firebase/firestore';
import { ChatSession, ChatMessage } from '../types';

// ADD: ConversationContext interface
interface ConversationContext {
  currentTopic: string | null;
  attemptCount: number;
  isLearningMode: boolean;
}

export const useChat = (sessionId: string) => {
  const [session, setSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  
  // ADD: Track conversation context
  const [conversationContext, setConversationContext] = useState<ConversationContext>({
    currentTopic: null,
    attemptCount: 0,
    isLearningMode: false,
  });

  // Load session and messages on mount
  useEffect(() => {
    const loadData = async () => {
      if (!sessionId || !auth.currentUser) {
        setLoading(false);
        return;
      }

      try {
        const [sessionData, messagesData] = await Promise.all([
          getSession(sessionId),
          getSessionMessages(sessionId)
        ]);
        setSession(sessionData);
        setMessages(messagesData);
      } catch (error) {
        console.error('Error loading chat data:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [sessionId]);

  const sendMessage = async (text: string) => {
    if (!sessionId || !auth.currentUser || !text.trim()) return;

    setSending(true);

    try {
      // Add user message
      const userMessage: Omit<ChatMessage, 'id'> = {
        role: 'user',
        text: text.trim(),
        timestamp: Date.now(),
        senderId: auth.currentUser.uid,
        createdAt: Date.now(),
      };

      const userMessageId = await addMessage(sessionId, userMessage);

      // Update local state immediately
      setMessages(prev => [...prev, { ...userMessage, id: userMessageId }]);

      // Call backend for AI response
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:5001/think-first-ai/us-central1/chat';

      try {
        // Debug log
        console.log('Sending to backend:', {
          message: text,
          conversationHistory: messages.length,
          conversationContext, // ADD: Send context
        });

        // UPDATED: Include conversationContext
        const response = await fetch(backendUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text,
            conversationHistory: messages.map(m => ({
              role: m.role,
              text: m.text
            })),
            conversationContext, // ADD: Send context to backend
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('Backend error details:', errorText);
          throw new Error(`Backend error: ${response.status}`);
        }

        const aiResponse = await response.json();
        console.log('AI Response:', aiResponse);

        // ADD: Update conversation context from backend
        if (aiResponse.conversationContext) {
          setConversationContext(aiResponse.conversationContext);
          console.log('📊 Updated Context:', aiResponse.conversationContext);
        }

        // Add AI response with smart mode detection
        const aiMessage: Omit<ChatMessage, 'id'> = {
          role: 'ai',
          text: aiResponse.text,
          timestamp: Date.now(),
          senderId: 'ai',
          createdAt: Date.now(),
          metadata: {
            isHint: aiResponse.isHint ?? false,
            isSolution: aiResponse.isSolution ?? false,
            detectedIntent: aiResponse.metadata?.detectedIntent ?? 'general_chat'
          },
          mode: aiResponse.mode || 'chat'
        };

        const aiMessageId = await addMessage(sessionId, aiMessage);
        setMessages(prev => [...prev, { ...aiMessage, id: aiMessageId }]);

        // Update session mode based on AI detection
        const newMode = aiResponse.mode || 'chat';
        await updateSession(sessionId, { mode: newMode });
        setSession(prev => prev ? { ...prev, mode: newMode } : null);

        // Track progress for learning interactions
        if (aiResponse.isHint) {
          await incrementProgress(auth.currentUser.uid, 'hintsUsed');
        }
        if (aiResponse.isSolution) {
          await incrementProgress(auth.currentUser.uid, 'solutionsUnlocked');
        }

      } catch (backendError) {
        console.error('Backend call failed:', backendError);
        
        // Fallback: Mock AI response if backend fails
        console.warn('Using fallback mock response due to backend error.');
        const mockAiMessage: Omit<ChatMessage, 'id'> = {
          role: 'ai',
          text: `I'm having trouble connecting to my AI brain right now. 🤔\n\nYour question: "${text}"\n\nPlease make sure:\n1. Firebase Functions are deployed\n2. VITE_BACKEND_URL is set correctly\n3. Gemini API key is configured\n\nTry again in a moment!`,
          timestamp: Date.now(),
          senderId: 'ai',
          createdAt: Date.now(),
          metadata: {
            isHint: false,
            isSolution: false,
            detectedIntent: 'error'
          },
          mode: 'chat'
        };

        const mockMessageId = await addMessage(sessionId, mockAiMessage);
        setMessages(prev => [...prev, { ...mockAiMessage, id: mockMessageId }]);
      }

    } catch (error) {
      console.error('Error sending message:', error);
      
      // Add user-friendly error message
      const errorMessage: Omit<ChatMessage, 'id'> = {
        role: 'ai',
        text: 'Sorry, I encountered an unexpected error. Please check your internet connection and try again. 🔄',
        timestamp: Date.now(),
        senderId: 'ai',
        createdAt: Date.now(),
        metadata: {
          isHint: false,
          isSolution: false,
          detectedIntent: 'error'
        },
        mode: 'chat'
      };

      const errorMessageId = await addMessage(sessionId, errorMessage);
      setMessages(prev => [...prev, { ...errorMessage, id: errorMessageId }]);
    } finally {
      setSending(false);
    }
  };

  return {
    session,
    messages,
    loading,
    sending,
    sendMessage,
    conversationContext, // ADD: Expose context for debugging
  };
};
