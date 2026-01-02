'use client';

import { useState, useEffect } from 'react';
import apiClient from '@/lib/api-client';
import { WellnessSurvey } from '@/types';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import { MdAdd, MdDelete, MdClose } from 'react-icons/md';

interface WellnessSurveySectionProps {
  editEntryId?: string | null;
}

export default function WellnessSurveySection({ editEntryId: propEditEntryId }: WellnessSurveySectionProps = {}) {
  const [entries, setEntries] = useState<WellnessSurvey[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [formData, setFormData] = useState<WellnessSurvey>({
    date: new Date().toISOString().split('T')[0],
    fatigue_level: 5,
    aches_level: 5,
    energy_level: 5,
    sleep_quality: 5,
    mood: 5,
  });

  useEffect(() => {
    fetchEntries();
  }, []);

  useEffect(() => {
    if (propEditEntryId && entries.length > 0) {
      const entryToEdit = entries.find(e => e.id === propEditEntryId);
      if (entryToEdit) {
        setFormData(entryToEdit);
        setEditingEntryId(entryToEdit.id || null);
        setShowForm(true);
      }
    }
  }, [propEditEntryId, entries]);

  const fetchEntries = async () => {
    try {
      const res = await apiClient.get('/api/wellness-survey');
      setEntries(res.data);
    } catch (error) {
      console.error('Error fetching wellness surveys:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingEntryId) {
        await apiClient.put(`/api/wellness-survey/${editingEntryId}`, formData);
      } else {
        await apiClient.post('/api/wellness-survey', formData);
      }
      setFormData({
        date: new Date().toISOString().split('T')[0],
        fatigue_level: 5,
        aches_level: 5,
        energy_level: 5,
        sleep_quality: 5,
        mood: 5,
      });
      setEditingEntryId(null);
      setShowForm(false);
      fetchEntries();
    } catch (error) {
      console.error('Error saving wellness survey:', error);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Delete this entry?')) {
      try {
        await apiClient.delete(`/api/wellness-survey/${id}`);
        fetchEntries();
      } catch (error) {
        console.error('Error deleting entry:', error);
      }
    }
  };

  const getColor = (value: number, reverse = false) => {
    // For reverse scoring (fatigue, aches): high values are bad
    // For normal scoring (energy, sleep, mood): high values are good
    const normalizedValue = reverse ? 10 - value : value;
    if (normalizedValue <= 3) return 'bg-[#EF4444]';
    if (normalizedValue <= 6) return 'bg-[#F59E0B]';
    return 'bg-[#10B981]';
  };

  const handleCancel = () => {
    setFormData({
      date: new Date().toISOString().split('T')[0],
      fatigue_level: 5,
      aches_level: 5,
      energy_level: 5,
      sleep_quality: 5,
      mood: 5,
    });
    setEditingEntryId(null);
    setShowForm(false);
  };

  return (
    <div>
      <div className="flex justify-end mb-6">
        {!showForm && (
          <Button onClick={() => setShowForm(true)} icon={<MdAdd />}>
            Log Survey
          </Button>
        )}
      </div>

      {showForm && (
        <Card className="mb-8 p-6 lg:p-8">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-[#F9FAFB]">
              {editingEntryId ? 'Edit Wellness Survey' : 'Wellness Survey'}
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

            {/* Fatigue (reverse scoring) */}
            <div>
            <label className="block text-sm font-semibold text-[#F9FAFB] mb-2">
              Fatigue Level: {formData.fatigue_level}
            </label>
            <input
              type="range"
              min="1"
              max="10"
              value={formData.fatigue_level}
              onChange={(e) => setFormData({ ...formData, fatigue_level: parseInt(e.target.value) })}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-[#9CA3AF]">
              <span>None (1)</span>
              <span>Extreme (10)</span>
            </div>
          </div>

            {/* Aches (reverse scoring) */}
            <div>
            <label className="block text-sm font-semibold text-[#F9FAFB] mb-2">
              Body Aches: {formData.aches_level}
            </label>
            <input
              type="range"
              min="1"
              max="10"
              value={formData.aches_level}
              onChange={(e) => setFormData({ ...formData, aches_level: parseInt(e.target.value) })}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-[#9CA3AF]">
              <span>None (1)</span>
              <span>Severe (10)</span>
            </div>
          </div>

            {/* Energy (normal scoring) */}
            <div>
            <label className="block text-sm font-semibold text-[#F9FAFB] mb-2">
              Energy Level: {formData.energy_level}
            </label>
            <input
              type="range"
              min="1"
              max="10"
              value={formData.energy_level || 5}
              onChange={(e) => setFormData({ ...formData, energy_level: parseInt(e.target.value) })}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-[#9CA3AF]">
              <span>Low (1)</span>
              <span>High (10)</span>
            </div>
          </div>

            {/* Sleep Quality (normal scoring) */}
            <div>
            <label className="block text-sm font-semibold text-[#F9FAFB] mb-2">
              Sleep Quality: {formData.sleep_quality}
            </label>
            <input
              type="range"
              min="1"
              max="10"
              value={formData.sleep_quality || 5}
              onChange={(e) => setFormData({ ...formData, sleep_quality: parseInt(e.target.value) })}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-[#9CA3AF]">
              <span>Poor (1)</span>
              <span>Excellent (10)</span>
            </div>
          </div>

            {/* Mood (normal scoring) */}
            <div>
            <label className="block text-sm font-semibold text-[#F9FAFB] mb-2">
              Mood: {formData.mood}
            </label>
            <input
              type="range"
              min="1"
              max="10"
              value={formData.mood || 5}
              onChange={(e) => setFormData({ ...formData, mood: parseInt(e.target.value) })}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-[#9CA3AF]">
              <span>Low (1)</span>
              <span>High (10)</span>
            </div>
          </div>

            <div className="flex gap-4 pt-4">
              <Button type="submit" variant="primary">
                {editingEntryId ? 'Update' : 'Save'}
              </Button>
              <Button type="button" variant="secondary" onClick={handleCancel}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {entries.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-[#9CA3AF] text-sm">No wellness survey entries yet. Start tracking your overall wellness!</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {entries.map((entry) => (
            <Card key={entry.id} className="hover:border-[#6366F1]/50 transition-all duration-200">
              <div className="flex flex-col h-full">
                <div className="flex items-start justify-between mb-4">
                  <h3 className="text-base font-semibold text-[#F9FAFB]">{entry.date}</h3>
                  <button 
                    onClick={() => handleDelete(entry.id!)} 
                    className="text-[#EF4444] hover:text-[#DC2626] hover:bg-[#EF4444]/10 p-1.5 rounded-lg transition-all"
                  >
                    <MdDelete size={18} />
                  </button>
                </div>
                <div className="space-y-3 flex-1">
                  <div>
                    <div className="flex justify-between mb-1.5">
                      <span className="text-xs text-[#9CA3AF] font-medium">Fatigue</span>
                      <span className="text-xs text-[#F9FAFB] font-semibold">{entry.fatigue_level}/10</span>
                    </div>
                    <div className="w-full bg-[#374151] rounded-full h-2">
                      <div
                        className={`${getColor(entry.fatigue_level, true)} h-2 rounded-full transition-all duration-300`}
                        style={{ width: `${(entry.fatigue_level / 10) * 100}%` }}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between mb-1.5">
                      <span className="text-xs text-[#9CA3AF] font-medium">Aches</span>
                      <span className="text-xs text-[#F9FAFB] font-semibold">{entry.aches_level}/10</span>
                    </div>
                    <div className="w-full bg-[#374151] rounded-full h-2">
                      <div
                        className={`${getColor(entry.aches_level, true)} h-2 rounded-full transition-all duration-300`}
                        style={{ width: `${(entry.aches_level / 10) * 100}%` }}
                      />
                    </div>
                  </div>
                  {entry.energy_level && (
                    <div>
                      <div className="flex justify-between mb-1.5">
                        <span className="text-xs text-[#9CA3AF] font-medium">Energy</span>
                        <span className="text-xs text-[#F9FAFB] font-semibold">{entry.energy_level}/10</span>
                      </div>
                      <div className="w-full bg-[#374151] rounded-full h-2">
                        <div
                          className={`${getColor(entry.energy_level)} h-2 rounded-full transition-all duration-300`}
                          style={{ width: `${(entry.energy_level / 10) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}
                  {entry.sleep_quality && (
                    <div>
                      <div className="flex justify-between mb-1.5">
                        <span className="text-xs text-[#9CA3AF] font-medium">Sleep</span>
                        <span className="text-xs text-[#F9FAFB] font-semibold">{entry.sleep_quality}/10</span>
                      </div>
                      <div className="w-full bg-[#374151] rounded-full h-2">
                        <div
                          className={`${getColor(entry.sleep_quality)} h-2 rounded-full transition-all duration-300`}
                          style={{ width: `${(entry.sleep_quality / 10) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}
                  {entry.mood && (
                    <div>
                      <div className="flex justify-between mb-1.5">
                        <span className="text-xs text-[#9CA3AF] font-medium">Mood</span>
                        <span className="text-xs text-[#F9FAFB] font-semibold">{entry.mood}/10</span>
                      </div>
                      <div className="w-full bg-[#374151] rounded-full h-2">
                        <div
                          className={`${getColor(entry.mood)} h-2 rounded-full transition-all duration-300`}
                          style={{ width: `${(entry.mood / 10) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
