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
  MdAutoAwesome,
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
    { label: "My Plan", href: "/plan-generator", icon: MdAutoAwesome },
    { label: "Workouts", href: "/workouts", icon: MdFitnessCenter },
    { label: "Activity", href: "/activity", icon: MdDirectionsRun },
    { label: "Nutrition", href: "/nutrition", icon: MdRestaurant },
    { label: "Wellness", href: "/wellness", icon: MdFavorite },
    { label: "Calendar", href: "/calendar", icon: MdCalendarMonth },
    { label: "About Myself", href: "/about-myself", icon: MdPerson },
    { label: "General Analysis", href: "/general-analysis", icon: MdAnalytics },
    { label: "Coach Chat", href: "/chatbot", icon: MdChatBubble },
  ];

  const displayName =
    user?.displayName ||
    user?.email?.split("@")[0] ||
    "Athlete";
  const initials = displayName
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "G";

  return (
    <div className="flex h-screen bg-[#0B0C10]">
      {!sidebarOpen && (
        <button
          onClick={() => setSidebarOpen(true)}
          className="lg:hidden fixed top-4 left-4 z-50 p-2.5 rounded-xl bg-[#161A22] text-white border border-[#2A2D35]"
        >
          <MdMenu size={22} />
        </button>
      )}

      {sidebarOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/60 z-30"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`fixed lg:static inset-y-0 left-0 z-40 w-[240px] bg-[#0B0C10] border-r border-[#1C1C1E] flex flex-col transform transition-transform duration-200 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <div className="px-5 pt-6 pb-4 relative">
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden absolute top-4 right-4 p-1.5 rounded-full text-[#8E8E93] hover:text-white hover:bg-white/5 transition-colors"
            aria-label="Close menu"
          >
            <MdClose size={20} />
          </button>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#FF6B35] flex items-center justify-center shadow-orange">
              <span className="text-white font-bold text-lg leading-none">G</span>
            </div>
            <div>
              <h1 className="text-[15px] font-bold text-white tracking-tight leading-tight">GymAI</h1>
              <p className="text-[9px] text-[#636366] font-semibold tracking-[0.12em] uppercase mt-0.5">
                Performance Coach
              </p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.href;
            return (
              <NavLink
                key={item.href}
                to={item.href}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-[13px] ${
                  isActive
                    ? "bg-[#FF6B35]/10 text-[#FF6B35] font-semibold"
                    : "text-[#8E8E93] hover:text-white hover:bg-white/[0.03] font-medium"
                }`}
              >
                <Icon className={`text-lg ${isActive ? "text-[#FF6B35]" : ""}`} />
                <span className="flex-1">{item.label}</span>
                {isActive && (
                  <span className="w-1.5 h-1.5 rounded-full bg-[#FF6B35]" />
                )}
              </NavLink>
            );
          })}
        </nav>

        <div className="p-4 space-y-2 border-t border-[#1C1C1E]">
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="w-9 h-9 rounded-full bg-[#7C3AED]/30 text-[#C4B5FD] flex items-center justify-center text-xs font-bold">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white truncate capitalize">
                {displayName}
              </p>
              <p className="text-[11px] text-[#636366]">Pro plan</p>
            </div>
          </div>
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-[#8E8E93] hover:text-[#EF4444] hover:bg-white/[0.03] transition-all text-[13px] font-medium"
          >
            <MdLogout className="text-lg" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto bg-[#0B0C10]">
        <div className="lg:hidden h-16" />
        {children}
      </main>
    </div>
  );
}
