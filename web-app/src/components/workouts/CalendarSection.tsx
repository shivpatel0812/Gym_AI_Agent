import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../../lib/api-client';
import { CalendarDay, LogCategory } from '../../types/calendar';
import { WorkoutSession, MacroEntry, StressEntry, BodyFeeling, WellnessSurvey, PhysicalActivity } from '../../types';
import { MdChevronLeft, MdChevronRight, MdFilterList, MdClose, MdEdit } from 'react-icons/md';
import Card from '../ui/Card';
import Button from '../ui/Button';

interface CalendarSectionProps {
  exercises: any[];
  splits: any[];
}

export default function CalendarSection({}: CalendarSectionProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [calendarData, setCalendarData] = useState<Map<string, CalendarDay>>(new Map());
  const [showFilters, setShowFilters] = useState(false);
  const [showOnlyActiveDates, setShowOnlyActiveDates] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<LogCategory>('all');

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const firstDayOfMonth = new Date(year, month, 1);
  const lastDayOfMonth = new Date(year, month + 1, 0);
  const daysInMonth = lastDayOfMonth.getDate();
  const startingDayOfWeek = firstDayOfMonth.getDay();

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  useEffect(() => {
    fetchCalendarData();
  }, [year, month]);

  const fetchCalendarData = async () => {
    try {
      const startDate = new Date(year, month, 1).toISOString().split('T')[0];
      const endDate = new Date(year, month + 1, 0).toISOString().split('T')[0];

      const [workoutsRes, nutritionRes, stressRes, bodyFeelingsRes, surveysRes, activitiesRes] = await Promise.all([
        apiClient.get('/api/workout-sessions'),
        apiClient.get('/api/macros'),
        apiClient.get('/api/stress'),
        apiClient.get('/api/body-feelings'),
        apiClient.get('/api/wellness-survey'),
        apiClient.get('/api/physical-activities'),
      ]);

      const dataMap = new Map<string, CalendarDay>();

      const addToMap = (date: string, category: keyof CalendarDay['logs'], item: any) => {
        if (!dataMap.has(date)) {
          dataMap.set(date, { date, logs: {} });
        }
        const day = dataMap.get(date)!;
        if (!day.logs[category]) {
          day.logs[category] = [];
        }
        (day.logs[category] as any[]).push(item);
      };

      workoutsRes.data.forEach((session: WorkoutSession) => {
        if (session.date >= startDate && session.date <= endDate) {
          addToMap(session.date, 'workouts', session);
        }
      });

      nutritionRes.data.forEach((entry: MacroEntry) => {
        if (entry.date >= startDate && entry.date <= endDate) {
          addToMap(entry.date, 'nutrition', entry);
        }
      });

      stressRes.data.forEach((entry: StressEntry) => {
        if (entry.date >= startDate && entry.date <= endDate) {
          addToMap(entry.date, 'wellness', entry);
        }
      });

      bodyFeelingsRes.data.forEach((entry: BodyFeeling) => {
        if (entry.date >= startDate && entry.date <= endDate) {
          addToMap(entry.date, 'wellness', entry);
        }
      });

      surveysRes.data.forEach((entry: WellnessSurvey) => {
        if (entry.date >= startDate && entry.date <= endDate) {
          addToMap(entry.date, 'wellness', entry);
        }
      });

      activitiesRes.data.forEach((activity: PhysicalActivity) => {
        if (activity.date >= startDate && activity.date <= endDate) {
          addToMap(activity.date, 'activity', activity);
        }
      });

      setCalendarData(dataMap);
    } catch (error) {
      console.error('Error fetching calendar data:', error);
    }
  };

  const getDateKey = (day: number) => {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  const hasLogs = (dateKey: string, category: LogCategory): boolean => {
    const day = calendarData.get(dateKey);
    if (!day) return false;

    if (category === 'all') {
      return !!(day.logs.workouts?.length || day.logs.nutrition?.length || 
                day.logs.wellness?.length || day.logs.activity?.length);
    }

    return !!(day.logs[category]?.length);
  };

  const getLogIndicators = (dateKey: string) => {
    const day = calendarData.get(dateKey);
    if (!day) return [];

    const indicators: string[] = [];
    if (day.logs.workouts?.length) indicators.push('workout');
    if (day.logs.nutrition?.length) indicators.push('nutrition');
    if (day.logs.wellness?.length) indicators.push('wellness');
    if (day.logs.activity?.length) indicators.push('activity');
    return indicators;
  };

  const shouldShowDate = (dateKey: string): boolean => {
    if (!showOnlyActiveDates) return true;
    return hasLogs(dateKey, categoryFilter);
  };

  const isToday = (day: number): boolean => {
    const today = new Date();
    return day === today.getDate() && 
           month === today.getMonth() && 
           year === today.getFullYear();
  };

  const isSelected = (day: number): boolean => {
    if (!selectedDate) return false;
    return getDateKey(day) === selectedDate;
  };

  const handleDateClick = (day: number) => {
    const dateKey = getDateKey(day);
    setSelectedDate(dateKey);
  };

  const handlePrevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
    setSelectedDate(null);
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
    setSelectedDate(null);
  };

  const selectedDayData = selectedDate ? calendarData.get(selectedDate) : undefined;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={handlePrevMonth}
            className="p-2 rounded-lg bg-[#1A1F3A] hover:bg-[#2d3b4e] transition-colors text-[#9CA3AF] hover:text-white"
          >
            <MdChevronLeft size={24} />
          </button>
          <h2 className="text-2xl font-bold text-white min-w-[200px] text-center">
            {monthNames[month]} {year}
          </h2>
          <button
            onClick={handleNextMonth}
            className="p-2 rounded-lg bg-[#1A1F3A] hover:bg-[#2d3b4e] transition-colors text-[#9CA3AF] hover:text-white"
          >
            <MdChevronRight size={24} />
          </button>
        </div>
        <Button
          onClick={() => setShowFilters(!showFilters)}
          variant="secondary"
          icon={<MdFilterList />}
        >
          Filters
        </Button>
      </div>

      {showFilters && (
        <Card className="p-4 mb-4">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="showOnlyActive"
                checked={showOnlyActiveDates}
                onChange={(e) => setShowOnlyActiveDates(e.target.checked)}
                className="w-4 h-4 rounded"
              />
              <label htmlFor="showOnlyActive" className="text-white text-sm">
                Show only dates with logged activity
              </label>
            </div>
            <div>
              <label className="block text-sm font-medium text-white mb-2">Category Filter</label>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value as LogCategory)}
                className="w-full px-4 py-2 rounded-lg bg-[#2d3b4e] border-2 border-transparent text-white focus:outline-none focus:border-[#6366F1]"
              >
                <option value="all">All Categories</option>
                <option value="workouts">Workouts</option>
                <option value="nutrition">Nutrition</option>
                <option value="wellness">Wellness</option>
                <option value="activity">Activity</option>
              </select>
            </div>
          </div>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-4 mb-4 text-sm">
        <span className="text-[#9CA3AF] font-medium">Legend:</span>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-[#8B5CF6]"></div>
          <span className="text-white">Workout</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-[#10B981]"></div>
          <span className="text-white">Nutrition</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-[#6366F1]"></div>
          <span className="text-white">Wellness</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-[#F59E0B]"></div>
          <span className="text-white">Activity</span>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 md:gap-2">
        {dayNames.map((day) => (
          <div key={day} className="text-center text-sm font-semibold text-[#9CA3AF] py-2">
            {day}
          </div>
        ))}
        {Array.from({ length: startingDayOfWeek }).map((_, idx) => (
          <div key={`empty-${idx}`} className="aspect-square" />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
          const dateKey = getDateKey(day);
          const indicators = getLogIndicators(dateKey);
          const hasData = indicators.length > 0;
          const showDate = shouldShowDate(dateKey);

          if (!showDate) {
            return <div key={day} className="aspect-square" />;
          }

          return (
            <button
              key={day}
              onClick={() => handleDateClick(day)}
              className={`aspect-square rounded-lg p-2 flex flex-col items-center justify-center transition-all relative ${
                isSelected(day)
                  ? 'bg-[#6366F1] text-white'
                  : isToday(day)
                  ? 'bg-[#6366F1]/20 border-2 border-[#6366F1] text-white'
                  : hasData
                  ? 'bg-[#2d3b4e] hover:bg-[#3d4d63] text-white'
                  : 'bg-[#1A1F3A] hover:bg-[#2d3b4e] text-[#9CA3AF] hover:text-white'
              }`}
            >
              <span className={`text-sm font-medium ${isSelected(day) ? 'text-white' : ''}`}>
                {day}
              </span>
              {hasData && (
                <div className="flex gap-1 mt-1">
                  {indicators.includes('workout') && (
                    <div className="w-1.5 h-1.5 rounded-full bg-[#8B5CF6]" />
                  )}
                  {indicators.includes('nutrition') && (
                    <div className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
                  )}
                  {indicators.includes('wellness') && (
                    <div className="w-1.5 h-1.5 rounded-full bg-[#6366F1]" />
                  )}
                  {indicators.includes('activity') && (
                    <div className="w-1.5 h-1.5 rounded-full bg-[#F59E0B]" />
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {selectedDate && (
        <DateDetailPanel
          date={selectedDate}
          dayData={selectedDayData}
          onClose={() => setSelectedDate(null)}
          onUpdate={fetchCalendarData}
        />
      )}
    </div>
  );
}

interface DateDetailPanelProps {
  date: string;
  dayData: CalendarDay | undefined;
  onClose: () => void;
  onUpdate: () => void;
}

function DateDetailPanel({ date, dayData, onClose, onUpdate }: DateDetailPanelProps) {
  const navigate = useNavigate();
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  };

  const handleDelete = async (category: string, id: string) => {
    if (!confirm('Delete this entry?')) return;

    try {
      const endpoints: Record<string, string> = {
        workouts: '/api/workout-sessions',
        nutrition: '/api/macros',
        stress: '/api/stress',
        'body-feelings': '/api/body-feelings',
        'wellness-survey': '/api/wellness-survey',
        'physical-activities': '/api/physical-activities',
      };

      const endpoint = endpoints[category];
      if (endpoint) {
        await apiClient.delete(`${endpoint}/${id}`);
        onUpdate();
      }
    } catch (error) {
      console.error('Error deleting entry:', error);
    }
  };

  const handleEditWorkout = (sessionId: string) => {
    navigate(`/workouts?tab=sessions&edit=${sessionId}`);
    onClose();
  };

  const handleEditNutrition = (entryId: string) => {
    navigate(`/nutrition?edit=${entryId}`);
    onClose();
  };

  const handleEditWellness = (entryId: string, type: 'stress' | 'body-feelings' | 'wellness-survey') => {
    const tabMap: Record<string, string> = {
      'stress': 'stress',
      'body-feelings': 'body',
      'wellness-survey': 'survey'
    };
    navigate(`/wellness?tab=${tabMap[type]}&edit=${entryId}`);
    onClose();
  };

  const handleEditActivity = (activityId: string) => {
    navigate(`/activity?edit=${activityId}`);
    onClose();
  };

  if (isMobile) {
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-end p-0">
        <Card className="w-full max-h-[90vh] overflow-y-auto p-4 rounded-t-xl rounded-b-none">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-bold text-white">{formatDate(date)}</h3>
              <p className="text-xs text-[#9CA3AF] mt-1">
                {dayData ? (
                  <>
                    {dayData.logs.workouts?.length || 0} workouts,{' '}
                    {dayData.logs.nutrition?.length || 0} nutrition,{' '}
                    {dayData.logs.wellness?.length || 0} wellness,{' '}
                    {dayData.logs.activity?.length || 0} activities
                  </>
                ) : (
                  'No logs'
                )}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-[#9CA3AF] hover:text-white transition-colors"
            >
              <MdClose size={24} />
            </button>
          </div>
          {!dayData || (!dayData.logs.workouts?.length && !dayData.logs.nutrition?.length && 
            !dayData.logs.wellness?.length && !dayData.logs.activity?.length) ? (
            <div className="text-center py-8">
              <p className="text-[#9CA3AF] mb-4">No logs for this date</p>
            </div>
          ) : (
            <div className="space-y-4">
              {dayData.logs.workouts && dayData.logs.workouts.length > 0 && (
                <div>
                  <h4 className="text-base font-semibold text-white mb-2 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-[#8B5CF6]"></div>
                    Workouts
                  </h4>
                  <div className="space-y-2">
                    {dayData.logs.workouts.map((session: WorkoutSession) => (
                      <Card key={session.id} className="p-3">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <h5 className="font-semibold text-white text-sm mb-1">
                              {session.workout_name || session.split_name || 'Workout'}
                            </h5>
                            {session.exercises && session.exercises.length > 0 && (
                              <p className="text-xs text-[#9CA3AF]">
                                {session.exercises.length} exercise(s)
                              </p>
                            )}
                          </div>
                          <div className="flex gap-2 ml-2">
                            <button
                              onClick={() => handleEditWorkout(session.id!)}
                              className="text-[#6366F1] hover:text-[#818CF8] transition-colors"
                              title="Edit workout"
                            >
                              <MdEdit size={16} />
                            </button>
                            <button
                              onClick={() => handleDelete('workouts', session.id!)}
                              className="text-[#EF4444] text-xs"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
              {dayData.logs.nutrition && dayData.logs.nutrition.length > 0 && (
                <div>
                  <h4 className="text-base font-semibold text-white mb-2 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-[#10B981]"></div>
                    Nutrition
                  </h4>
                  <div className="space-y-2">
                    {dayData.logs.nutrition.map((entry: MacroEntry) => (
                      <Card key={entry.id} className="p-3">
                        <div className="flex items-start justify-between">
                          <div className="flex-1 text-sm">
                            {entry.food_items && entry.food_items.length > 0 ? (
                              <div>
                                {entry.food_items.slice(0, 2).map((food, idx) => (
                                  <p key={idx} className="text-xs text-[#9CA3AF]">
                                    {food.name}: {food.calories} cal
                                  </p>
                                ))}
                              </div>
                            ) : (
                              <p className="text-xs text-[#9CA3AF]">
                                {entry.total_calories} cal
                              </p>
                            )}
                          </div>
                          <div className="flex gap-2 ml-2">
                            <button
                              onClick={() => handleEditNutrition(entry.id!)}
                              className="text-[#6366F1] hover:text-[#818CF8] transition-colors"
                              title="Edit nutrition"
                            >
                              <MdEdit size={16} />
                            </button>
                            <button
                              onClick={() => handleDelete('nutrition', entry.id!)}
                              className="text-[#EF4444] text-xs"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
              {dayData.logs.wellness && dayData.logs.wellness.length > 0 && (
                <div>
                  <h4 className="text-base font-semibold text-white mb-2 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-[#6366F1]"></div>
                    Wellness
                  </h4>
                  <div className="space-y-2">
                    {dayData.logs.wellness.map((entry: any) => {
                      const category = entry.stress_level !== undefined ? 'stress' :
                                     entry.description && !entry.fatigue_level ? 'body-feelings' :
                                     'wellness-survey';
                      return (
                        <Card key={entry.id} className="p-3">
                          <div className="flex items-start justify-between">
                            <div className="flex-1 text-sm">
                              {entry.stress_level !== undefined && (
                                <p className="font-semibold text-white text-xs mb-1">
                                  Stress: {entry.stress_level}/10
                                </p>
                              )}
                              {entry.description && (
                                <p className="text-xs text-[#9CA3AF]">{entry.description}</p>
                              )}
                            </div>
                            <div className="flex gap-2 ml-2">
                              <button
                                onClick={() => handleEditWellness(entry.id!, category as 'stress' | 'body-feelings' | 'wellness-survey')}
                                className="text-[#6366F1] hover:text-[#818CF8] transition-colors"
                                title="Edit wellness"
                              >
                                <MdEdit size={16} />
                              </button>
                              <button
                                onClick={() => handleDelete(category, entry.id!)}
                                className="text-[#EF4444] text-xs"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              )}
              {dayData.logs.activity && dayData.logs.activity.length > 0 && (
                <div>
                  <h4 className="text-base font-semibold text-white mb-2 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-[#F59E0B]"></div>
                    Activity
                  </h4>
                  <div className="space-y-2">
                    {dayData.logs.activity.map((activity: PhysicalActivity) => (
                      <Card key={activity.id} className="p-3">
                        <div className="flex items-start justify-between">
                          <div className="flex-1 text-sm">
                            <h5 className="font-semibold text-white text-xs mb-1">
                              {activity.activity_type || 'Activity'}
                            </h5>
                            {activity.steps && (
                              <p className="text-xs text-[#9CA3AF]">{activity.steps} steps</p>
                            )}
                          </div>
                          <div className="flex gap-2 ml-2">
                            <button
                              onClick={() => handleEditActivity(activity.id!)}
                              className="text-[#6366F1] hover:text-[#818CF8] transition-colors"
                              title="Edit activity"
                            >
                              <MdEdit size={16} />
                            </button>
                            <button
                              onClick={() => handleDelete('physical-activities', activity.id!)}
                              className="text-[#EF4444] text-xs"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-4xl max-h-[90vh] overflow-y-auto p-6 lg:p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-xl font-bold text-white">{formatDate(date)}</h3>
            <p className="text-sm text-[#9CA3AF] mt-1">
              {dayData ? (
                <>
                  {dayData.logs.workouts?.length || 0} workouts,{' '}
                  {dayData.logs.nutrition?.length || 0} nutrition logs,{' '}
                  {dayData.logs.wellness?.length || 0} wellness entries,{' '}
                  {dayData.logs.activity?.length || 0} activities
                </>
              ) : (
                'No logs for this date'
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-[#9CA3AF] hover:text-white transition-colors"
          >
            <MdClose size={24} />
          </button>
        </div>

        {!dayData || (!dayData.logs.workouts?.length && !dayData.logs.nutrition?.length && 
          !dayData.logs.wellness?.length && !dayData.logs.activity?.length) ? (
          <div className="text-center py-12">
            <p className="text-[#9CA3AF] mb-4">No logs for this date</p>
            <div className="flex gap-2 justify-center">
              <Button onClick={() => window.location.href = '/workouts?tab=sessions'} variant="primary">
                Log Workout
              </Button>
              <Button onClick={() => window.location.href = '/nutrition'} variant="secondary">
                Log Nutrition
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {dayData.logs.workouts && dayData.logs.workouts.length > 0 && (
              <div>
                <h4 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[#8B5CF6]"></div>
                  Workouts ({dayData.logs.workouts.length})
                </h4>
                <div className="space-y-3">
                    {dayData.logs.workouts.map((session: WorkoutSession) => (
                      <Card key={session.id} className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <h5 className="font-semibold text-white mb-1">
                              {session.workout_name || session.split_name || 'Workout Session'}
                            </h5>
                            {session.exercises && session.exercises.length > 0 && (
                              <p className="text-sm text-[#9CA3AF]">
                                {session.exercises.length} exercise(s)
                              </p>
                            )}
                            {session.notes && (
                              <p className="text-sm text-[#9CA3AF] mt-2">{session.notes}</p>
                            )}
                          </div>
                          <div className="flex gap-2 ml-4">
                            <button
                              onClick={() => handleEditWorkout(session.id!)}
                              className="text-[#6366F1] hover:text-[#818CF8] transition-colors"
                              title="Edit workout"
                            >
                              <MdEdit size={20} />
                            </button>
                            <button
                              onClick={() => handleDelete('workouts', session.id!)}
                              className="text-[#EF4444] hover:text-[#DC2626] transition-colors"
                              title="Delete workout"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </Card>
                    ))}
                </div>
              </div>
            )}

            {dayData.logs.nutrition && dayData.logs.nutrition.length > 0 && (
              <div>
                <h4 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[#10B981]"></div>
                  Nutrition ({dayData.logs.nutrition.length})
                </h4>
                <div className="space-y-3">
                  {dayData.logs.nutrition.map((entry: MacroEntry) => (
                    <Card key={entry.id} className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          {entry.food_items && entry.food_items.length > 0 ? (
                            <div>
                              <p className="font-semibold text-white mb-1">Food Items</p>
                              {entry.food_items.map((food, idx) => (
                                <p key={idx} className="text-sm text-[#9CA3AF]">
                                  {food.name}: {food.calories} cal
                                </p>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-[#9CA3AF]">
                              {entry.total_calories} cal | {entry.total_protein}g protein
                            </p>
                          )}
                        </div>
                        <div className="flex gap-2 ml-4">
                          <button
                            onClick={() => handleEditNutrition(entry.id!)}
                            className="text-[#6366F1] hover:text-[#818CF8] transition-colors"
                            title="Edit nutrition"
                          >
                            <MdEdit size={20} />
                          </button>
                          <button
                            onClick={() => handleDelete('nutrition', entry.id!)}
                            className="text-[#EF4444] hover:text-[#DC2626] transition-colors"
                            title="Delete nutrition"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {dayData.logs.wellness && dayData.logs.wellness.length > 0 && (
              <div>
                <h4 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[#6366F1]"></div>
                  Wellness ({dayData.logs.wellness.length})
                </h4>
                <div className="space-y-3">
                    {dayData.logs.wellness.map((entry: any) => {
                      const category = entry.stress_level !== undefined ? 'stress' :
                                     entry.description && !entry.fatigue_level ? 'body-feelings' :
                                     'wellness-survey';
                      return (
                        <Card key={entry.id} className="p-4">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              {entry.stress_level !== undefined && (
                                <p className="font-semibold text-white mb-1">
                                  Stress Level: {entry.stress_level}/10
                                </p>
                              )}
                              {entry.description && (
                                <p className="text-sm text-[#9CA3AF]">{entry.description}</p>
                              )}
                              {entry.fatigue_level !== undefined && (
                                <p className="text-sm text-[#9CA3AF]">
                                  Fatigue: {entry.fatigue_level}/10
                                </p>
                              )}
                            </div>
                            <div className="flex gap-2 ml-4">
                              <button
                                onClick={() => handleEditWellness(entry.id!, category as 'stress' | 'body-feelings' | 'wellness-survey')}
                                className="text-[#6366F1] hover:text-[#818CF8] transition-colors"
                                title="Edit wellness"
                              >
                                <MdEdit size={20} />
                              </button>
                              <button
                                onClick={() => handleDelete(category, entry.id!)}
                                className="text-[#EF4444] hover:text-[#DC2626] transition-colors"
                                title="Delete wellness"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        </Card>
                      );
                    })}
                </div>
              </div>
            )}

            {dayData.logs.activity && dayData.logs.activity.length > 0 && (
              <div>
                <h4 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[#F59E0B]"></div>
                  Activity ({dayData.logs.activity.length})
                </h4>
                <div className="space-y-3">
                    {dayData.logs.activity.map((activity: PhysicalActivity) => (
                      <Card key={activity.id} className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <h5 className="font-semibold text-white mb-1">
                              {activity.activity_type || 'Physical Activity'}
                            </h5>
                            {activity.steps && (
                              <p className="text-sm text-[#9CA3AF]">Steps: {activity.steps.toLocaleString()}</p>
                            )}
                            {activity.duration_minutes && (
                              <p className="text-sm text-[#9CA3AF]">Duration: {activity.duration_minutes} min</p>
                            )}
                            {activity.description && (
                              <p className="text-sm text-[#9CA3AF] mt-2">{activity.description}</p>
                            )}
                          </div>
                          <div className="flex gap-2 ml-4">
                            <button
                              onClick={() => handleEditActivity(activity.id!)}
                              className="text-[#6366F1] hover:text-[#818CF8] transition-colors"
                              title="Edit activity"
                            >
                              <MdEdit size={20} />
                            </button>
                            <button
                              onClick={() => handleDelete('physical-activities', activity.id!)}
                              className="text-[#EF4444] hover:text-[#DC2626] transition-colors"
                              title="Delete activity"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </Card>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

