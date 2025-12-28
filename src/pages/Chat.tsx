// src/pages/Chat.tsx

import React, { useRef, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useChat } from '../hooks/UseChat';
import MessageBubble from '../components/chat/MessageBubble';
import ModeIndicator from '../components/chat/ModeIndicator';

const Chat: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { messages, session, loading, sending, sendMessage, conversationContext } = useChat(sessionId || '');
  const [inputText, setInputText] = React.useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

  if (loading && messages.length === 0) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-500">Loading conversation...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <Link to="/dashboard" className="text-indigo-600 hover:text-indigo-700 text-sm font-medium mb-2 inline-block">
          ← Back to Dashboard
        </Link>
        <h1 className="text-2xl font-bold text-gray-800">{session?.title || 'Chat Session'}</h1>
        <p className="text-sm text-gray-500">Started {session ? new Date(session.createdAt).toLocaleString() : ''}</p>
      </div>

      {/* Mode Status */}
      <ModeIndicator mode={session?.mode || 'chat'} />

      {/* ADD: Debug Context Info (Remove in production) */}
      {conversationContext.isLearningMode && (
        <div className="bg-blue-50 border-b border-blue-200 px-4 py-2 text-sm">
          <span className="font-semibold">📚 Learning Mode Active</span>
          {' | '}
          <span>Topic: {conversationContext.currentTopic}</span>
          {' | '}
          <span>Attempt: {conversationContext.attemptCount}</span>
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
          messages.map((m) => <MessageBubble key={m.id} message={m} />)
        )}
        {sending && (
          <div className="flex items-center space-x-2 text-gray-500">
            <div className="animate-pulse">💭</div>
            <span>Thinking...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="bg-white border-t border-gray-200 p-4">
        <form onSubmit={handleSend} className="flex items-center space-x-2">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            disabled={sending}
            placeholder="Type your message..."
            className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
          />
          <button
            type="submit"
            disabled={sending || !inputText.trim()}
            className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {sending ? '...' : 'Send'}
          </button>
        </form>
        <p className="text-xs text-gray-500 text-center mt-2">
          In learning mode, I'll provide hints first to help you solve it yourself!
        </p>
      </div>
    </div>
  );
};

export default Chat;
