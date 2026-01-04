"use client";
import { useState, useCallback } from "react";

export const useSandbox = (sessionId: string) => {
  const [isOpen, setIsOpen] = useState(false);
  // Dynamic default based on language
const getDefaultCode = (lang: string) => {
    const defaults = {
      python: 'This is a low-powered sandbox to try out simple commands- Please delete this placeholder text and enter your code to continue',
      javascript: 'console.log("Hello World! This is a low-powered js sandbox to try out simple commands");',
      java: 'class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello Java!");\n    }\n}',
      cpp: '#include <iostream>\nusing namespace std;\n\nint main() {\n    cout << "Hello C++! This is a low-powered sandbox to try out simple commands" << endl;\n    return 0;\n}',
      c: '#include <stdio.h>\n\nint main() {\n    printf("Hello C! This is a low-powered sandbox to try out simple commands\\n");\n    return 0;\n}'
    };
    return defaults[lang as keyof typeof defaults] || '';
  };
  
  // Then use:
  const [code, setCode] = useState(getDefaultCode('python'));
  
  const [output, setOutput] = useState('');
  const [language, setLanguage] = useState('python');

  // ✅ DYNAMIC BACKEND URL - No hardcoding
  const getBackendUrl = () => {
    if (import.meta.env.DEV) {
      return 'http://localhost:8000/api/execute';
    }
    // Production: direct call to Render backend
    const backendUrl = import.meta.env.VITE_BACKEND_URL || 'https://thinkfirst-ai-backend.onrender.com';
    return `${backendUrl}/api/execute`;
  };

  const detectCodeQuestion = useCallback((question: string) => {
    //const keywords = ['code', 'function', 'write', 'implement', 'algorithm', 'program'];
    const keywords = ['sandbox','Sandbox'];
    return keywords.some(k => question.toLowerCase().includes(k));
  }, []);

  const showEditor = () => setIsOpen(true);
  const hideEditor = () => setIsOpen(false);

  const runCode = async () => {
    setOutput('Running...');
    try {
      const backendUrl = getBackendUrl();
      console.log('🚀 Calling:', backendUrl); 
      
      const res = await fetch(backendUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, language })
      });
      
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      
      const result = await res.json();
      setOutput(result.output || result.error || 'No output');
    } catch (error: any) {
      setOutput(`❌ ${error.message}`);
      console.error('Code execution failed:', error);
    }
  };

  return {
    detectCodeQuestion,
    showEditor,
    hideEditor,
    runCode,
    isOpen,
    code,
    setCode,
    output,
    language,
    setLanguage
  };
};
