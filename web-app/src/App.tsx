import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import WorkoutsPage from './pages/WorkoutsPage'
import ActivityPage from './pages/ActivityPage'
import NutritionPage from './pages/NutritionPage'
import WellnessPage from './pages/WellnessPage'
import CalendarPage from './pages/CalendarPage'
import AboutMyselfPage from './pages/AboutMyselfPage'
import GeneralAnalysisPage from './pages/GeneralAnalysisPage'
import ChatbotPage from './pages/ChatbotPage'
import PlanGeneratorPage from './pages/PlanGeneratorPage'
import BodyScanPage from './pages/BodyScanPage'
import AuthenticatedLayout from './layouts/AuthenticatedLayout'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#1A1512] to-[#0B0C10]">
        <div className="animate-pulse text-[#FF6B35] text-xl">Loading...</div>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <AuthenticatedLayout>
              <Routes>
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/plan-generator" element={<PlanGeneratorPage />} />
                <Route path="/workouts" element={<WorkoutsPage />} />
                <Route path="/activity" element={<ActivityPage />} />
                <Route path="/nutrition" element={<NutritionPage />} />
                <Route path="/wellness" element={<WellnessPage />} />
                <Route path="/calendar" element={<CalendarPage />} />
                <Route path="/about-myself" element={<AboutMyselfPage />} />
                <Route path="/general-analysis" element={<GeneralAnalysisPage />} />
                <Route path="/chatbot" element={<ChatbotPage />} />
                <Route path="/body-scan" element={<BodyScanPage />} />
              </Routes>
            </AuthenticatedLayout>
          </ProtectedRoute>
        }
      />
    </Routes>
  )
}

export default App
