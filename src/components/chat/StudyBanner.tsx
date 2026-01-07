import React, { useEffect } from 'react';

interface StudyBannerProps {
  timeLeft: number;
  difficulty: 'easy' | 'medium' | 'hard';
  onTimerTick: () => void;
  onSkip: () => void;
  onCancel: () => void;
}

const StudyBanner: React.FC<StudyBannerProps> = ({
  timeLeft,
  difficulty,
  onTimerTick,
  onSkip,
  onCancel,
}) => {
  useEffect(() => {
    if (timeLeft > 0) {
      const timer = setTimeout(onTimerTick, 1000);
      return () => clearTimeout(timer);
    }
  }, [timeLeft, onTimerTick]);

  const totalTime = difficulty === 'easy' ? 10 : difficulty === 'medium' ? 30 : 60;
  const progress = ((totalTime - timeLeft) / totalTime) * 100;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-2xl">
      <div className="max-w-4xl mx-auto px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div>
              <h2 className="text-2xl font-bold">Answer Amnesia Mode Activated!</h2>
              <p className="text-purple-100">Study this solution carefully. You'll reconstruct it from memory!</p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="text-white/80 hover:text-white text-2xl"
            title="Cancel Amnesia Mode"
          >
            ✕
          </button>
        </div>

        {/* Timer */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-lg font-semibold">Time Remaining:</span>
            <span className="text-3xl font-bold tabular-nums">{timeLeft}s</span>
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-purple-800/50 rounded-full h-3 overflow-hidden">
            <div
              className="bg-white h-full transition-all duration-1000 ease-linear rounded-full"
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={onSkip}
              className="flex-1 bg-white/20 hover:bg-white/30 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
            >
              Skip to Challenge →
            </button>
            <button
              onClick={onCancel}
              className="px-6 bg-red-500/80 hover:bg-red-500 text-white font-semibold py-2 rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>

        {/* Tip */}
        <div className="mt-4 p-3 bg-white/10 rounded-lg text-sm">
          <span className="font-semibold">Tip:</span> Focus on the <strong>logic and approach</strong>, not memorizing exact syntax!
        </div>
      </div>
    </div>
  );
};

export default StudyBanner;
