import { ReactNode, useState } from "react";
import { useNavigate, useLocation, NavLink } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import {
  MdDashboard,
  MdFitnessCenter,
  MdDirectionsRun,
  MdRestaurant,
  MdFavorite,
  MdCalendarMonth,
  MdPerson,
  MdAnalytics,
  MdChatBubble,
  MdLogout,
  MdMenu,
  MdClose,
} from "react-icons/md";

interface AuthenticatedLayoutProps {
  children: ReactNode;
}

export default function AuthenticatedLayout({
  children,
}: AuthenticatedLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, signOut } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const navItems = [
    { label: "Dashboard", href: "/dashboard", icon: MdDashboard },
    { label: "Workouts", href: "/workouts", icon: MdFitnessCenter },
    { label: "Activity", href: "/activity", icon: MdDirectionsRun },
    { label: "Nutrition", href: "/nutrition", icon: MdRestaurant },
    { label: "Wellness", href: "/wellness", icon: MdFavorite },
    { label: "Calendar", href: "/calendar", icon: MdCalendarMonth },
    { label: "About Myself", href: "/about-myself", icon: MdPerson },
    { label: "General Analysis", href: "/general-analysis", icon: MdAnalytics },
    { label: "Chatbot", href: "/chatbot", icon: MdChatBubble },
  ];

  return (
    <div className="flex h-screen bg-[#0A0E27]">
      {/* Mobile Menu Button */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 rounded-lg bg-[#1A1F3A] text-[#F9FAFB] border border-[#374151]"
      >
        {sidebarOpen ? <MdClose size={24} /> : <MdMenu size={24} />}
      </button>

      {/* Sidebar Overlay (Mobile) */}
      {sidebarOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-30"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-40 w-64 bg-[#1A1F3A] border-r border-[#374151] flex flex-col transform transition-transform duration-200 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        {/* Logo */}
        <div className="p-6 border-b border-[#374151]">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] bg-clip-text text-transparent">
            GymAI
          </h1>
          <p className="text-xs text-[#9CA3AF] mt-1">Your Fitness Companion</p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.href;
            return (
              <NavLink
                key={item.href}
                to={item.href}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                  isActive
                    ? "bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] text-white shadow-lg shadow-[#6366F1]/20"
                    : "text-[#9CA3AF] hover:text-[#F9FAFB] hover:bg-[#374151]/30"
                }`}
              >
                <Icon className="text-xl" />
                <span className="font-semibold text-sm">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        {/* User Profile & Logout */}
        <div className="p-4 border-t border-[#374151] space-y-3">
          {user?.email && (
            <div className="px-4 py-2 bg-[#374151]/30 rounded-lg">
              <p className="text-xs text-[#9CA3AF]">Signed in as</p>
              <p className="text-sm text-[#F9FAFB] font-semibold truncate">
                {user.email}
              </p>
            </div>
          )}
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-[#EF4444] hover:bg-[#EF4444]/10 transition-all"
          >
            <MdLogout className="text-xl" />
            <span className="font-semibold text-sm">Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="lg:hidden h-16" /> {/* Spacer for mobile menu button */}
        {children}
      </main>
    </div>
  );
}
