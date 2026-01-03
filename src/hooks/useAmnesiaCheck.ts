import { useState, useCallback } from 'react';
import { auth } from '../firebase';
import axios from 'axios';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';

interface AmnesiaCheckResponse {
  logicScore: number;
  keyConcepts: string[];
  missedConcepts: string[];
  feedback: string;
}

export const useAmnesiaCheck = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkMemory = useCallback(async (
    originalSolution: string,
    userReconstruction: string,
    currentTopic?: string
  ): Promise<AmnesiaCheckResponse | null> => {
    setLoading(true);
    setError(null);

    try {
      const user = auth.currentUser;
      if (!user) {
        throw new Error('User not authenticated');
      }

      const idToken = await user.getIdToken();

      const response = await axios.post<AmnesiaCheckResponse>(
        `${BACKEND_URL}/api/checkMemory`,
        {
          originalSolution,
          userReconstruction,
          currentTopic
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
          }
        }
      );

      console.log('🧠 Amnesia check result:', response.data);
      return response.data;

    } catch (err: any) {
      const errorMessage = err.response?.data?.detail || err.message || 'Unknown error occurred';
      setError(errorMessage);
      console.error('❌ Amnesia check error:', errorMessage);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { checkMemory, loading, error };
};
