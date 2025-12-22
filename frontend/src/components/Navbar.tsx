import { Link } from 'react-router-dom';

interface NavbarProps {
  onLogout: () => void;
}

export default function Navbar({ onLogout }: NavbarProps) {
  return (
    <nav className="bg-gray-800 p-4 mb-8">
      <div className="max-w-7xl mx-auto flex justify-between items-center">
        <div className="flex gap-8">
          <Link to="/" className="text-white no-underline hover:text-gray-300">Dashboard</Link>
          <Link to="/workouts" className="text-white no-underline hover:text-gray-300">Workouts</Link>
          <Link to="/activity" className="text-white no-underline hover:text-gray-300">Activity</Link>
          <Link to="/nutrition" className="text-white no-underline hover:text-gray-300">Nutrition</Link>
          <Link to="/wellness" className="text-white no-underline hover:text-gray-300">Wellness</Link>
        </div>
        <button onClick={onLogout} className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 cursor-pointer">Logout</button>
      </div>
    </nav>
  );
}
