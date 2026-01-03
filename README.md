
# ThinkFirst AI

ThinkFirst AI is a specialized learning chatbot. It detects when you're asking technical or educational questions and guides you through a multi-step hint process before revealing the full solution.

## Features
- **Dual Mode AI:** Switches between "General Chat" and "Learning Mode" automatically.
- **Hint Progression:** Get small hints, then stronger ones, before the full answer.
- **Session Tracking:** Persist your conversations and track your learning progress.
- **Clean UI:** Responsive design using Tailwind CSS.

## Getting Started

### Prerequisites
- Node.js (v18+)
- Firebase CLI (`npm install -g firebase-tools`)
- Groq API Key

### Local Development

1. **Install Dependencies:**
   ```bash
   npm install
   cd functions && npm install && cd ..
   ```

2. **Configure Environment:**
   - Create a `.env.local` file in the root:
     ```
     VITE_BACKEND_URL=http://localhost:5001/YOUR_PROJECT_ID/us-central1/chat
     ```
   - For this demo/sandbox, the frontend uses a direct (mocked) call to Gemini for immediate interactivity. If deploying for real, use the Cloud Function.

3. **Set API Key:**
   The application requires `process.env.API_KEY` for Gemini. In this sandbox environment, it's pre-configured.

4. **Run Frontend:**
   ```bash
   npm run dev
   ```

5. **Run Backend (Optional):**
   ```bash
   firebase emulators:start --only functions
   ```

### Deployment

1. **Firebase Init:**
   ```bash
   firebase init
   ```
2. **Deploy Functions:**
   ```bash
   firebase deploy --only functions
   ```

## Tech Stack

### Frontend
- **Framework:** React 18 + TypeScript
- **Build Tool:** Vite
- **Styling:** Tailwind CSS
- **Routing:** React Router v6
- **State Management:** React Hooks
- **Authentication:** Firebase Auth (Google Sign-In)
- **Database:** Cloud Firestore
- **Real-time APIs:** OpenWeather API, News API

### Backend
- **Framework:** FastAPI (Python)
- **AI Model:** Groq API - Llama 3.3 70B
- **Authentication:** Firebase Admin SDK
- **Deployment:** Render.com
- **Cost:** 100% Free Tier

### Features
- Progressive Learning Mode (hint → solution)
- Amnesia Mode (memory reconstruction challenges)
- Voice Input (Web Speech API)
- Text-to-Speech (5 voice modes)
- Analytics & Progress Tracking
- Real-time Weather & News Integration
