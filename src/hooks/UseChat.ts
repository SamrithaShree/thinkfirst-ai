import { useState, useEffect } from 'react';
import { auth } from '../firebase';
import {
  getSession,
  getSessionMessages,
  addMessage,
  updateSession,
  incrementProgress,
  trackProblemEffort,  
  trackWeeklyHint      
} from '../services/firebase/firestore';
import { ChatSession, ChatMessage, TimeTravelContext } from '../types';
import {
  trackHintShown,
  trackSolutionUnlocked,
  trackAttemptSubmitted,
  trackModeSwitched,
} from "../lib/analytics";
import axios from 'axios';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';

interface ConversationContext {
  currentTopic: string | null;
  attemptCount: number;
  isLearningMode: boolean;
}

interface TopicTracker {
  [topicKey: string]: {
    attemptCount: number;
    lastMessageIndex: number;
  };
}

interface GroqResponse {
  text: string;
  mode: 'learning' | 'chat';
  isHint?: boolean;
  isSolution?: boolean;
  metadata?: {
    detectedIntent?: string;
  };
}

async function fetchWeather(city: string, country: string = "IN"): Promise<any> {
  try {
    const apiKey = import.meta.env.VITE_OPENWEATHER_API_KEY;
    if (!apiKey) {
      console.warn('Weather API key not configured');
      return { error: "Weather API not configured" };
    }
    
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${city},${country}&appid=${apiKey}&units=metric`;
    console.log('Fetching weather for:', city);
    const response = await axios.get(url);
    
    return {
      temperature: response.data.main.temp,
      feelsLike: response.data.main.feels_like,
      condition: response.data.weather[0].description,
      humidity: response.data.main.humidity,
      city: response.data.name,
    };
  } catch (error) {
    console.error('Weather API error:', error);
    return { error: "Unable to fetch weather data" };
  }
}

async function fetchNews(query: string): Promise<any> {
  try {
    const apiKey = import.meta.env.VITE_NEWS_API_KEY;
    if (!apiKey) {
      console.warn('News API key not configured');
      return { error: "News API not configured" };
    }
    
    const url = `https://newsapi.org/v2/top-headlines?q=${query}&apiKey=${apiKey}`;
    console.log('Fetching news for:', query);
    const response = await axios.get(url);
    
    const headlines = response.data.articles.slice(0, 3).map((article: any) => ({
      title: article.title,
      description: article.description,
    }));
    
    return { headlines };
  } catch (error) {
    console.error('News API error:', error);
    return { error: "Unable to fetch news data" };
  }
}

function analyzeContext(
  message: string,
  conversationHistory: ChatMessage[],
  previousContext: ConversationContext,
  topicTracker: TopicTracker
): { context: ConversationContext; updatedTracker: TopicTracker } {
  const msgLower = message.toLowerCase().trim();
  const weatherPatterns = ["weather", "temperature", "how hot", "how cold", "climate", "forecast"];
  const newsPatterns = ["news", "today's news", "latest news", "current events", "headlines", "what's happening", "news update"];
  
  const isWeatherRequest = weatherPatterns.some(p => msgLower.includes(p));
  const isNewsRequest = newsPatterns.some(p => msgLower.includes(p));
  
  if (isWeatherRequest || isNewsRequest) {
    console.log('Real-time data request detected - staying in chat mode');
    return { 
      context: { 
        currentTopic: null, 
        attemptCount: 0, 
        isLearningMode: false
      },
      updatedTracker: topicTracker
    };
  }
  
  const solutionRequestPhrases = [
    "give me the answer",
    "give the answer",
    "give me solution",
    "give the solution",
    "show me the answer",
    "show the solution",
    "what is the solution",
    "what's the solution",
    "tell me the solution",
    "i give up",
    "just tell me"
  ];
  const isAskingForSolution = solutionRequestPhrases.some(phrase => msgLower.includes(phrase)) && 
                               previousContext?.isLearningMode && 
                               previousContext?.attemptCount > 0;
  
  const attemptPhrases = [
    "i tried",
    "i think",
    "maybe",
    "is it",
    "would it be",
    "should i",
    "idk",
    "i don't know",
    "not sure",
    "i'm stuck",
    "can't figure"
  ];
  const isGenuineAttempt = attemptPhrases.some(phrase => msgLower.includes(phrase));
  const backToPreviousPhrases = [
    "back to",
    "return to",
    "again about",
    "still don't get"
  ];
  const isReturningToPrevious = backToPreviousPhrases.some(phrase => msgLower.includes(phrase));
  
  const learningKeywords = [
    "how do i",
    "how to",
    "how about",
    "what about",
    "explain",
    "solve",
    "algorithm for",
    "solution for",
    "implement",
    "calculate",
    "compute",
    "find",
    "integrate",
    "derive",
    "prove",
    "answer of",
    "answer to",
    "final answer",
    "result of",
    "value of"
  ];
  const isNewLearningQuestion = learningKeywords.some(kw => msgLower.includes(kw));
  
  const followUpKeywords = [
    "time complexity",
    "space complexity",
    "complexity",
    "why does this",
    "why is",
    "can you explain more",
    "what do you mean",
    "how does that",
    "give me a hint",
    "give hint",
    "another hint"
  ];
  const isFollowUp = followUpKeywords.some(kw => msgLower.includes(kw));
  
  const chatKeywords = ["hello", "hi", "hey", "thanks", "thank you", "okay", "ok", "got it", "cool"];
  const isGeneralChat = chatKeywords.some(kw => msgLower === kw || msgLower.startsWith(kw + " ") || msgLower.startsWith(kw + "!"));
  
  const extractTopic = (msg: string): string => {
    const words = msg.toLowerCase().split(" ");
    const stopWords = ["how", "to", "the", "a", "an", "what", "is", "explain", "can", "you", "i", "do", "about", "for", "bro", "just", "give", "me"];
    const meaningful = words.filter(w => !stopWords.includes(w) && w.length > 2);
    return meaningful.slice(0, 4).join(" ").trim();
  };
  
  const findMatchingTopic = (currentMsg: string): string | null => {
    const currentWords = currentMsg.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    
    for (const topic of Object.keys(topicTracker)) {
      const topicWords = topic.split(/\s+/);
      const matchCount = currentWords.filter(w => topicWords.includes(w)).length;
      if (matchCount >= Math.min(2, topicWords.length / 2)) {
        console.log(`Matched existing topic: "${topic}"`);
        return topic;
      }
    }
    
    if (conversationHistory.length > 0) {
      for (let i = conversationHistory.length - 1; i >= 0; i--) {
        const msg = conversationHistory[i];
        if (msg.role === 'user' && msg.metadata?.detectedIntent !== 'general_chat') {
          const historicalWords = msg.text.toLowerCase().split(/\s+/).filter(w => w.length > 3);
          const matchCount = currentWords.filter(w => historicalWords.includes(w)).length;
          if (matchCount >= 2) {
            const historicalTopic = extractTopic(msg.text);
            console.log(`Found topic in history: "${historicalTopic}"`);
            return historicalTopic;
          }
        }
      }
    }
    
    return null;
  };

  if (isGeneralChat && !isNewLearningQuestion) {
    console.log('Detected: General chat');
    return { 
      context: { 
        currentTopic: null, 
        attemptCount: 0, 
        isLearningMode: false
      },
      updatedTracker: topicTracker
    };
  }
  
  if (isNewLearningQuestion && !isReturningToPrevious) {
    const matchedTopic = findMatchingTopic(message);
    
    if (matchedTopic && topicTracker[matchedTopic]) {
      console.log('Detected: Returning to existing topic -', matchedTopic);
      return {
        context: {
          currentTopic: matchedTopic,
          attemptCount: topicTracker[matchedTopic].attemptCount,
          isLearningMode: true
        },
        updatedTracker: topicTracker
      };
    } else {
      const newTopic = extractTopic(message);
      console.log('Detected: New learning question -', newTopic);
      
      const updatedTracker = {
        ...topicTracker,
        [newTopic]: { 
          attemptCount: 0, 
          lastMessageIndex: conversationHistory.length
        }
      };
      
      return {
        context: {
          currentTopic: newTopic,
          attemptCount: 0,
          isLearningMode: true
        },
        updatedTracker
      };
    }
  }
  
  if (isReturningToPrevious && conversationHistory.length > 0) {
    const previousTopics = conversationHistory
      .filter((msg: ChatMessage) => msg.role === 'user')
      .map((msg: ChatMessage) => extractTopic(msg.text))
      .filter((topic: string) => topic.length > 0);
    
    if (previousTopics.length > 0) {
      const relevantTopic = previousTopics.find((topic: string) => 
        msgLower.includes(topic.split(' ')[0])
      ) || previousTopics[previousTopics.length - 2];
      
      console.log('Detected: Returning to previous topic -', relevantTopic);
      return {
        context: {
          currentTopic: relevantTopic,
          attemptCount: topicTracker[relevantTopic]?.attemptCount || 0,
          isLearningMode: true
        },
        updatedTracker: topicTracker
      };
    }
  }
  
  if (isFollowUp && previousContext?.currentTopic) {
    console.log('Detected: Follow-up question (no increment)');
    return {
      context: {
        currentTopic: previousContext.currentTopic,
        attemptCount: previousContext.attemptCount,
        isLearningMode: true
      },
      updatedTracker: topicTracker
    };
  }
  
  if (isAskingForSolution && previousContext?.isLearningMode) {
    console.log('Detected: Direct solution request');
    return {
      context: {
        currentTopic: previousContext.currentTopic,
        attemptCount: 4,
        isLearningMode: true
      },
      updatedTracker: topicTracker
    };
  }
  
  if (isGenuineAttempt && previousContext?.isLearningMode && previousContext?.currentTopic) {
    console.log('Detected: Genuine attempt (increment)');
    
    const newAttemptCount = previousContext.attemptCount + 1;
    
    const updatedTracker = {
      ...topicTracker,
      [previousContext.currentTopic]: {
        ...topicTracker[previousContext.currentTopic],
        attemptCount: newAttemptCount
      }
    };
    
    return {
      context: {
        currentTopic: previousContext.currentTopic,
        attemptCount: newAttemptCount,
        isLearningMode: true
      },
      updatedTracker
    };
  }
  
  if (previousContext?.isLearningMode && 
      previousContext?.currentTopic && 
      !isFollowUp && 
      !isAskingForSolution &&
      message.length > 10) {
    console.log('Detected: Substantive response (increment)');
    
    const newAttemptCount = previousContext.attemptCount + 1;
    
    const updatedTracker = {
      ...topicTracker,
      [previousContext.currentTopic]: {
        ...topicTracker[previousContext.currentTopic],
        attemptCount: newAttemptCount
      }
    };
    
    return {
      context: {
        currentTopic: previousContext.currentTopic,
        attemptCount: newAttemptCount,
        isLearningMode: true
      },
      updatedTracker
    };
  }
  
  console.log('Maintaining previous context');
  return { 
    context: previousContext,
    updatedTracker: topicTracker
  };
}

export const useChat = (sessionId: string) => {
  const [session, setSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  
  const [conversationContext, setConversationContext] = useState<ConversationContext>({
    currentTopic: null,
    attemptCount: 0,
    isLearningMode: false,
  });
  
  const [topicTracker, setTopicTracker] = useState<TopicTracker>({});
  
  const [timeTravelData, setTimeTravelData] = useState<TimeTravelContext>({
    isActive: false,
    questionStartTime: null,
    attemptCount: 0,
    unlockedHints: [],
    thinkingTime: 0,
  });
  
  const [elapsedTime, setElapsedTime] = useState(0);

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

  useEffect(() => {
    if (!timeTravelData.isActive || !timeTravelData.questionStartTime) {
      setElapsedTime(0);
      return;
    }
    
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - timeTravelData.questionStartTime!) / 1000);
      setElapsedTime(elapsed);
    }, 1000);
    
    return () => clearInterval(interval);
  }, [timeTravelData.isActive, timeTravelData.questionStartTime]);

  const toggleTimeTravel = () => {
    if (!timeTravelData.isActive) {
  
      setTimeTravelData({
        isActive: true,
        questionStartTime: Date.now(),
        attemptCount: 0,
        unlockedHints: [],
        thinkingTime: 0,
      });
      console.log('Time-Travel Mode ACTIVATED');
    } else {
    
      setTimeTravelData({
        isActive: false,
        questionStartTime: null,
        attemptCount: 0,
        unlockedHints: [],
        thinkingTime: 0,
      });
      setElapsedTime(0);
      console.log('Time-Travel Mode DEACTIVATED');
    }
  };

  const sendMessage = async (text: string) => {
    if (!sessionId || !auth.currentUser || !text.trim()) return;
    setSending(true);

    try {
  
      const userMessage: Omit<ChatMessage, 'id'> = {
        role: 'user',
        text: text.trim(),
        timestamp: Date.now(),
        senderId: auth.currentUser.uid,
        createdAt: Date.now(),
      };

      const userMessageId = await addMessage(sessionId, userMessage);
      setMessages(prev => [...prev, { ...userMessage, id: userMessageId }]);

  
      const { context: currentContext, updatedTracker } = analyzeContext(
        text,
        messages,
        conversationContext,
        topicTracker
      );
      setTopicTracker(updatedTracker);

      let timeTravelPayload: TimeTravelContext | null = null;

      if (timeTravelData.isActive) {
        const currentElapsed = timeTravelData.questionStartTime 
          ? Math.floor((Date.now() - timeTravelData.questionStartTime) / 1000)
          : 0;

        const msgLower = text.toLowerCase();
        const followUpPatterns = ['hint', 'complexity', 'explain more', 'what do you mean', 'why', 'how does'];
        const isFollowUp = followUpPatterns.some(pattern => msgLower.includes(pattern));


        const shouldIncrement = currentContext.isLearningMode && !isFollowUp && text.trim().length > 5;
        const newAttemptCount = shouldIncrement
          ? timeTravelData.attemptCount + 1 
          : timeTravelData.attemptCount;

    
        timeTravelPayload = {
          isActive: true,
          questionStartTime: timeTravelData.questionStartTime,
          attemptCount: newAttemptCount, 
          unlockedHints: timeTravelData.unlockedHints,
          thinkingTime: timeTravelData.thinkingTime
        };

  
        setTimeTravelData(prev => ({
          ...prev,
          attemptCount: newAttemptCount
        }));

        console.log('TIME-TRAVEL PAYLOAD:', {
          isActive: timeTravelPayload.isActive,
          elapsed: currentElapsed,
          attemptCount: timeTravelPayload.attemptCount,
          shouldIncrement: shouldIncrement,
          unlocked: timeTravelPayload.unlockedHints
        });
      }


      let realTimeData = '';
      const msgLower = text.toLowerCase();
      
      if (msgLower.includes('weather')) {
        const cityMatch = text.match(/weather in (\w+)/i);
        if (cityMatch) {
          const weather = await fetchWeather(cityMatch[1]);
          if (!weather.error) {
            realTimeData = `\n[WEATHER DATA: ${JSON.stringify(weather)}]`;
          }
        }
      } else if (msgLower.includes('news')) {
        const newsQuery = text.replace(/news|latest|today|current/gi, '').trim() || 'technology';
        const news = await fetchNews(newsQuery);
        if (!news.error && news.headlines) {
          realTimeData = `\n[NEWS DATA: ${JSON.stringify(news.headlines)}]`;
        }
      }


      const idToken = await auth.currentUser!.getIdToken();

      console.log(' SENDING TO BACKEND:', {
        timeTravelContext: timeTravelPayload,  
        conversationContext: currentContext
      });

      const backendResponse = await axios.post(`${BACKEND_URL}/api/chat`, {
        message: text + realTimeData,
        conversationHistory: messages.map(m => ({ role: m.role, text: m.text })),
        conversationContext: currentContext,
        sessionId,
        timeTravelContext: timeTravelPayload 
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        }
      });

      console.log('Backend Response:', backendResponse.data);

      let aiResponse: GroqResponse;
      try {
        aiResponse = {
          text: backendResponse.data.text,
          mode: backendResponse.data.mode,
          isHint: backendResponse.data.isHint,
          isSolution: backendResponse.data.isSolution
        };

  
        if (currentContext.isLearningMode && currentContext.attemptCount < 4) {
          if (aiResponse.isSolution === true) {
            console.warn('AI tried to give solution too early!');
            aiResponse.isSolution = false;
            aiResponse.isHint = true;
            aiResponse.text = "Let me give you a hint first! " + aiResponse.text.split('.').slice(0, 3).join('.');
          }
        }
      } catch (parseError) {
        console.error('Failed to parse response:', parseError);
        throw new Error('Invalid response from backend');
      }

      setConversationContext(currentContext);


      if (backendResponse.data.timeTravelContext) {
        const backendTT = backendResponse.data.timeTravelContext;
        
        console.log('Backend Time-Travel Update:', {
          unlocked: backendTT.unlockedHints,
          attempts: backendTT.attemptCount,
          isActive: backendTT.isActive
        });

  
        const newlyUnlocked = backendTT.unlockedHints.filter(
          (hint: number) => !timeTravelData.unlockedHints.includes(hint)
        );

        if (newlyUnlocked.length > 0) {
          console.log(' NEW HINTS UNLOCKED:', newlyUnlocked);
        }


        setTimeTravelData(prev => ({
          ...prev,
          unlockedHints: backendTT.unlockedHints,  
          attemptCount: backendTT.attemptCount,     
          isActive: backendTT.isActive             
        }));
      }

  
      const topic = currentContext.currentTopic || 'unknown-topic';
      const attempt = currentContext.attemptCount ?? 0;

      if (currentContext.isLearningMode) {
        trackAttemptSubmitted(topic, attempt);
        if (aiResponse.isHint) {
          trackHintShown(topic, attempt);
          await trackWeeklyHint(auth.currentUser.uid);
        }
        if (aiResponse.isSolution) {
          trackSolutionUnlocked(topic, attempt);
          await trackProblemEffort(auth.currentUser.uid, attempt);
        }
      }

      if (aiResponse.mode) {
        trackModeSwitched(aiResponse.mode);
      }

      const aiMessage: Omit<ChatMessage, 'id'> = {
        role: 'ai',
        text: aiResponse.text,
        timestamp: Date.now(),
        senderId: 'ai',
        createdAt: Date.now(),
        metadata: {
          isHint: aiResponse.isHint ?? false,
          isSolution: aiResponse.isSolution ?? false,
          detectedIntent: aiResponse.metadata?.detectedIntent ?? 'general-chat',
        },
        mode: aiResponse.mode === 'chat' ? 'chat' : 'learning'
      };

      const aiMessageId = await addMessage(sessionId, aiMessage);
      setMessages(prev => [...prev, { ...aiMessage, id: aiMessageId }]);


      const newMode = aiResponse.mode === 'chat' ? 'chat' : 'learning';
      await updateSession(sessionId, { mode: newMode });
      setSession(prev => prev ? { ...prev, mode: newMode } : null);

  
      if (aiResponse.isHint) {
        await incrementProgress(auth.currentUser.uid, 'hintsUsed');
      }
      if (aiResponse.isSolution) {
        await incrementProgress(auth.currentUser.uid, 'solutionsUnlocked');
      }

    } catch (error) {
      console.error('Error sending message:', error);
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
    conversationContext,
    topicTracker,
    timeTravelData,
    elapsedTime,
    toggleTimeTravel,
  };
};