import React, { useRef, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useChat } from '../hooks/UseChat';
import MessageBubble from '../components/chat/MessageBubble';
import ModeIndicator from '../components/chat/ModeIndicator';
import { useVoiceInput } from '../hooks/useVoiceInput';
import VoiceSelector from '../components/chat/VoiceSelector';
import { useTextToSpeech } from '../hooks/useTexttoSpeech';
import { useAmnesiaMode } from '../hooks/useAmnesiaMode';
import { useAmnesiaCheck } from '../hooks/useAmnesiaCheck'; 
import { AmnesiaModeToggle } from '../components/chat/AmnesiaModeToggle';
import StudyBanner from '../components/chat/StudyBanner';
import ReconstructionEditor from '../components/chat/ReconstructionEditor';
import { saveAmnesiaAttempt, updateAmnesiaStats } from '../services/firebase/firestore';
import { auth } from '../firebase';
import { useSandbox } from '../hooks/useSandbox';
import { techFacts } from '../data/techFacts';

const Chat: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { messages, session, loading, sending, sendMessage, conversationContext, timeTravelData,  elapsedTime,  toggleTimeTravel  } = useChat(sessionId || '');
  const [inputText, setInputText] = React.useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { isListening, transcript, isSupported, startListening, stopListening } = useVoiceInput();
  const ttsHook = useTextToSpeech();
  const amnesiaMode = useAmnesiaMode();
  const { checkMemory, loading: isCheckingMemory } = useAmnesiaCheck();
  const [memoryCheckResult, setMemoryCheckResult] = useState<any>(null);
  const [showLaunchButton, setShowLaunchButton] = useState(false); 
  const sandbox = useSandbox(sessionId || '');
  const [randomFact, setRandomFact] = useState('Loading tech fact...');
  const [isHintsExpanded, setIsHintsExpanded] = useState(false);


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
  useEffect(() => {
    setRandomFact(techFacts[Math.floor(Math.random() * techFacts.length)]);
  }, []);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    sendMessage(inputText);
    setInputText('');
    setShowLaunchButton(false);
  };
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const question = e.target.value;
    setInputText(question);
    setShowLaunchButton(sandbox.detectCodeQuestion(question));
  };

  const handleStartAmnesiaChallenge = (content: string) => {
    amnesiaMode.startStudyPhase(content);
  };

  const handleReconstructionSubmit = async (reconstruction: string) => {
    try {
      const userId = auth.currentUser?.uid;
      if (!userId) {
        alert('Please log in to use Amnesia Mode');
        return;
      }

      const originalSolution = amnesiaMode.state.originalContent;
      const currentTopic = conversationContext.currentTopic || 'unknown';

      console.log('Calling FastAPI backend for memory check...');

      const result = await checkMemory(
        originalSolution,
        reconstruction,
        currentTopic
      );

      if (!result) {
        alert('Failed to check your reconstruction. Please try again.');
        return;
      }

      console.log('Backend result:', result);

      try {
        await saveAmnesiaAttempt(userId, {
          problemId: currentTopic,
          originalSolution,
          userReconstruction: reconstruction,
          logicScore: result.logicScore,
          passed: result.logicScore >= 70, 
          keyConcepts: result.keyConcepts,
          missedConcepts: result.missedConcepts,
          feedback: result.feedback,
        });

        await updateAmnesiaStats(userId, result.logicScore, result.logicScore >= 70);
        
        console.log('Saved to Firestore');
      } catch (firestoreError) {
        console.warn('Could not save to Firestore:', firestoreError);
      }

      setMemoryCheckResult({
        ...result,
        passed: result.logicScore >= 70
      });

      amnesiaMode.completeReconstruction();

    } catch (error: any) {
      console.error('Error checking memory:', error);
      alert(`Failed to check your reconstruction: ${error.message || 'Unknown error'}`);
    }
  };




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
      {/* STUDY BANNER - Shows during countdown */}
      {amnesiaMode.state.isStudying && (
        <StudyBanner
          timeLeft={amnesiaMode.state.studyTimeLeft}
          difficulty={amnesiaMode.state.difficulty}
          onTimerTick={amnesiaMode.decrementTimer}
          onSkip={amnesiaMode.skipToReconstruction}
          onCancel={amnesiaMode.cancelAmnesiaMode}
        />
      )}

      {/* RECONSTRUCTION EDITOR - Shows after study phase */}
      {amnesiaMode.state.isReconstructing && (
        <ReconstructionEditor
          onSubmit={handleReconstructionSubmit}
          onCancel={amnesiaMode.cancelAmnesiaMode}
          isChecking={isCheckingMemory}
        />
      )}

      {/* RESULTS MODAL - Shows after checking */}
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
                <p className="text-sm font-semibold text-purple-900 dark:text-purple-100 mb-2">Feedback:</p>
                <p className="text-sm text-purple-700 dark:text-purple-300">{memoryCheckResult.feedback}</p>
              </div>

              {/* Concepts Matched */}
              {memoryCheckResult.keyConcepts.length > 0 && (
                <div>
                  <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Concepts You Got Right:</p>
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
                  <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Concepts to Review:</p>
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
                Continue Learning
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
          
          {/* VOICE SELECTOR */}
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
      {/* Time-Travel Mode UI */}
      {conversationContext.isLearningMode && (
        <div className="bg-gradient-to-r from-purple-50 to-indigo-50 border-b border-purple-200">
          {/* Toggle Switch - Always Visible */}
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center space-x-3">
              <span className="text-lg">⏰</span>
              <div>
                <h3 className="font-semibold text-gray-800">Time-Travel Hints</h3>
                <p className="text-xs text-gray-600">Hints unlock over time as you try</p>
              </div>
            </div>
            
            {/* Toggle Button */}
            <button
              onClick={toggleTimeTravel}
              className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
                timeTravelData.isActive ? 'bg-indigo-600' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                  timeTravelData.isActive ? 'translate-x-7' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Collapsible Hints Panel (only when active) */}
          {timeTravelData.isActive && (
            <div className="px-6 pb-4">
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                {/* Collapsible Header */}
                <button
                  onClick={() => setIsHintsExpanded(!isHintsExpanded)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center space-x-3">
                    <span className="text-sm font-medium text-gray-700">
                      🕐 Time-Travel Progress
                    </span>
                    <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-1 rounded-full font-semibold">
                      {timeTravelData.unlockedHints.length}/4 unlocked
                    </span>
                  </div>
                  
                  <div className="flex items-center space-x-3">
                    <span className="text-lg font-bold text-indigo-600">
                      {Math.floor(elapsedTime / 60)}:{(elapsedTime % 60).toString().padStart(2, '0')}
                    </span>
                    <svg 
                      className={`w-5 h-5 text-gray-500 transition-transform ${isHintsExpanded ? 'rotate-180' : ''}`}
                      fill="none" 
                      stroke="currentColor" 
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </button>

                {/* Collapsible Content */}
                {isHintsExpanded && (
                  <div className="px-4 pb-4 pt-2 border-t border-gray-200 space-y-2 animate-slideDown">
                    {/* Hint 1 */}
                    <div className={`flex items-center space-x-3 p-3 rounded-lg transition-all ${
                      timeTravelData.unlockedHints.includes(1) 
                        ? 'bg-green-50 border border-green-200' 
                        : 'bg-gray-50 border border-gray-200'
                    }`}>
                      <span className="text-xl">
                        {timeTravelData.unlockedHints.includes(1) ? '🔓' : '🔒'}
                      </span>
                      <div className="flex-1">
                        <p className={`text-sm font-medium ${
                          timeTravelData.unlockedHints.includes(1) ? 'text-green-700' : 'text-gray-500'
                        }`}>
                          Hint 1: Conceptual
                        </p>
                        <p className="text-xs text-gray-500">30s OR 1 attempt</p>
                      </div>
                      {timeTravelData.unlockedHints.includes(1) && (
                        <span className="text-xs font-semibold text-green-600 bg-green-100 px-2 py-1 rounded animate-pulse">
                          READY ✨
                        </span>
                      )}
                    </div>

                    {/* Hint 2 */}
                    <div className={`flex items-center space-x-3 p-3 rounded-lg transition-all ${
                      timeTravelData.unlockedHints.includes(2) 
                        ? 'bg-green-50 border border-green-200' 
                        : 'bg-gray-50 border border-gray-200'
                    }`}>
                      <span className="text-xl">
                        {timeTravelData.unlockedHints.includes(2) ? '🔓' : '🔒'}
                      </span>
                      <div className="flex-1">
                        <p className={`text-sm font-medium ${
                          timeTravelData.unlockedHints.includes(2) ? 'text-green-700' : 'text-gray-500'
                        }`}>
                          Hint 2: Approach
                        </p>
                        <p className="text-xs text-gray-500">60s AND 1 attempt</p>
                      </div>
                      {timeTravelData.unlockedHints.includes(2) && (
                        <span className="text-xs font-semibold text-green-600 bg-green-100 px-2 py-1 rounded">
                          UNLOCKED
                        </span>
                      )}
                    </div>

                    {/* Hint 3 */}
                    <div className={`flex items-center space-x-3 p-3 rounded-lg transition-all ${
                      timeTravelData.unlockedHints.includes(3) 
                        ? 'bg-green-50 border border-green-200' 
                        : 'bg-gray-50 border border-gray-200'
                    }`}>
                      <span className="text-xl">
                        {timeTravelData.unlockedHints.includes(3) ? '🔓' : '🔒'}
                      </span>
                      <div className="flex-1">
                        <p className={`text-sm font-medium ${
                          timeTravelData.unlockedHints.includes(3) ? 'text-green-700' : 'text-gray-500'
                        }`}>
                          Hint 3: Pseudocode
                        </p>
                        <p className="text-xs text-gray-500">90s AND 2 attempts</p>
                      </div>
                      {timeTravelData.unlockedHints.includes(3) && (
                        <span className="text-xs font-semibold text-green-600 bg-green-100 px-2 py-1 rounded">
                          UNLOCKED
                        </span>
                      )}
                    </div>

                    {/* Solution */}
                    <div className={`flex items-center space-x-3 p-3 rounded-lg transition-all ${
                      timeTravelData.unlockedHints.includes(4) 
                        ? 'bg-green-50 border border-green-200' 
                        : 'bg-gray-50 border border-gray-200'
                    }`}>
                      <span className="text-xl">
                        {timeTravelData.unlockedHints.includes(4) ? '🔓' : '🔒'}
                      </span>
                      <div className="flex-1">
                        <p className={`text-sm font-medium ${
                          timeTravelData.unlockedHints.includes(4) ? 'text-green-700' : 'text-gray-500'
                        }`}>
                          Solution
                        </p>
                        <p className="text-xs text-gray-500">120s OR 3 attempts</p>
                      </div>
                      {timeTravelData.unlockedHints.includes(4) && (
                        <span className="text-xs font-semibold text-green-600 bg-green-100 px-2 py-1 rounded">
                          UNLOCKED
                        </span>
                      )}
                    </div>

                    {/* Stats Footer */}
                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-200">
                      <span className="text-xs text-gray-600">
                         Attempts: <span className="font-semibold">{timeTravelData.attemptCount}</span>
                      </span>
                      <span className="text-xs text-gray-600">
                         Thinking: <span className="font-semibold">{elapsedTime}s</span>
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}


      {/* Learning Mode Indicator */}
      {conversationContext.isLearningMode && (
        <div className="bg-blue-50 border-b border-blue-200 px-4 py-2 text-sm">
          <span className="font-semibold">Learning Mode Active</span>
          {' | '}
          <span>Topic: {conversationContext.currentTopic}</span>
          {' | '}
          <span>Attempts: {conversationContext.attemptCount}</span>
        </div>
      )}

      {/* AMNESIA MODE TOGGLE - Only show in learning mode */}
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
      <div className="flex-1 overflow-y-auto p-6 space-y-4 relative">
  {messages.length === 0 ? (
    <div className="flex items-center justify-center h-full">
      <div className="text-center max-w-2xl mx-auto">
        <div className="text-2xl md:text-3xl font-bold text-blue-600 mb-8 bg-gradient-to-r from-blue-50 to-indigo-50 p-8 rounded-3xl shadow-2xl border-2 border-blue-100 animate-pulse">
           {randomFact}
        </div>
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
            {/* <div className="animate-pulse">💭</div> */}
            <span>Thinking...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area with Voice */}
      <div className="bg-white border-t border-gray-200 p-4">
        {/* LAUNCH SANDBOX BUTTON */}
        {showLaunchButton && (
          <div className="mb-4 p-4 bg-emerald-50 border-2 border-emerald-200 rounded-xl shadow-md">
            <button 
              onClick={sandbox.showEditor}
              className="w-full bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white py-4 px-6 rounded-xl font-bold text-lg shadow-lg hover:shadow-xl transition-all flex items-center justify-center"
            >
              Launch Sandbox
            </button>
          </div>
        )}
        <form onSubmit={handleSend} className="flex items-center space-x-2">
          {/* MIC BUTTON */}
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
            onChange={handleInputChange}
            disabled={sending || isListening}
            placeholder={isListening ? "🎤 Listening..." : "Type your message... (try 'Sandbox')" }
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
          <p>In learning mode, I'll provide hints first! Type "Sandbox" if you want to open quick code editor → Launch Sandbox </p>
          {!isSupported && (
            <p className="text-amber-600">Voice input works in Chrome, Edge, Safari</p>
          )}
        </div>
      </div>
       {/* Code Editor - UNCHANGED */}
       {sandbox.isOpen && (
        <div className="fixed inset-0 bg-black/80 z-[1000] flex items-center justify-center p-4">
          <div className="bg-gray-900 text-white w-full max-w-6xl h-[85vh] rounded-xl flex flex-col shadow-2xl">
            <div className="p-6 border-b border-gray-700 flex justify-between items-center">
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                <div className="w-3 h-3 bg-green-500 rounded-full"></div>
              </div>
              <select 
                value={sandbox.language} 
                onChange={(e) => sandbox.setLanguage(e.target.value)}
                className="bg-gray-800 text-white px-4 py-2 rounded-lg border border-gray-600"
              >
                <option value="python">Python 3</option>
                
                <option value="cpp">C++</option>
                <option value="c"> C</option>
              </select>
              <div className="flex space-x-2">
                <button 
                  onClick={sandbox.runCode} 
                  className="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 px-6 py-2 rounded-lg"
                >
                  Run Code
                </button>
                <button 
                  onClick={sandbox.hideEditor} 
                  className="w-10 h-10 bg-gray-700 hover:bg-gray-600 rounded-lg flex items-center justify-center"
                >
                  ×
                </button>
              </div>
            </div>
            <div className="flex-1 flex overflow-hidden">
              <textarea
                value={sandbox.code}
                onChange={(e) => sandbox.setCode(e.target.value)}
                placeholder="print('Hello World!')"
                className="flex-1 bg-gray-900 text-white p-6 font-mono text-sm resize-none outline-none"
              />
              <div className="w-1/2 bg-black p-6 font-mono text-sm overflow-auto text-green-400 border-l border-gray-700">
                <div className="text-gray-400 mb-2">▶ Console Output</div>
                <pre>{sandbox.output || 'Ready to run code...'}</pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
   
export default Chat;
