# GymAI Agent Web App

This is a React + TypeScript + Vite web application for the GymAI Agent project, featuring Tailwind CSS for styling and Firebase for authentication.

## Tech Stack

- **React 18** - UI library
- **TypeScript** - Type safety
- **Vite** - Fast build tool and dev server
- **Tailwind CSS** - Utility-first CSS framework
- **React Router** - Client-side routing
- **Firebase** - Authentication
- **Axios** - HTTP client

## Getting Started

### Prerequisites

- Node.js 16+ installed
- npm or yarn package manager

### Installation

```bash
npm install
```

### Environment Variables

Create a `.env` file in the `web-app` directory with the following variables:

```env
VITE_FIREBASE_API_KEY=your_firebase_api_key_here
VITE_FIREBASE_AUTH_DOMAIN=your_firebase_auth_domain_here
VITE_FIREBASE_PROJECT_ID=your_firebase_project_id_here
VITE_FIREBASE_STORAGE_BUCKET=your_firebase_storage_bucket_here
VITE_FIREBASE_MESSAGING_SENDER_ID=your_firebase_messaging_sender_id_here
VITE_FIREBASE_APP_ID=your_firebase_app_id_here
VITE_API_BASE_URL=https://gymaiagent-production.up.railway.app
```

**Important:** 
- All environment variables must be prefixed with `VITE_` to be exposed to the client
- Restart your dev server after creating or updating the `.env` file
- Never commit your `.env` file to version control (it's already in `.gitignore`)

### Development

Run the development server:

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) to view the app in your browser. The page will hot-reload as you make changes.

### Build

Build the app for production:

```bash
npm run build
```

The build output will be in the `dist/` directory.

### Preview

Preview the production build locally:

```bash
npm run preview
```

### Lint

Run ESLint:

```bash
npm run lint
```

## Project Structure

```
web-app/
├── src/
│   ├── components/       # Reusable UI components
│   ├── contexts/         # React contexts (Auth, etc.)
│   ├── layouts/          # Layout components
│   ├── lib/              # Libraries and utilities (Firebase, API client)
│   ├── pages/            # Page components
│   ├── types/            # TypeScript type definitions
│   ├── ui/               # Base UI components
│   ├── wellness/         # Wellness feature components
│   ├── workouts/         # Workouts feature components
│   ├── App.tsx           # Main app component with routing
│   ├── main.tsx          # App entry point
│   └── index.css         # Global styles
├── public/               # Static assets
├── index.html            # HTML entry point
├── vite.config.ts        # Vite configuration
├── tailwind.config.js    # Tailwind CSS configuration
└── tsconfig.json         # TypeScript configuration
```

## Features

- User authentication with Firebase
- Dashboard for tracking fitness metrics
- Workout planning and tracking
- Physical activity logging
- Nutrition tracking
- Wellness surveys and metrics
- Responsive design with dark mode theme
# Build fix
