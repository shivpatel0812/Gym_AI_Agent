import { localDateKey } from "../../lib/localDate";
'use client';

import { useState, useEffect } from 'react';
import apiClient from '@/lib/api-client';
import { BodyFeeling } from '@/types';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import { MdAdd, MdDelete, MdClose } from 'react-icons/md';

interface BodyFeelingsSectionProps {
  editEntryId?: string | null;
}

export default function BodyFeelingsSection({ editEntryId: propEditEntryId }: BodyFeelingsSectionProps = {}) {
  const [entries, setEntries] = useState<BodyFeeling[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [formData, setFormData] = useState<BodyFeeling>({
    date: localDateKey(),
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
      const res = await apiClient.get('/api/body-feelings');
      setEntries(res.data);
    } catch (error) {
      console.error('Error fetching body feelings:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingEntryId) {
        await apiClient.put(`/api/body-feelings/${editingEntryId}`, formData);
      } else {
        await apiClient.post('/api/body-feelings', formData);
      }
      setFormData({
        date: localDateKey(),
        description: '',
      });
      setEditingEntryId(null);
      setShowForm(false);
      fetchEntries();
    } catch (error) {
      console.error('Error saving body feeling:', error);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Delete this entry?')) {
      try {
        await apiClient.delete(`/api/body-feelings/${id}`);
        fetchEntries();
      } catch (error) {
        console.error('Error deleting entry:', error);
      }
    }
  };

  const handleCancel = () => {
    setFormData({
      date: localDateKey(),
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
            Log Feeling
          </Button>
        )}
      </div>

      {showForm && (
        <Card className="mb-6 sm:mb-8 p-4 sm:p-5 lg:p-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-0 mb-4 sm:mb-6">
            <h3 className="text-base sm:text-lg font-semibold text-[#FFFFFF]">
              {editingEntryId ? 'Edit Body Feeling' : 'Log Body Feeling'}
            </h3>
            <button
              onClick={handleCancel}
              className="text-[#8E8E93] hover:text-[#FFFFFF] transition-colors self-start sm:self-auto"
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
              <label className="block text-xs sm:text-sm font-semibold text-[#FFFFFF] mb-1.5 sm:mb-2">
                Description
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="How does your body feel today?"
                required
                rows={3}
                className="w-full px-3 sm:px-4 py-2.5 sm:py-3 text-sm sm:text-base rounded-lg bg-[#161A22] border-2 border-[#2A2D35] text-[#FFFFFF] placeholder:text-[#8E8E93] focus:outline-none focus:ring-2 focus:ring-[#FF6B35] focus:border-transparent transition-all resize-none"
              />
            </div>

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
          <p className="text-[#8E8E93] text-sm">No body feeling entries yet. Start tracking how your body feels!</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {entries.map((entry) => (
            <Card key={entry.id} className="hover:border-[#FF6B35]/50 transition-all duration-200">
              <div className="flex flex-col h-full">
                <div className="flex items-start justify-between mb-3">
                  <h3 className="text-base font-semibold text-[#FFFFFF]">{entry.date}</h3>
                  <button 
                    onClick={() => handleDelete(entry.id!)} 
                    className="text-[#EF4444] hover:text-[#DC2626] hover:bg-[#EF4444]/10 p-1.5 rounded-lg transition-all"
                  >
                    <MdDelete size={18} />
                  </button>
                </div>
                <p className="text-sm text-[#8E8E93] leading-relaxed mt-auto">{entry.description}</p>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
