import React from "react";
import { useSandbox } from "../hooks/useSandbox";
import { ChatMessage } from "../types";

interface SandboxButtonProps {
  messages: ChatMessage[];
  sessionId: string;
  isSolutionUnlocked: boolean;
  onClick?: () => void;
}

export const SandboxButton: React.FC<SandboxButtonProps> = ({
  messages,
  sessionId,
  isSolutionUnlocked,
  onClick
}) => {
  const { launchSandbox, isGeneratingSandbox } = useSandbox(sessionId);

  if (!isSolutionUnlocked) {
    return null; 
  }

  const handleLaunch = () => {
    onClick?.();
    launchSandbox(messages);
  };

  return (
    <div className="mt-4 p-4 border border-blue-200 bg-blue-50 rounded-lg">
      <button
        onClick={handleLaunch}
        disabled={isGeneratingSandbox}
        className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg hover:from-blue-600 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
      >
        {isGeneratingSandbox ? (
          <>
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Generating...
          </>
        ) : (
          <>
            
            <span>Launch Sandbox</span>
          </>
        )}
      </button>
      
      <p className="text-xs text-blue-600 mt-1">
        Your explanation unlocked a guided coding environment.
      </p>
    </div>
  );
};
