'use client';

import { useState, useEffect } from 'react';
import apiClient from '@/lib/api-client';
import { StressEntry } from '@/types';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import { MdAdd, MdDelete, MdClose } from 'react-icons/md';

interface StressSectionProps {
  editEntryId?: string | null;
}

export default function StressSection({ editEntryId: propEditEntryId }: StressSectionProps = {}) {
  const [entries, setEntries] = useState<StressEntry[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [formData, setFormData] = useState<StressEntry>({
    date: new Date().toISOString().split('T')[0],
    stress_level: 5,
    description: '',
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
      const res = await apiClient.get('/api/stress');
      setEntries(res.data);
    } catch (error) {
      console.error('Error fetching stress entries:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingEntryId) {
        await apiClient.put(`/api/stress/${editingEntryId}`, formData);
      } else {
        await apiClient.post('/api/stress', formData);
      }
      setFormData({
        date: new Date().toISOString().split('T')[0],
        stress_level: 5,
        description: '',
      });
      setEditingEntryId(null);
      setShowForm(false);
      fetchEntries();
    } catch (error) {
      console.error('Error saving stress entry:', error);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Delete this entry?')) {
      try {
        await apiClient.delete(`/api/stress/${id}`);
        fetchEntries();
      } catch (error) {
        console.error('Error deleting entry:', error);
      }
    }
  };

  const getStressColor = (level: number) => {
    if (level <= 3) return 'bg-[#10B981]';
    if (level <= 6) return 'bg-[#F59E0B]';
    return 'bg-[#EF4444]';
  };

  const getStressTextColor = (level: number) => {
    if (level <= 3) return 'text-[#10B981]';
    if (level <= 6) return 'text-[#F59E0B]';
    return 'text-[#EF4444]';
  };

  const handleCancel = () => {
    setFormData({
      date: new Date().toISOString().split('T')[0],
      stress_level: 5,
      description: '',
    });
    setEditingEntryId(null);
    setShowForm(false);
  };

  return (
    <div>
      <div className="flex justify-end mb-4 sm:mb-6">
        {!showForm && (
          <Button onClick={() => setShowForm(true)} icon={<MdAdd />}>
            Log Stress
          </Button>
        )}
      </div>

      {showForm && (
        <Card className="mb-6 sm:mb-8 p-4 sm:p-5 lg:p-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-0 mb-4 sm:mb-6">
            <h3 className="text-base sm:text-lg font-semibold text-[#F9FAFB]">
              {editingEntryId ? 'Edit Stress Level' : 'Log Stress Level'}
            </h3>
            <button
              onClick={handleCancel}
              className="text-[#9CA3AF] hover:text-[#F9FAFB] transition-colors self-start sm:self-auto"
            >
              <MdClose size={18} className="sm:w-5 sm:h-5" />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
            <Input
              label="Date"
              type="date"
              value={formData.date}
              onChange={(e) => setFormData({ ...formData, date: e.target.value })}
              required
            />

            <div>
              <label className="block text-xs sm:text-sm font-semibold text-[#F9FAFB] mb-1.5 sm:mb-2">
                Stress Level: {formData.stress_level}
              </label>
              <input
                type="range"
                min="1"
                max="10"
                value={formData.stress_level}
                onChange={(e) => setFormData({ ...formData, stress_level: parseInt(e.target.value) })}
                className="w-full"
              />
              <div className="flex justify-between text-[10px] sm:text-xs text-[#9CA3AF] mt-1">
                <span>Low (1)</span>
                <span>High (10)</span>
              </div>
            </div>

            <Input
              label="Description (Optional)"
              value={formData.description || ''}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="What's causing the stress?"
            />

            <div className="flex flex-col sm:flex-row gap-2.5 sm:gap-4 pt-3 sm:pt-4">
              <Button type="submit" variant="primary" className="w-full sm:w-auto">
                {editingEntryId ? 'Update' : 'Save'}
              </Button>
              <Button type="button" variant="secondary" onClick={handleCancel} className="w-full sm:w-auto">
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {entries.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-[#9CA3AF] text-sm">No stress entries yet. Start tracking your stress levels!</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {entries.map((entry) => (
            <Card key={entry.id} className="hover:border-[#6366F1]/50 transition-all duration-200">
              <div className="flex flex-col h-full">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <h3 className="text-base font-semibold text-[#F9FAFB] mb-1">{entry.date}</h3>
                    <div className="flex items-center gap-2">
                      <span className={`text-2xl font-bold ${getStressTextColor(entry.stress_level)}`}>
                        {entry.stress_level}
                      </span>
                      <span className="text-sm text-[#9CA3AF]">/10</span>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleDelete(entry.id!)} 
                    className="text-[#EF4444] hover:text-[#DC2626] hover:bg-[#EF4444]/10 p-1.5 rounded-lg transition-all"
                  >
                    <MdDelete size={18} />
                  </button>
                </div>
                
                <div className="w-full bg-[#374151] rounded-full h-2.5 mb-3">
                  <div
                    className={`${getStressColor(entry.stress_level)} h-2.5 rounded-full transition-all duration-300`}
                    style={{ width: `${(entry.stress_level / 10) * 100}%` }}
                  />
                </div>
                
                {entry.description && (
                  <p className="text-sm text-[#9CA3AF] mt-auto pt-2 border-t border-[#374151]">{entry.description}</p>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
