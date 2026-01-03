// src/types.ts

export interface ChatSession {
  id: string;
  userId: string;
  title?: string;
  mode: 'learning' | 'chat';
  participants: string[];
  lastMessage?: ChatMessage;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  topicTracker?: { [key: string]: any }; // ← ADD: For topic persistence
}

export interface ChatMessage {
  id: string;
  text: string;
  senderId: string;
  role: 'user' | 'ai';
  timestamp: number;
  createdAt: number;
  metadata?: {
    isHint?: boolean;
    isSolution?: boolean;
    detectedIntent?: string;
    topic?: string; 
    isSolutionExplanation?: boolean;
  };
  mode?: 'learning' | 'chat';
}

// 🆕 ADD: User type (if not already present)
export interface User {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  createdAt: number;
  progress: UserProgress; // ← Links to progress tracking
}

// 🆕 UPDATE: UserProgress with Effort-Based fields
export interface UserProgress {
  // Existing fields (keep these)
  questionsAsked: number;
  hintsUsed: number;
  solutionsUnlocked: number;
  totalSessions: number;
  
  // 🆕 EFFORT-BASED TRACKING (NEW FIELDS)
  problemsTriedBeforeSolution: number;  // Problems where they made 2+ attempts before solution
  hintsUsedThisWeek: number;            // Weekly hint counter (auto-resets)
  solutionsAfterEffort: number;         // Solutions unlocked after 2+ attempts
  lastWeekReset: number;                // Timestamp for weekly reset (milliseconds)
  effortScore: number;                  // Total attempts made (higher = more effort)
}

// 🆕 ADD: Effort Stats type (for dashboard display)
export interface EffortStats {
  problemsTriedBeforeSolution: number;
  hintsUsedThisWeek: number;
  solutionsAfterEffort: number;
  effortScore: number;
  averageEffortPerSolution: number;     // Calculated: effortScore / solutionsUnlocked
}

