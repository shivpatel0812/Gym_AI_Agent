'use client';

import { useState, useEffect } from 'react';
import apiClient from '@/lib/api-client';
import { HydrationEntry } from '@/types';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import { MdAdd, MdDelete, MdClose, MdWaterDrop } from 'react-icons/md';

interface HydrationSectionProps {
  editEntryId?: string | null;
}

export default function HydrationSection({ editEntryId: propEditEntryId }: HydrationSectionProps = {}) {
  const [entries, setEntries] = useState<HydrationEntry[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [formData, setFormData] = useState<HydrationEntry>({
    date: new Date().toISOString().split('T')[0],
    amount_cups: 0,
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
      const res = await apiClient.get('/api/hydration');
      setEntries(res.data);
    } catch (error) {
      console.error('Error fetching hydration entries:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingEntryId) {
        await apiClient.put(`/api/hydration/${editingEntryId}`, formData);
      } else {
        await apiClient.post('/api/hydration', formData);
      }
      setFormData({
        date: new Date().toISOString().split('T')[0],
        amount_cups: 0,
        notes: '',
      });
      setEditingEntryId(null);
      setShowForm(false);
      fetchEntries();
    } catch (error) {
      console.error('Error saving hydration entry:', error);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Delete this entry?')) {
      try {
        await apiClient.delete(`/api/hydration/${id}`);
        fetchEntries();
      } catch (error) {
        console.error('Error deleting entry:', error);
      }
    }
  };

  const handleCancel = () => {
      setFormData({
        date: new Date().toISOString().split('T')[0],
        amount_cups: 0,
        notes: '',
      });
      setEditingEntryId(null);
      setShowForm(false);
    };

  const formatAmount = (cups: number) => {
    if (cups === 1) {
      return '1 cup';
    }
    return `${cups} cups`;
  };

  return (
    <div>
      <div className="flex justify-end mb-6">
        {!showForm && (
          <Button onClick={() => setShowForm(true)} icon={<MdAdd />}>
            Log Hydration
          </Button>
        )}
      </div>

      {showForm && (
        <Card className="mb-8 p-6 lg:p-8">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-[#F9FAFB]">
              {editingEntryId ? 'Edit Hydration' : 'Log Hydration'}
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
              label="Amount (cups)"
              type="number"
              step="0.25"
              min="0"
              value={formData.amount_cups.toString()}
              onChange={(e) => setFormData({ ...formData, amount_cups: parseFloat(e.target.value) || 0 })}
              placeholder="e.g., 2"
              required
            />

            <Input
              label="Notes (Optional)"
              value={formData.notes || ''}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="e.g., Morning water, post-workout"
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
          <p className="text-[#9CA3AF] text-sm">No hydration entries yet. Start tracking your water intake!</p>
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
                      <MdWaterDrop className="text-[#3B82F6] text-2xl" />
                      <span className="text-2xl font-bold text-[#3B82F6]">
                        {formatAmount(entry.amount_cups)}
                      </span>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleDelete(entry.id!)} 
                    className="text-[#EF4444] hover:text-[#DC2626] hover:bg-[#EF4444]/10 p-1.5 rounded-lg transition-all"
                  >
                    <MdDelete size={18} />
                  </button>
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

