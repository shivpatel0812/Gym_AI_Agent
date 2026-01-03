'use client';

import { useState, useEffect } from 'react';
import apiClient from '@/lib/api-client';
import { SleepEntry } from '@/types';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import { MdAdd, MdDelete, MdClose, MdBedtime } from 'react-icons/md';

interface SleepSectionProps {
  editEntryId?: string | null;
}

export default function SleepSection({ editEntryId: propEditEntryId }: SleepSectionProps = {}) {
  const [entries, setEntries] = useState<SleepEntry[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [formData, setFormData] = useState<SleepEntry>({
    date: new Date().toISOString().split('T')[0],
    hours_slept: 8,
    quality: 5,
    bedtime: '',
    wake_time: '',
    notes: '',
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
      const res = await apiClient.get('/api/sleep');
      setEntries(res.data);
    } catch (error) {
      console.error('Error fetching sleep entries:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingEntryId) {
        await apiClient.put(`/api/sleep/${editingEntryId}`, formData);
      } else {
        await apiClient.post('/api/sleep', formData);
      }
      setFormData({
        date: new Date().toISOString().split('T')[0],
        hours_slept: 8,
        quality: 5,
        bedtime: '',
        wake_time: '',
        notes: '',
      });
      setEditingEntryId(null);
      setShowForm(false);
      fetchEntries();
    } catch (error) {
      console.error('Error saving sleep entry:', error);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Delete this entry?')) {
      try {
        await apiClient.delete(`/api/sleep/${id}`);
        fetchEntries();
      } catch (error) {
        console.error('Error deleting entry:', error);
      }
    }
  };

  const getQualityColor = (quality: number) => {
    if (quality <= 3) return 'bg-[#EF4444]';
    if (quality <= 6) return 'bg-[#F59E0B]';
    return 'bg-[#10B981]';
  };

  const getQualityTextColor = (quality: number) => {
    if (quality <= 3) return 'text-[#EF4444]';
    if (quality <= 6) return 'text-[#F59E0B]';
    return 'text-[#10B981]';
  };

  const handleCancel = () => {
    setFormData({
      date: new Date().toISOString().split('T')[0],
      hours_slept: 8,
      quality: 5,
      bedtime: '',
      wake_time: '',
      notes: '',
    });
    setEditingEntryId(null);
    setShowForm(false);
  };

  return (
    <div>
      <div className="flex justify-end mb-6">
        {!showForm && (
          <Button onClick={() => setShowForm(true)} icon={<MdAdd />}>
            Log Sleep
          </Button>
        )}
      </div>

      {showForm && (
        <Card className="mb-8 p-6 lg:p-8">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-[#F9FAFB]">
              {editingEntryId ? 'Edit Sleep Entry' : 'Log Sleep'}
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
              label="Hours Slept"
              type="number"
              step="0.5"
              min="0"
              max="24"
              value={formData.hours_slept.toString()}
              onChange={(e) => setFormData({ ...formData, hours_slept: parseFloat(e.target.value) || 0 })}
              required
            />

            <div>
              <label className="block text-sm font-semibold text-[#F9FAFB] mb-2">
                Sleep Quality: {formData.quality}
              </label>
              <input
                type="range"
                min="1"
                max="10"
                value={formData.quality || 5}
                onChange={(e) => setFormData({ ...formData, quality: parseInt(e.target.value) })}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-[#9CA3AF]">
                <span>Poor (1)</span>
                <span>Excellent (10)</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Bedtime (Optional)"
                type="time"
                value={formData.bedtime || ''}
                onChange={(e) => setFormData({ ...formData, bedtime: e.target.value })}
              />
              <Input
                label="Wake Time (Optional)"
                type="time"
                value={formData.wake_time || ''}
                onChange={(e) => setFormData({ ...formData, wake_time: e.target.value })}
              />
            </div>

            <Input
              label="Notes (Optional)"
              value={formData.notes || ''}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="How did you sleep? Any disturbances?"
            />

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
          <p className="text-[#9CA3AF] text-sm">No sleep entries yet. Start tracking your sleep!</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {entries.map((entry) => (
            <Card key={entry.id} className="hover:border-[#6366F1]/50 transition-all duration-200">
              <div className="flex flex-col h-full">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <h3 className="text-base font-semibold text-[#F9FAFB] mb-1">{entry.date}</h3>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2">
                        <MdBedtime className="text-[#6366F1] text-xl" />
                        <span className="text-xl font-bold text-[#F9FAFB]">
                          {entry.hours_slept}h
                        </span>
                      </div>
                      {entry.quality && (
                        <div className="flex items-center gap-2">
                          <span className={`text-lg font-bold ${getQualityTextColor(entry.quality)}`}>
                            {entry.quality}
                          </span>
                          <span className="text-sm text-[#9CA3AF]">/10</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <button 
                    onClick={() => handleDelete(entry.id!)} 
                    className="text-[#EF4444] hover:text-[#DC2626] hover:bg-[#EF4444]/10 p-1.5 rounded-lg transition-all"
                  >
                    <MdDelete size={18} />
                  </button>
                </div>
                
                {entry.quality && (
                  <div className="w-full bg-[#374151] rounded-full h-2.5 mb-3">
                    <div
                      className={`${getQualityColor(entry.quality)} h-2.5 rounded-full transition-all duration-300`}
                      style={{ width: `${(entry.quality / 10) * 100}%` }}
                    />
                  </div>
                )}
                
                <div className="space-y-1 mb-3">
                  {entry.bedtime && (
                    <p className="text-xs text-[#9CA3AF]">
                      <span className="font-semibold">Bedtime:</span> {entry.bedtime}
                    </p>
                  )}
                  {entry.wake_time && (
                    <p className="text-xs text-[#9CA3AF]">
                      <span className="font-semibold">Wake:</span> {entry.wake_time}
                    </p>
                  )}
                </div>
                
                {entry.notes && (
                  <p className="text-sm text-[#9CA3AF] mt-auto pt-2 border-t border-[#374151]">{entry.notes}</p>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

