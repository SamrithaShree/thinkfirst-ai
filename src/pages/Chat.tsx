// src/pages/Chat.tsx

import React, { useRef, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useChat } from '../hooks/UseChat';
import MessageBubble from '../components/chat/MessageBubble';
import ModeIndicator from '../components/chat/ModeIndicator';
import { useVoiceInput } from '../hooks/useVoiceInput';
import VoiceSelector from '../components/chat/VoiceSelector';
import { useTextToSpeech } from '../hooks/useTexttoSpeech';
// 🆕 AMNESIA MODE IMPORTS
import { useAmnesiaMode } from '../hooks/useAmnesiaMode';
import { useAmnesiaCheck } from '../hooks/useAmnesiaCheck'; 
import { AmnesiaModeToggle } from '../components/chat/AmnesiaModeToggle';
import StudyBanner from '../components/chat/StudyBanner';
import ReconstructionEditor from '../components/chat/ReconstructionEditor';
// 🆕 FIRESTORE & AUTH IMPORTS
import { saveAmnesiaAttempt, updateAmnesiaStats } from '../services/firebase/firestore';
import { auth } from '../firebase';

const Chat: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { messages, session, loading, sending, sendMessage, conversationContext } = useChat(sessionId || '');
  const [inputText, setInputText] = React.useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 🎤 VOICE INPUT
  const { isListening, transcript, isSupported, startListening, stopListening } = useVoiceInput();

  // 🔊 TEXT-TO-SPEECH
  const ttsHook = useTextToSpeech();

  // 🧠 AMNESIA MODE
  const amnesiaMode = useAmnesiaMode();
  const { checkMemory, loading: isCheckingMemory } = useAmnesiaCheck();
  const [memoryCheckResult, setMemoryCheckResult] = useState<any>(null);

  // Auto-fill input when voice transcription completes
  useEffect(() => {
    if (transcript) {
      setInputText(transcript);
    }
  }, [transcript]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    sendMessage(inputText);
    setInputText('');
  };

  // 🆕 HANDLE AMNESIA CHALLENGE START
  const handleStartAmnesiaChallenge = (content: string) => {
    amnesiaMode.startStudyPhase(content);
  };

  // 🆕 HANDLE RECONSTRUCTION SUBMISSION
  const handleReconstructionSubmit = async (reconstruction: string) => {
    try {
      const userId = auth.currentUser?.uid;
      if (!userId) {
        alert('Please log in to use Amnesia Mode');
        return;
      }

      const originalSolution = amnesiaMode.state.originalContent;
      const currentTopic = conversationContext.currentTopic || 'unknown';

      console.log('🧠 Calling FastAPI backend for memory check...');

      // Call FastAPI backend via useAmnesiaCheck hook
      const result = await checkMemory(
        originalSolution,
        reconstruction,
        currentTopic
      );

      if (!result) {
        alert('Failed to check your reconstruction. Please try again.');
        return;
      }

      console.log('✅ Backend result:', result);

      // Save attempt to Firestore
      try {
        await saveAmnesiaAttempt(userId, {
          problemId: currentTopic,
          originalSolution,
          userReconstruction: reconstruction,
          logicScore: result.logicScore,
          passed: result.logicScore >= 70, // Consider 70+ as passing
          keyConcepts: result.keyConcepts,
          missedConcepts: result.missedConcepts,
          feedback: result.feedback,
        });

        // Update stats (streak, average)
        await updateAmnesiaStats(userId, result.logicScore, result.logicScore >= 70);
        
        console.log('✅ Saved to Firestore');
      } catch (firestoreError) {
        console.warn('⚠️ Could not save to Firestore:', firestoreError);
        // Continue anyway - the main feature still works!
      }

      // Show results
      setMemoryCheckResult({
        ...result,
        passed: result.logicScore >= 70
      });

      amnesiaMode.completeReconstruction();

    } catch (error: any) {
      console.error('❌ Error checking memory:', error);
      alert(`Failed to check your reconstruction: ${error.message || 'Unknown error'}`);
    }
  };




  // 🆕 CLOSE RESULTS MODAL
  const closeResultsModal = () => {
    setMemoryCheckResult(null);
  };

  if (loading && messages.length === 0) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-500">Loading conversation...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* 🆕 STUDY BANNER - Shows during countdown */}
      {amnesiaMode.state.isStudying && (
        <StudyBanner
          timeLeft={amnesiaMode.state.studyTimeLeft}
          difficulty={amnesiaMode.state.difficulty}
          onTimerTick={amnesiaMode.decrementTimer}
          onSkip={amnesiaMode.skipToReconstruction}
          onCancel={amnesiaMode.cancelAmnesiaMode}
        />
      )}

      {/* 🆕 RECONSTRUCTION EDITOR - Shows after study phase */}
      {amnesiaMode.state.isReconstructing && (
        <ReconstructionEditor
          onSubmit={handleReconstructionSubmit}
          onCancel={amnesiaMode.cancelAmnesiaMode}
          isChecking={isCheckingMemory}
        />
      )}

      {/* 🆕 RESULTS MODAL - Shows after checking */}
      {memoryCheckResult && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className={`px-6 py-4 rounded-t-2xl ${
              memoryCheckResult.passed 
                ? 'bg-gradient-to-r from-green-500 to-emerald-500' 
                : 'bg-gradient-to-r from-amber-500 to-orange-500'
            }`}>
              <div className="flex items-center justify-between text-white">
                <div className="flex items-center gap-3">
                  <span className="text-4xl">{memoryCheckResult.passed ? '🎉' : '💪'}</span>
                  <div>
                    <h2 className="text-2xl font-bold">
                      {memoryCheckResult.passed ? 'Great Memory!' : 'Keep Practicing!'}
                    </h2>
                    <p className="text-white/90">Logic Score: {memoryCheckResult.logicScore}/100</p>
                  </div>
                </div>
                <button onClick={closeResultsModal} className="text-white/80 hover:text-white text-2xl">✕</button>
              </div>
            </div>

            {/* Body */}
            <div className="p-6 space-y-4">
              {/* Score Bar */}
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="font-semibold">Logic Match</span>
                  <span className="font-bold">{memoryCheckResult.logicScore}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3">
                  <div
                    className={`h-full rounded-full transition-all ${
                      memoryCheckResult.logicScore >= 80 ? 'bg-green-500' : 'bg-amber-500'
                    }`}
                    style={{ width: `${memoryCheckResult.logicScore}%` }}
                  />
                </div>
              </div>

              {/* Feedback */}
              <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                <p className="text-sm font-semibold text-purple-900 dark:text-purple-100 mb-2">📝 Feedback:</p>
                <p className="text-sm text-purple-700 dark:text-purple-300">{memoryCheckResult.feedback}</p>
              </div>

              {/* Concepts Matched */}
              {memoryCheckResult.keyConcepts.length > 0 && (
                <div>
                  <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">✅ Concepts You Got Right:</p>
                  <div className="flex flex-wrap gap-2">
                    {memoryCheckResult.keyConcepts.map((concept: string, i: number) => (
                      <span key={i} className="px-3 py-1 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200 text-xs rounded-full">
                        {concept}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Missed Concepts */}
              {memoryCheckResult.missedConcepts.length > 0 && (
                <div>
                  <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">⚠️ Concepts to Review:</p>
                  <div className="flex flex-wrap gap-2">
                    {memoryCheckResult.missedConcepts.map((concept: string, i: number) => (
                      <span key={i} className="px-3 py-1 bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 text-xs rounded-full">
                        {concept}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="border-t border-gray-200 dark:border-gray-700 px-6 py-4">
              <button
                onClick={closeResultsModal}
                className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 text-white py-3 px-6 rounded-lg font-semibold hover:shadow-lg transition-all"
              >
                Continue Learning 🚀
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between mb-2">
          <Link to="/dashboard" className="text-indigo-600 hover:text-indigo-700 text-sm font-medium">
            ← Back to Dashboard
          </Link>
          
          {/* 🆕 VOICE SELECTOR */}
          <VoiceSelector
            selectedMode={ttsHook.selectedMode}
            onChangeMode={ttsHook.changeMode}
            onTestVoice={(mode) => {
              const modeData = ttsHook.availableModes[mode];
              ttsHook.speak(`Hello! I'm ${modeData.name}. ${modeData.description}`, mode);
            }}
          />
        </div>
        
        <h1 className="text-2xl font-bold text-gray-800">{session?.title || 'Chat Session'}</h1>
        <p className="text-sm text-gray-500">Started {session ? new Date(session.createdAt).toLocaleString() : ''}</p>
      </div>

      {/* Mode Status */}
      <ModeIndicator mode={session?.mode || 'chat'} />

      {/* Learning Mode Indicator */}
      {conversationContext.isLearningMode && (
        <div className="bg-blue-50 border-b border-blue-200 px-4 py-2 text-sm">
          <span className="font-semibold">📚 Learning Mode Active</span>
          {' | '}
          <span>Topic: {conversationContext.currentTopic}</span>
          {' | '}
          <span>Attempts: {conversationContext.attemptCount}</span>
        </div>
      )}

      {/* 🆕 AMNESIA MODE TOGGLE - Only show in learning mode */}
      {conversationContext.isLearningMode && (
        <div className="px-6 pt-4">
          <AmnesiaModeToggle
            isEnabled={amnesiaMode.state.isEnabled}
            onToggle={amnesiaMode.toggleAmnesiaMode}
            difficulty={amnesiaMode.state.difficulty}
            onDifficultyChange={amnesiaMode.setDifficulty}
          />
        </div>
      )}

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="text-6xl mb-4">🤖</div>
              <p className="text-xl text-gray-700">Hello! I'm ThinkFirst AI. How can I help you learn today?</p>
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <MessageBubble 
              key={m.id} 
              message={m}
              onStartAmnesiaChallenge={handleStartAmnesiaChallenge}
              isAmnesiaEnabled={amnesiaMode.state.isEnabled}
            />
          ))
        )}
        {sending && (
          <div className="flex items-center space-x-2 text-gray-500">
            <div className="animate-pulse">💭</div>
            <span>Thinking...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area with Voice */}
      <div className="bg-white border-t border-gray-200 p-4">
        <form onSubmit={handleSend} className="flex items-center space-x-2">
          {/* 🎤 MIC BUTTON */}
          {isSupported && (
            <button
              type="button"
              onClick={isListening ? stopListening : startListening}
              disabled={sending}
              className={`px-4 py-3 rounded-xl font-bold transition-all flex-shrink-0 ${
                isListening
                  ? 'bg-red-500 text-white animate-pulse shadow-lg'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 hover:shadow-md'
              }`}
              title={isListening ? 'Stop listening' : 'Voice input'}
            >
              {isListening ? '🔴' : '🎤'}
            </button>
          )}

          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            disabled={sending || isListening}
            placeholder={isListening ? "🎤 Listening..." : "Type your message or use voice..."}
            className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all disabled:bg-gray-100"
          />
          <button
            type="submit"
            disabled={sending || !inputText.trim() || isListening}
            className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex-shrink-0"
          >
            {sending ? '...' : 'Send'}
          </button>
        </form>

        {/* Help Text */}
        <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
          <p>In learning mode, I'll provide hints first to help you solve it yourself!</p>
          {!isSupported && (
            <p className="text-amber-600">💡 Voice input works in Chrome, Edge, Safari</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default Chat;




// src/pages/Chat.tsx

// import React, { useRef, useEffect, useState } from 'react';
// import { useParams, Link } from 'react-router-dom';
// import { useChat } from '../hooks/UseChat';
// import MessageBubble from '../components/chat/MessageBubble';
// import ModeIndicator from '../components/chat/ModeIndicator';
// import { useVoiceInput } from '../hooks/useVoiceInput';
// import VoiceSelector from '../components/chat/VoiceSelector';
// import { useTextToSpeech } from '../hooks/useTexttoSpeech';
// // 🆕 AMNESIA MODE IMPORTS
// import { useAmnesiaMode } from '../hooks/useAmnesiaMode';
// import { AmnesiaModeToggle } from '../components/chat/AmnesiaModeToggle';
// import StudyBanner from '../components/chat/StudyBanner';
// import ReconstructionEditor from '../components/chat/ReconstructionEditor';

// const Chat: React.FC = () => {
//   const { sessionId } = useParams<{ sessionId: string }>();
//   const { messages, session, loading, sending, sendMessage, conversationContext } = useChat(sessionId || '');
//   const [inputText, setInputText] = React.useState('');
//   const messagesEndRef = useRef<HTMLDivElement>(null);

//   // 🎤 VOICE INPUT
//   const { isListening, transcript, isSupported, startListening, stopListening } = useVoiceInput();

//   // 🔊 TEXT-TO-SPEECH
//   const ttsHook = useTextToSpeech();

//   // 🧠 AMNESIA MODE
//   const amnesiaMode = useAmnesiaMode();
//   const [isCheckingMemory, setIsCheckingMemory] = useState(false);

//   // Auto-fill input when voice transcription completes
//   useEffect(() => {
//     if (transcript) {
//       setInputText(transcript);
//     }
//   }, [transcript]);

//   const scrollToBottom = () => {
//     messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
//   };

//   useEffect(() => {
//     scrollToBottom();
//   }, [messages]);

//   const handleSend = (e: React.FormEvent) => {
//     e.preventDefault();
//     if (!inputText.trim()) return;
//     sendMessage(inputText);
//     setInputText('');
//   };

//   // 🆕 HANDLE AMNESIA CHALLENGE START
//   const handleStartAmnesiaChallenge = (content: string) => {
//     amnesiaMode.startStudyPhase(content);
//   };

//   // 🆕 HANDLE RECONSTRUCTION SUBMISSION
//   const handleReconstructionSubmit = async (reconstruction: string) => {
//     setIsCheckingMemory(true);
    
//     // TODO: Send to backend for logic checking (we'll add this in Phase 2)
//     // For now, just simulate checking
//     setTimeout(() => {
//       setIsCheckingMemory(false);
//       amnesiaMode.completeReconstruction();
      
//       // Show result (temporary - we'll make this better)
//       alert('Memory check complete! (Backend integration coming next)');
//     }, 2000);
//   };

//   if (loading && messages.length === 0) {
//     return (
//       <div className="flex items-center justify-center h-screen">
//         <div className="text-gray-500">Loading conversation...</div>
//       </div>
//     );
//   }

//   return (
//     <div className="flex flex-col h-screen bg-gray-50">
//       {/* 🆕 STUDY BANNER - Shows during countdown */}
//       {amnesiaMode.state.isStudying && (
//         <StudyBanner
//           timeLeft={amnesiaMode.state.studyTimeLeft}
//           difficulty={amnesiaMode.state.difficulty}
//           onTimerTick={amnesiaMode.decrementTimer}
//           onSkip={amnesiaMode.skipToReconstruction}
//           onCancel={amnesiaMode.cancelAmnesiaMode}
//         />
//       )}

//       {/* 🆕 RECONSTRUCTION EDITOR - Shows after study phase */}
//       {amnesiaMode.state.isReconstructing && (
//         <ReconstructionEditor
//           onSubmit={handleReconstructionSubmit}
//           onCancel={amnesiaMode.cancelAmnesiaMode}
//           isChecking={isCheckingMemory}
//         />
//       )}

//       {/* Header */}
//       <div className="bg-white border-b border-gray-200 px-6 py-4">
//         <div className="flex items-center justify-between mb-2">
//           <Link to="/dashboard" className="text-indigo-600 hover:text-indigo-700 text-sm font-medium">
//             ← Back to Dashboard
//           </Link>
          
//           {/* 🆕 VOICE SELECTOR */}
//           <VoiceSelector
//             selectedMode={ttsHook.selectedMode}
//             onChangeMode={ttsHook.changeMode}
//             onTestVoice={(mode) => {
//               const modeData = ttsHook.availableModes[mode];
//               ttsHook.speak(`Hello! I'm ${modeData.name}. ${modeData.description}`, mode);
//             }}
//           />
//         </div>
        
//         <h1 className="text-2xl font-bold text-gray-800">{session?.title || 'Chat Session'}</h1>
//         <p className="text-sm text-gray-500">Started {session ? new Date(session.createdAt).toLocaleString() : ''}</p>
//       </div>

//       {/* Mode Status */}
//       <ModeIndicator mode={session?.mode || 'chat'} />

//       {/* Learning Mode Indicator */}
//       {conversationContext.isLearningMode && (
//         <div className="bg-blue-50 border-b border-blue-200 px-4 py-2 text-sm">
//           <span className="font-semibold">📚 Learning Mode Active</span>
//           {' | '}
//           <span>Topic: {conversationContext.currentTopic}</span>
//           {' | '}
//           <span>Attempts: {conversationContext.attemptCount}</span>
//         </div>
//       )}

//       {/* 🆕 AMNESIA MODE TOGGLE - Only show in learning mode */}
//       {conversationContext.isLearningMode && (
//         <div className="px-6 pt-4">
//           <AmnesiaModeToggle
//             isEnabled={amnesiaMode.state.isEnabled}
//             onToggle={amnesiaMode.toggleAmnesiaMode}
//             difficulty={amnesiaMode.state.difficulty}
//             onDifficultyChange={amnesiaMode.setDifficulty}
//           />
//         </div>
//       )}

//       {/* Chat Area */}
//       <div className="flex-1 overflow-y-auto p-6 space-y-4">
//         {messages.length === 0 ? (
//           <div className="flex items-center justify-center h-full">
//             <div className="text-center">
//               <div className="text-6xl mb-4">🤖</div>
//               <p className="text-xl text-gray-700">Hello! I'm ThinkFirst AI. How can I help you learn today?</p>
//             </div>
//           </div>
//         ) : (
//           messages.map((m) => (
//             <MessageBubble 
//               key={m.id} 
//               message={m}
//               onStartAmnesiaChallenge={handleStartAmnesiaChallenge}
//               isAmnesiaEnabled={amnesiaMode.state.isEnabled}
//             />
//           ))
//         )}
//         {sending && (
//           <div className="flex items-center space-x-2 text-gray-500">
//             <div className="animate-pulse">💭</div>
//             <span>Thinking...</span>
//           </div>
//         )}
//         <div ref={messagesEndRef} />
//       </div>

//       {/* Input Area with Voice */}
//       <div className="bg-white border-t border-gray-200 p-4">
//         <form onSubmit={handleSend} className="flex items-center space-x-2">
//           {/* 🎤 MIC BUTTON */}
//           {isSupported && (
//             <button
//               type="button"
//               onClick={isListening ? stopListening : startListening}
//               disabled={sending}
//               className={`px-4 py-3 rounded-xl font-bold transition-all flex-shrink-0 ${
//                 isListening
//                   ? 'bg-red-500 text-white animate-pulse shadow-lg'
//                   : 'bg-gray-100 text-gray-700 hover:bg-gray-200 hover:shadow-md'
//               }`}
//               title={isListening ? 'Stop listening' : 'Voice input'}
//             >
//               {isListening ? '🔴' : '🎤'}
//             </button>
//           )}

//           <input
//             type="text"
//             value={inputText}
//             onChange={(e) => setInputText(e.target.value)}
//             disabled={sending || isListening}
//             placeholder={isListening ? "🎤 Listening..." : "Type your message or use voice..."}
//             className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all disabled:bg-gray-100"
//           />
//           <button
//             type="submit"
//             disabled={sending || !inputText.trim() || isListening}
//             className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex-shrink-0"
//           >
//             {sending ? '...' : 'Send'}
//           </button>
//         </form>

//         {/* Help Text */}
//         <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
//           <p>In learning mode, I'll provide hints first to help you solve it yourself!</p>
//           {!isSupported && (
//             <p className="text-amber-600">💡 Voice input works in Chrome, Edge, Safari</p>
//           )}
//         </div>
//       </div>
//     </div>
//   );
// };

// export default Chat;





// // src/pages/Chat.tsx

// import React, { useRef, useEffect, useState } from 'react';
// import { useParams, Link } from 'react-router-dom';
// import { useChat } from '../hooks/UseChat';
// import MessageBubble from '../components/chat/MessageBubble';
// import ModeIndicator from '../components/chat/ModeIndicator';

// // ========== THINKING TIMELINE COMPONENT ========== 
// const ThinkingTimeline = ({ context }: { context: any }) => {
//   const [elapsed, setElapsed] = useState(0);
  
//   useEffect(() => {
//   // ⏱️ FIXED: Only track time when toggle is ON
//   if (!context.problemStartTime || !context.isLearningMode || !context.timeTravelEnabled) {
//     setElapsed(0);
//     return;
//   }
  
//   const interval = setInterval(() => {
//     const now = Date.now();
//     setElapsed(Math.floor((now - context.problemStartTime!) / 1000));
//   }, 1000);
  
//   return () => clearInterval(interval);
// }, [context.problemStartTime, context.isLearningMode, context.timeTravelEnabled]); // ← Added timeTravelEnabled
//  // Fixed: Added isLearningMode dependency
  
//   if (!context.isLearningMode) return null;
  
//   // Fixed: Consistent progressive OR logic
//   const canShowHint1 = elapsed >= 30 && context.attemptCount >= 1;
//   const canShowHint2 = elapsed >= 60 && context.attemptCount >= 2;
//   const canShowHint3 = elapsed >= 90 && context.attemptCount >= 3;
//   const canShowSolution = elapsed >= 120 && context.attemptCount >= 4;
  
//   return (
//     <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 p-4 rounded-lg mb-4 shadow-sm">
//       <div className="flex items-center justify-between mb-3">
//         <span className="font-semibold text-indigo-900 flex items-center gap-2">
//           ⏱️ Time-Travel Hints
//         </span>
//         <span className="text-indigo-600 font-mono text-lg font-bold">{elapsed}s</span>
//       </div>
      
//       <div className="space-y-2 text-sm">
//         <div className={`flex items-center gap-2 ${canShowHint1 ? "text-green-600 font-medium" : "text-gray-400"}`}>
//           <span className="text-lg">{canShowHint1 ? "🔓" : "🔒"}</span>
//           <span>Hint 1: Conceptual (30s AND 1 attempt)</span>
//         </div>
//         <div className={`flex items-center gap-2 ${canShowHint2 ? "text-green-600 font-medium" : "text-gray-400"}`}>
//           <span className="text-lg">{canShowHint2 ? "🔓" : "🔒"}</span>
//           <span>Hint 2: Approach (60s AND 2 attempts)</span>
//         </div>
//         <div className={`flex items-center gap-2 ${canShowHint3 ? "text-green-600 font-medium" : "text-gray-400"}`}>
//           <span className="text-lg">{canShowHint3 ? "🔓" : "🔒"}</span>
//           <span>Hint 3: Pseudocode (90s AND 3 attempts)</span>
//         </div>
//         <div className={`flex items-center gap-2 ${canShowSolution ? "text-green-600 font-medium" : "text-gray-400"}`}>
//           <span className="text-lg">{canShowSolution ? "🔓" : "🔒"}</span>
//           <span>Solution (120s AND 4 attempts)</span>
//         </div>
//       </div>
      
//       <div className="mt-3 pt-3 border-t border-indigo-200 flex justify-between text-xs text-indigo-700">
//         <span>📝 Attempts: {context.attemptCount}</span>
//         <span>🧠 Thinking: {Math.round(context.thinkingTimeSeconds || 0)}s</span>
//       </div>
//     </div>
//   );
// };
// // ========== END TIMELINE COMPONENT ==========

// const Chat: React.FC = () => {
//   const { sessionId } = useParams<{ sessionId: string }>();
//   const [timeTravelEnabled, setTimeTravelEnabled] = useState(false);
//   const { messages, session, loading, sending, sendMessage, conversationContext } = useChat(sessionId || '', timeTravelEnabled);
//   const [inputText, setInputText] = React.useState('');
//   const messagesEndRef = useRef<HTMLDivElement>(null);

//   const scrollToBottom = () => {
//     messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
//   };

//   useEffect(() => {
//     scrollToBottom();
//   }, [messages]);

//   const handleSend = (e: React.FormEvent) => {
//     e.preventDefault();
//     if (!inputText.trim()) return;
//     sendMessage(inputText);
//     setInputText('');
//   };

//   if (loading && messages.length === 0) {
//     return (
//       <div className="flex items-center justify-center h-screen">
//         <div className="text-gray-500">Loading conversation...</div>
//       </div>
//     );
//   }

//   return (
//     <div className="flex flex-col h-screen bg-gray-50">
//       {/* Header */}
//       <div className="bg-white border-b border-gray-200 px-6 py-4">
//         <Link to="/dashboard" className="text-indigo-600 hover:text-indigo-700 text-sm font-medium mb-2 inline-block">
//           ← Back to Dashboard
//         </Link>
//         <h1 className="text-2xl font-bold text-gray-800">{session?.title || 'Chat Session'}</h1>
//         <p className="text-sm text-gray-500">Started {session ? new Date(session.createdAt).toLocaleString() : ''}</p>
//       </div>

//       {/* Mode Status */}
//       <ModeIndicator mode={session?.mode || 'chat'} />

//       {/* Debug Context Info (Optional - Remove in production) */}
//       {conversationContext.isLearningMode && (
//         <div className="bg-blue-50 border-b border-blue-200 px-4 py-2 text-sm">
//           <span className="font-semibold">📚 Learning Mode Active</span>
//           {' | '}
//           <span>Topic: {conversationContext.currentTopic}</span>
//           {' | '}
//           <span>Attempts: {conversationContext.attemptCount}</span>
//         </div>
//       )}

//       {/* Time-Travel Toggle */}
//       {conversationContext.isLearningMode && (
//         <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
//           <div className="flex items-center gap-3">
//             <span className="text-sm font-medium text-gray-700">⏱️ Time-Travel Hints Mode</span>
//             <label className="relative inline-flex items-center cursor-pointer">
//               <input
//                 type="checkbox"
//                 checked={timeTravelEnabled}
//                 onChange={(e) => setTimeTravelEnabled(e.target.checked)}
//                 className="sr-only peer"
//               />
//               <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
//             </label>
//             <span className="text-xs text-gray-500">
//               {timeTravelEnabled ? 'Hints unlock over time' : 'Instant hints'}
//             </span>
//           </div>
//         </div>
//       )}

//       {/* Timeline Display */}
//       {conversationContext.isLearningMode && timeTravelEnabled && (
//         <div className="px-6 pt-4">
//           <ThinkingTimeline context={conversationContext} />
//         </div>
//       )}

//       {/* Chat Area */}
//       <div className="flex-1 overflow-y-auto p-6 space-y-4">
//         {messages.length === 0 ? (
//           <div className="flex items-center justify-center h-full">
//             <div className="text-center">
//               <div className="text-6xl mb-4">🤖</div>
//               <p className="text-xl text-gray-700">Hello! I'm ThinkFirst AI. How can I help you learn today?</p>
//             </div>
//           </div>
//         ) : (
//           messages.map((m) => <MessageBubble key={m.id} message={m} />)
//         )}
//         {sending && (
//           <div className="flex items-center space-x-2 text-gray-500">
//             <div className="animate-pulse">💭</div>
//             <span>Thinking...</span>
//           </div>
//         )}
//         <div ref={messagesEndRef} />
//       </div>

//       {/* Input Area */}
//       <div className="bg-white border-t border-gray-200 p-4">
//         <form onSubmit={handleSend} className="flex items-center space-x-2">
//           <input
//             type="text"
//             value={inputText}
//             onChange={(e) => setInputText(e.target.value)}
//             disabled={sending}
//             placeholder="Type your message..."
//             className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
//           />
//           <button
//             type="submit"
//             disabled={sending || !inputText.trim()}
//             className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
//           >
//             {sending ? '...' : 'Send'}
//           </button>
//         </form>
//         <p className="text-xs text-gray-500 text-center mt-2">
//           In learning mode, I'll provide hints first to help you solve it yourself!
//         </p>
//       </div>
//     </div>
//   );
// };

// export default Chat;
