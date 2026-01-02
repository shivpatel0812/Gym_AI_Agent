import { useState, useEffect } from 'react';
import apiClient from '../lib/api-client';
import { PhysicalActivity } from '../types';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import Input from '../components/ui/Input';
import { MdAdd, MdDirectionsRun, MdDelete, MdEdit, MdClose } from 'react-icons/md';

export default function ActivityPage() {
  const [activities, setActivities] = useState<PhysicalActivity[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingActivity, setEditingActivity] = useState<PhysicalActivity | null>(null);
  const [formData, setFormData] = useState<PhysicalActivity>({
    date: new Date().toISOString().split('T')[0],
    steps: undefined,
    activity_type: '',
    description: '',
    duration_minutes: undefined,
    is_whole_day: false,
    intensity_level: 5,
  });

  useEffect(() => {
    fetchActivities();
  }, []);

  const fetchActivities = async () => {
    try {
      const res = await apiClient.get('/api/physical-activities');
      setActivities(res.data);
    } catch (error) {
      console.error('Error fetching activities:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingActivity?.id) {
        await apiClient.put(`/api/physical-activities/${editingActivity.id}`, formData);
      } else {
        await apiClient.post('/api/physical-activities', formData);
      }
      resetForm();
      setShowForm(false);
      fetchActivities();
    } catch (error) {
      console.error('Error saving activity:', error);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Delete this activity?')) {
      try {
        await apiClient.delete(`/api/physical-activities/${id}`);
        fetchActivities();
      } catch (error) {
        console.error('Error deleting activity:', error);
      }
    }
  };

  const handleEdit = (activity: PhysicalActivity) => {
    setEditingActivity(activity);
    setFormData(activity);
    setShowForm(true);
  };

  const handleCancel = () => {
    resetForm();
    setShowForm(false);
  };

  const resetForm = () => {
    setFormData({
      date: new Date().toISOString().split('T')[0],
      steps: undefined,
      activity_type: '',
      description: '',
      duration_minutes: undefined,
      is_whole_day: false,
      intensity_level: 5,
    });
    setEditingActivity(null);
  };

  const getIntensityColor = (level: number) => {
    if (level < 4) return 'bg-[#10B981]';
    if (level <= 6) return 'bg-[#F59E0B]';
    return 'bg-[#EF4444]';
  };

  return (
    <div className="p-6 lg:p-12 max-w-[1600px] mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-[#F9FAFB] mb-2">Physical Activity</h1>
        <p className="text-sm text-[#9CA3AF]">Track your daily physical activities</p>
      </div>

      <div className="flex justify-end mb-6">
        {!showForm && (
          <Button onClick={() => { resetForm(); setShowForm(true); }} icon={<MdAdd />}>
            Log Activity
          </Button>
        )}
      </div>

      {showForm && (
        <Card className="mb-8 p-6 lg:p-8">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-[#F9FAFB]">
              {editingActivity ? 'Edit Activity' : 'Log Activity'}
            </h3>
            <button
              onClick={handleCancel}
              className="text-[#9CA3AF] hover:text-[#F9FAFB] transition-colors"
            >
              <MdClose size={20} />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-6">
            <Input
              label="Date"
              type="date"
              value={formData.date}
              onChange={(e) => setFormData({ ...formData, date: e.target.value })}
              required
            />

            <Input
              label="Steps (Optional)"
              type="number"
              value={formData.steps || ''}
              onChange={(e) => setFormData({ ...formData, steps: e.target.value ? parseInt(e.target.value) : undefined })}
              placeholder="10000"
            />

            <Input
              label="Activity Type (Optional)"
              value={formData.activity_type || ''}
              onChange={(e) => setFormData({ ...formData, activity_type: e.target.value })}
              placeholder="e.g., Hiking, Running, Construction"
            />

            <div>
              <label className="flex items-center gap-2 text-[#F9FAFB]">
                <input
                  type="checkbox"
                  checked={formData.is_whole_day}
                  onChange={(e) => setFormData({ ...formData, is_whole_day: e.target.checked, duration_minutes: e.target.checked ? undefined : formData.duration_minutes })}
                  className="w-4 h-4 rounded"
                />
                <span className="text-sm font-semibold">Whole Day Activity</span>
              </label>
            </div>

            {!formData.is_whole_day && (
              <Input
                label="Duration (minutes)"
                type="number"
                value={formData.duration_minutes || ''}
                onChange={(e) => setFormData({ ...formData, duration_minutes: e.target.value ? parseInt(e.target.value) : undefined })}
                placeholder="60"
              />
            )}

            <div>
              <label className="block text-sm font-semibold text-[#F9FAFB] mb-2">
                Intensity Level: {formData.intensity_level}
              </label>
              <input
                type="range"
                min="0"
                max="10"
                value={formData.intensity_level || 5}
                onChange={(e) => setFormData({ ...formData, intensity_level: parseInt(e.target.value) })}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-[#9CA3AF]">
                <span>Low</span>
                <span>High</span>
              </div>
            </div>

            <Input
              label="Description (Optional)"
              value={formData.description || ''}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="How did you feel?"
            />

            <div className="flex gap-4 pt-4">
              <Button type="submit" variant="primary">
                {editingActivity ? 'Update' : 'Save'}
              </Button>
              <Button type="button" variant="secondary" onClick={handleCancel}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4">
        {activities.map((activity) => (
          <Card key={activity.id}>
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-lg bg-[#10B981]/20 flex items-center justify-center flex-shrink-0">
                <MdDirectionsRun className="text-[#10B981] text-2xl" />
              </div>
              <div className="flex-1">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h3 className="text-lg font-semibold text-[#F9FAFB]">
                      {activity.activity_type || 'Activity'}
                    </h3>
                    <p className="text-sm text-[#9CA3AF]">{activity.date}</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => handleEdit(activity)} className="text-[#6366F1] hover:text-[#8B5CF6]">
                      <MdEdit size={20} />
                    </button>
                    <button onClick={() => handleDelete(activity.id!)} className="text-[#EF4444] hover:text-[#DC2626]">
                      <MdDelete size={20} />
                    </button>
                  </div>
                </div>
                <div className="space-y-1">
                  {activity.steps && (
                    <p className="text-sm text-[#F9FAFB]">Steps: {activity.steps.toLocaleString()}</p>
                  )}
                  {activity.duration_minutes && (
                    <p className="text-sm text-[#F9FAFB]">Duration: {activity.duration_minutes} minutes</p>
                  )}
                  {activity.is_whole_day && (
                    <p className="text-sm text-[#F9FAFB]">Whole Day Activity</p>
                  )}
                  {activity.intensity_level !== undefined && (
                    <div>
                      <p className="text-sm text-[#9CA3AF] mb-1">Intensity: {activity.intensity_level}/10</p>
                      <div className="w-full bg-[#374151] rounded-full h-2">
                        <div
                          className={`${getIntensityColor(activity.intensity_level)} h-2 rounded-full`}
                          style={{ width: `${(activity.intensity_level / 10) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}
                  {activity.description && (
                    <p className="text-sm text-[#9CA3AF] italic mt-2">{activity.description}</p>
                  )}
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
